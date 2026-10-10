import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { log, withLogContext } from '../utils/logger';

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_INCOMING_ID = /^[\w-]{1,64}$/;

/**
 * Gives every request an id (reusing a sane incoming X-Request-Id, e.g. API Gateway's), echoes
 * it in the response header, and binds it to every log line written while handling the request.
 * Logs one `request` line when the response finishes.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const reqId = typeof incoming === 'string' && VALID_INCOMING_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, reqId);
  const started = process.hrtime.bigint();

  withLogContext({ reqId }, () => {
    const reqLog = log();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      reqLog[level](
        {
          event: 'request',
          method: req.method,
          // originalUrl without the query string (it can contain filters, never secrets, but keep lines short)
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          userId: req.user?.userId,
          role: req.user?.role,
        },
        `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode}`,
      );
    });
    next();
  });
}
