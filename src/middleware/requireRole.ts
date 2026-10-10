import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import type { Role } from '../types';

/** Must be mounted after `auth`. Rejects with 403 unless req.user.role is one of `roles`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    return next();
  };
}
