import type { Response } from 'express';
import { sanitizeForViewer } from './sanitize';

/**
 * The only way handlers send a success body. Every payload passes through sanitizeForViewer for
 * the authenticated user (if any), so a handler that forgets toPickupView still can't leak qrToken.
 * tests/unit/responseSanitizer.test.ts fails if a handler bypasses this with res.json/res.send.
 */
export function ok<T>(res: Response, data: T, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data: sanitizeForViewer(data, res.req.user) });
}
