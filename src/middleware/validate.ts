import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError';

type Source = 'body' | 'query' | 'params';

/**
 * Validates req[source] against a zod schema. For `body` the parsed (coerced/stripped)
 * value replaces the original; query/params are getter-only in Express 5, so the parsed
 * value is exposed on res.locals.validated instead.
 */
export function validate(schema: ZodType, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ');
      return next(AppError.badRequest(message));
    }
    if (source === 'body') {
      req.body = result.data;
    } else {
      res.locals.validated = { ...(res.locals.validated ?? {}), [source]: result.data };
    }
    return next();
  };
}
