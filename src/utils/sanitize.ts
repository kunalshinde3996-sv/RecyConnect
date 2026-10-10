import type { AuthUser } from '../types';

/**
 * qrToken is the resident's proof-of-presence secret: the collector must scan it from the
 * resident's phone to mark a pickup collected. So it may only be shown to the resident who owns
 * the pickup and to admins.
 */
export function canSeeQrToken(viewer: AuthUser | undefined, pickup: { residentId?: unknown }): boolean {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  return viewer.role === 'resident' && typeof pickup.residentId === 'string' && viewer.userId === pickup.residentId;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/**
 * The single response sanitiser. `ok()` runs every response body through it, so no handler can
 * leak a qrToken, whatever shape it returns (a pickup, a list, a pickup nested in another object).
 *
 * Walks plain objects and arrays and drops any `qrToken` field the viewer may not see. An object
 * with a qrToken but no residentId is treated as unowned (admins only), so it fails closed.
 * Returns a copy; the input is never mutated.
 */
export function sanitizeForViewer<T>(data: T, viewer: AuthUser | undefined): T {
  if (Array.isArray(data)) return data.map((item) => sanitizeForViewer(item, viewer)) as T;
  if (!isPlainObject(data)) return data;

  const out: Record<string, unknown> = {};
  const hideQr = 'qrToken' in data && !canSeeQrToken(viewer, data);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'qrToken' && hideQr) continue;
    out[key] = sanitizeForViewer(value, viewer);
  }
  return out as T;
}
