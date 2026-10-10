import { after, before, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { app } from '../../src/app';
import { ddb, s3, sqs } from '../../src/config/aws';
import { auth, signToken } from '../../src/middleware/auth';
import { sanitizeForViewer } from '../../src/utils/sanitize';
import { logger } from '../../src/utils/logger';
import { ok } from '../../src/utils/response';
import type { AuthUser, Pickup } from '../../src/types';

// The qrToken must never reach a collector, whichever endpoint returns the pickup.
// 1) sanitizeForViewer rules  2) the real /api/uploads/confirm route (AWS clients stubbed)
// 3) ok() strips it even when a handler forgets toPickupView  4) no handler can bypass ok().

process.env.JWT_SECRET ||= 'unit-test-secret';
process.env.S3_BUCKET ||= 'unit-test-bucket';
process.env.SQS_QUEUE_URL ||= 'http://localhost/000000000000/unit-test-queue';
logger.level = 'silent';

const SECRET = 'qr-secret-5f3c';
const RESIDENT: AuthUser = { userId: 'resident-1', role: 'resident' };
const COLLECTOR: AuthUser = { userId: 'collector-1', role: 'collector' };
const ADMIN: AuthUser = { userId: 'admin-1', role: 'admin' };
const PICKUP_ID = '11111111-2222-4333-8444-555555555555';

const pickup: Pickup = {
  pickupId: PICKUP_ID,
  residentId: RESIDENT.userId,
  collectorId: COLLECTOR.userId,
  address: '1 Test Lane',
  status: 'assigned',
  qrToken: SECRET,
  declaredCategory: 'plastic',
  mlStatus: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  statusHistory: [],
};

// ---------------------------------------------------------------------------
// 1. sanitizeForViewer
// ---------------------------------------------------------------------------

test('sanitizer strips qrToken from nested objects and arrays for a collector', () => {
  const payload = { pickup, list: [pickup, { wrapper: { pickup } }], count: 2 };
  const out = sanitizeForViewer(payload, COLLECTOR);
  assert.equal(JSON.stringify(out).includes(SECRET), false);
  assert.equal(out.count, 2);
  assert.equal(out.pickup.address, pickup.address);
  assert.equal(pickup.qrToken, SECRET, 'input must not be mutated');
});

test('sanitizer keeps qrToken for the owning resident and admins only', () => {
  assert.equal(sanitizeForViewer(pickup, RESIDENT).qrToken, SECRET);
  assert.equal(sanitizeForViewer(pickup, ADMIN).qrToken, SECRET);
  assert.equal('qrToken' in sanitizeForViewer(pickup, { userId: 'resident-2', role: 'resident' }), false);
  assert.equal('qrToken' in sanitizeForViewer(pickup, undefined), false, 'anonymous viewer');
});

test('sanitizer fails closed: qrToken without residentId is admin-only', () => {
  const orphan = { pickupId: 'x', qrToken: SECRET };
  assert.equal('qrToken' in sanitizeForViewer(orphan, { userId: 'x', role: 'resident' }), false);
  assert.equal(sanitizeForViewer(orphan, ADMIN).qrToken, SECRET);
});

// ---------------------------------------------------------------------------
// 2 + 3. Over HTTP
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

before(async () => {
  // Stub AWS: GetItem returns the pickup, UpdateItem (markPhotoQueued) returns it with the new
  // photo, HeadObject and SendMessage succeed. Everything above the SDK is the real code.
  mock.method(ddb, 'send', async (cmd: { constructor: { name: string }; input: { Key?: unknown } }) => {
    if (cmd.constructor.name === 'GetCommand') return { Item: structuredClone(pickup) };
    if (cmd.constructor.name === 'UpdateCommand') {
      return { Attributes: { ...structuredClone(pickup), photoKey: `pickups/${PICKUP_ID}/p.png`, mlStatus: 'queued' } };
    }
    throw new Error(`unexpected DynamoDB call ${cmd.constructor.name}`);
  });
  mock.method(s3, 'send', async () => ({}));
  mock.method(sqs, 'send', async () => ({ MessageId: 'm-1' }));

  // A route that deliberately returns a raw pickup without toPickupView: ok() must still strip it.
  const host = express();
  host.get('/forgetful', auth, (_req, res) => {
    ok(res, { pickup: structuredClone(pickup), pickups: [structuredClone(pickup)] });
  });
  host.use(app);
  server = host.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  mock.restoreAll();
});

async function call(method: string, path: string, viewer: AuthUser, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken(viewer)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text(), requestId: res.headers.get('x-request-id') };
}

const confirmBody = { pickupId: PICKUP_ID, key: `pickups/${PICKUP_ID}/p.png` };

test('POST /api/uploads/confirm never returns qrToken to the assigned collector', async () => {
  const r = await call('POST', '/api/uploads/confirm', COLLECTOR, confirmBody);
  assert.equal(r.status, 202, r.text);
  assert.equal(JSON.parse(r.text).data.mlStatus, 'queued');
  assert.equal(r.text.includes(SECRET), false, 'secret value leaked');
  assert.equal(/"qrToken"\s*:/.test(r.text), false, 'qrToken field leaked');
  assert.ok(r.requestId, 'every response carries an x-request-id');
});

test('POST /api/uploads/confirm still returns qrToken to the owning resident', async () => {
  const r = await call('POST', '/api/uploads/confirm', RESIDENT, confirmBody);
  assert.equal(r.status, 202, r.text);
  assert.equal(JSON.parse(r.text).data.qrToken, SECRET);
});

test('ok() strips qrToken even when a handler skips toPickupView', async () => {
  const r = await call('GET', '/forgetful', COLLECTOR);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.text.includes(SECRET), false);
  const forOwner = await call('GET', '/forgetful', RESIDENT);
  assert.equal(JSON.parse(forOwner.text).data.pickup.qrToken, SECRET);
});

// ---------------------------------------------------------------------------
// 4. Regression guard: handlers must respond through ok() (or next(err)), never res.json/send.
// ---------------------------------------------------------------------------

test('no handler bypasses ok() with res.json / res.send / res.end', () => {
  const dir = join(__dirname, '../../src/handlers');
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) =>
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .map((line, i) => ({ where: `${f}:${i + 1}`, line }))
        .filter(({ line }) => /\bres\s*\.\s*(json|send|end|jsonp|write)\s*\(/.test(line)),
    );
  assert.deepEqual(offenders, [], 'respond with ok() from utils/response so the sanitiser runs');
});
