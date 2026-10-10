// End-to-end test of the full pickup lifecycle against a running API + worker.
// Prereqs: `npm run seed` has been run, and `npm run dev` + `npm run worker` are running.
// Works against LocalStack (AWS_ENDPOINT set) or real AWS. Each run creates one new
// resident and one completed pickup, so it can be repeated without resetting data.
// Usage: npm run test:e2e   (override the API with E2E_API_URL=http://host:port)
import 'dotenv/config';

const API = process.env.E2E_API_URL || `http://localhost:${process.env.PORT || 5000}`;
const BUCKET = process.env.S3_BUCKET;
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;
let passed = 0, failed = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) { passed++; results.push(`PASS  ${name}`); }
  else { failed++; results.push(`FAIL  ${name}  ${detail}`); }
  console.log(results.at(-1));
  return cond;
}

/** Every API response body, with the token that requested it, for the qrToken leak sweep. */
const responseLog = [];

async function api(method, path, { body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  responseLog.push({ token, method, path, status: r.status, text });
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response */ }
  return { status: r.status, json };
}

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function main() {
  try {
    await fetch(`${API}/health`);
  } catch {
    console.error(`API not reachable at ${API}. Start it with \`npm run dev\` (and \`npm run worker\`) first.`);
    process.exit(1);
  }
  console.log(`E2E against ${API} (${AWS_ENDPOINT ? `LocalStack ${AWS_ENDPOINT}` : 'real AWS'})\n`);

  // --- Auth ---
  const email = `e2e.${Date.now()}@test.dev`;
  let r = await api('POST', '/api/auth/register', { body: { name: 'E2E Resident', email, password: 'password123', role: 'resident' } });
  check('register resident -> 201 + token', r.status === 201 && r.json?.data?.token, JSON.stringify(r.json));
  r = await api('POST', '/api/auth/register', { body: { name: 'Dup', email, password: 'password123' } });
  check('duplicate email -> 409', r.status === 409, `${r.status}`);
  r = await api('POST', '/api/auth/login', { body: { email, password: 'wrong-password' } });
  check('wrong password -> 401', r.status === 401, `${r.status}`);
  r = await api('POST', '/api/auth/login', { body: { email, password: 'password123' } });
  check('login resident -> 200 + token', r.status === 200 && r.json?.data?.token, JSON.stringify(r.json));
  const resident = r.json.data.token;
  r = await api('GET', '/api/auth/me', { token: resident });
  check('GET /me returns user without passwordHash', r.status === 200 && r.json.data.email === email && !('passwordHash' in r.json.data), JSON.stringify(r.json));

  const collector = (await api('POST', '/api/auth/login', { body: { email: 'ravi.collector@recyconnect.dev', password: 'password123' } })).json?.data?.token;
  const collector2 = (await api('POST', '/api/auth/login', { body: { email: 'meena.collector@recyconnect.dev', password: 'password123' } })).json?.data?.token;
  const admin = (await api('POST', '/api/auth/login', { body: { email: 'admin@recyconnect.dev', password: 'password123' } })).json?.data?.token;
  if (!check('login seeded collector + admin', collector && collector2 && admin)) {
    console.error('Seed users missing. Run `npm run seed` first.');
    process.exit(1);
  }

  const statsBefore = (await api('GET', '/api/admin/stats', { token: admin })).json.data;

  // --- Create pickup ---
  r = await api('POST', '/api/pickups', { token: resident, body: { address: '1 Test Lane, Bengaluru', notes: 'e2e', declaredCategory: 'plastic' } });
  check('resident creates pickup -> 201 pending', r.status === 201 && r.json.data.status === 'pending' && r.json.data.qrToken && r.json.data.collectorId === null, JSON.stringify(r.json));
  const pickup = r.json.data;
  r = await api('GET', '/api/pickups/mine', { token: resident });
  check('GET /mine includes new pickup', r.json.data.some((p) => p.pickupId === pickup.pickupId));

  // --- Assign ---
  r = await api('GET', '/api/pickups/available', { token: collector });
  const avail = r.json.data.find((p) => p.pickupId === pickup.pickupId);
  check('GET /available lists it without qrToken', avail && !('qrToken' in avail), JSON.stringify(avail));
  r = await api('PATCH', `/api/pickups/${pickup.pickupId}/collect`, { token: collector, body: { qrToken: pickup.qrToken, weightKg: 1 } });
  check('collect before assign -> 403/409', r.status === 403 || r.status === 409, `${r.status} ${JSON.stringify(r.json)}`);
  r = await api('PATCH', `/api/pickups/${pickup.pickupId}/assign`, { token: collector });
  check('collector assigns -> assigned', r.status === 200 && r.json.data.status === 'assigned' && !('qrToken' in r.json.data), JSON.stringify(r.json));
  r = await api('PATCH', `/api/pickups/${pickup.pickupId}/assign`, { token: collector2 });
  check('second collector assign -> 409', r.status === 409, `${r.status}`);
  r = await api('GET', '/api/pickups/assigned', { token: collector });
  check('GET /assigned includes it', r.json.data.some((p) => p.pickupId === pickup.pickupId));
  r = await api('GET', `/api/pickups/${pickup.pickupId}/timeline`, { token: collector2 });
  check('unrelated collector timeline -> 404', r.status === 404, `${r.status}`);

  // --- Photo upload ---
  r = await api('POST', '/api/uploads/presign', { token: resident, body: { pickupId: pickup.pickupId, contentType: 'image/png' } });
  check('presign -> 200', r.status === 200 && r.json.data.uploadUrl, JSON.stringify(r.json));
  const { uploadUrl, key, headers } = r.json.data;
  if (AWS_ENDPOINT) {
    const expected = `${AWS_ENDPOINT.replace(/\/$/, '')}/${BUCKET}/pickups/${pickup.pickupId}/`;
    check(`presigned URL is path-style on ${AWS_ENDPOINT}`, uploadUrl.startsWith(expected), uploadUrl.slice(0, 120));
  } else {
    check('presigned URL targets the real S3 bucket', new URL(uploadUrl).hostname.startsWith(`${BUCKET}.s3.`), uploadUrl.slice(0, 120));
  }
  check('presigned URL has no SDK checksum params', ![...new URL(uploadUrl).searchParams.keys()].some((k) => /checksum/i.test(k)), uploadUrl);
  r = await api('POST', '/api/uploads/confirm', { token: resident, body: { pickupId: pickup.pickupId, key } });
  check('confirm before upload -> 400', r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);

  // Browser-style PUT including an Origin header (exercises S3 CORS)
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { ...headers, Origin: 'http://localhost:5173' }, body: PNG });
  check('PUT image to presigned URL -> 200', put.status === 200, `${put.status} ${await put.text()}`);
  check('S3 CORS header returned for localhost:5173', put.headers.get('access-control-allow-origin') === 'http://localhost:5173', String(put.headers.get('access-control-allow-origin')));
  const pre = await fetch(uploadUrl, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
  check('S3 CORS preflight OK', pre.ok && pre.headers.get('access-control-allow-origin') === 'http://localhost:5173', `${pre.status} ${pre.headers.get('access-control-allow-origin')}`);

  r = await api('POST', '/api/uploads/confirm', { token: resident, body: { pickupId: pickup.pickupId, key: 'pickups/someone-else/x.png' } });
  check('confirm with foreign key -> 400', r.status === 400, `${r.status}`);
  r = await api('POST', '/api/uploads/confirm', { token: resident, body: { pickupId: pickup.pickupId, key } });
  check('confirm -> 202 mlStatus queued', r.status === 202 && r.json.data.mlStatus === 'queued' && r.json.data.photoKey === key, JSON.stringify(r.json));
  check('resident confirm response includes their own qrToken', r.json?.data?.qrToken === pickup.qrToken);

  // The assigned collector re-takes the photo (the normal app flow). This path used to leak
  // qrToken. If the worker hasn't processed the resident's photo yet, that message becomes stale and is skipped.
  r = await api('POST', '/api/uploads/presign', { token: collector, body: { pickupId: pickup.pickupId, contentType: 'image/png' } });
  check('collector presign -> 200', r.status === 200 && r.json?.data?.uploadUrl, JSON.stringify(r.json));
  const cPut = await fetch(r.json.data.uploadUrl, { method: 'PUT', headers: r.json.data.headers, body: PNG });
  check('collector PUT to S3 -> 200', cPut.status === 200, String(cPut.status));
  const collectorKey = r.json.data.key;
  r = await api('POST', '/api/uploads/confirm', { token: collector, body: { pickupId: pickup.pickupId, key: collectorKey } });
  check('collector confirm -> 202 with new photoKey', r.status === 202 && r.json.data.photoKey === collectorKey, JSON.stringify(r.json));
  check('collector confirm response has NO qrToken', r.json?.data && !('qrToken' in r.json.data), JSON.stringify(r.json?.data));

  // --- Worker ---
  let ml;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    ml = (await api('GET', `/api/pickups/${pickup.pickupId}/timeline`, { token: resident })).json.data.ml;
    if (ml.status === 'done') break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  check('worker wrote ML result (mlStatus done)', ml?.status === 'done', JSON.stringify(ml));
  check('ML result fields valid', ml?.category === 'plastic' && typeof ml.contamination === 'boolean' && ml.confidence >= 0.7 && ml.confidence <= 0.95, JSON.stringify(ml));

  // --- Collect ---
  r = await api('PATCH', `/api/pickups/${pickup.pickupId}/collect`, { token: collector, body: { qrToken: '00000000-0000-0000-0000-000000000000', weightKg: 5.5 } });
  check('collect with wrong qrToken -> 400', r.status === 400, `${r.status}`);
  r = await api('PATCH', `/api/pickups/${pickup.pickupId}/collect`, { token: collector2, body: { qrToken: pickup.qrToken, weightKg: 5.5 } });
  check('collect by non-assignee -> 403', r.status === 403, `${r.status}`);
  r = await api('PATCH', `/api/pickups/${pickup.pickupId}/collect`, { token: collector, body: { qrToken: pickup.qrToken, weightKg: 5.5 } });
  check('collect with qrToken -> collected, 5.5kg', r.status === 200 && r.json.data.status === 'collected' && r.json.data.weightKg === 5.5, JSON.stringify(r.json));

  // --- Handoff ---
  r = await api('POST', '/api/handoffs', { token: collector, body: { pickupId: pickup.pickupId, facilityName: 'E2E Recycling Facility' } });
  check('create handoff -> 201', r.status === 201 && r.json.data.confirmedByRecycler === false, JSON.stringify(r.json));
  const handoff = r.json.data;
  r = await api('POST', '/api/handoffs', { token: collector, body: { pickupId: pickup.pickupId, facilityName: 'Again' } });
  check('second handoff -> 409', r.status === 409, `${r.status}`);
  r = await api('PATCH', `/api/handoffs/${handoff.handoffId}/confirm`, { token: collector });
  check('collector confirm handoff -> 403', r.status === 403, `${r.status}`);
  r = await api('PATCH', `/api/handoffs/${handoff.handoffId}/confirm`, { token: admin });
  check('admin confirms handoff -> confirmed', r.status === 200 && r.json.data.confirmedByRecycler === true && r.json.data.confirmedAt, JSON.stringify(r.json));
  r = await api('PATCH', `/api/handoffs/${handoff.handoffId}/confirm`, { token: admin });
  check('re-confirm -> 409', r.status === 409, `${r.status}`);

  // --- Timeline ---
  r = await api('GET', `/api/pickups/${pickup.pickupId}/timeline`, { token: resident });
  const t = r.json.data;
  check('timeline: completed with full 5-step chain of custody',
    t.status === 'completed' && t.history.map((h) => h.status).join(',') === 'pending,assigned,collected,handed_off,completed',
    JSON.stringify(t.history?.map((h) => h.status)));
  check('timeline: actors resolved + handoff attached',
    t.history.every((h) => h.actor?.name) && t.handoffs.length === 1 && t.handoffs[0].confirmedByRecycler === true,
    JSON.stringify(t));

  // --- Admin ---
  r = await api('GET', '/api/admin/stats', { token: admin });
  const s = r.json.data;
  console.log('stats before:', JSON.stringify(statsBefore));
  console.log('stats after: ', JSON.stringify(s));
  check('admin stats: totals moved by this pickup',
    s.totalPickups === statsBefore.totalPickups + 1 &&
    s.byStatus.completed === statsBefore.byStatus.completed + 1 &&
    Math.abs(s.totalKgCollected - (statsBefore.totalKgCollected + 5.5)) < 1e-9 &&
    s.contaminationCount === statsBefore.contaminationCount + (ml.contamination ? 1 : 0), '');
  r = await api('GET', '/api/admin/pickups?status=completed', { token: admin });
  check('admin pickups?status=completed includes it', r.json.data.some((p) => p.pickupId === pickup.pickupId) && r.json.data.every((p) => p.status === 'completed'));
  r = await api('GET', '/api/admin/collectors', { token: admin });
  const ravi = r.json.data.find((c) => c.email === 'ravi.collector@recyconnect.dev');
  check('admin collectors has counts', ravi && typeof ravi.completedCount === 'number' && ravi.completedCount >= 2, JSON.stringify(ravi));
  r = await api('GET', '/api/admin/stats', { token: resident });
  check('resident on admin stats -> 403', r.status === 403);
  r = await api('GET', '/api/admin/pickups', { token: admin });
  check('admin pickups include qrToken (admins may see it)', r.json.data.find((p) => p.pickupId === pickup.pickupId)?.qrToken === pickup.qrToken);

  // --- qrToken leak sweep ---
  // Hit every collector-readable endpoint once more, then scan EVERY response a collector
  // received during this whole run for the secret's value or a qrToken field.
  await api('GET', '/api/pickups/available', { token: collector });
  await api('GET', '/api/pickups/assigned', { token: collector });
  await api('GET', '/api/pickups/assigned', { token: collector2 });
  await api('GET', `/api/pickups/${pickup.pickupId}/timeline`, { token: collector });
  await api('GET', '/api/auth/me', { token: collector });
  const collectorResponses = responseLog.filter((e) => e.token === collector || e.token === collector2);
  const leaks = collectorResponses.filter((e) => e.text.includes(pickup.qrToken) || /"qrToken"\s*:/.test(e.text));
  check(
    `no collector response leaks qrToken (${collectorResponses.length} responses scanned)`,
    collectorResponses.length >= 15 && leaks.length === 0,
    leaks.map((e) => `${e.method} ${e.path} -> ${e.status}`).join(', ') || `only ${collectorResponses.length} responses scanned`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
