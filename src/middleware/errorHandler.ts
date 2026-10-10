import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { log } from '../utils/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Express identifies error middleware by arity, so all four params must stay.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Malformed JSON body' });
  }
  log().error({ event: 'unhandled_error', err }, 'unhandled error');
  return res.status(500).json({ success: false, message: 'Internal server error' });
}
