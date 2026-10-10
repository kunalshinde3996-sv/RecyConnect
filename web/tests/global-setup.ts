const API = (process.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

/** Fail fast with a useful message instead of a 2-minute timeout on the login page. */
export default async function globalSetup() {
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    throw new Error(`API not reachable at ${API}. Start it (and the worker) first: npm run dev + npm run worker, or npm run demo.`);
  }
}
