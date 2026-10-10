import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { ROLES, type AuthUser, type Role } from '../types';

export function signToken(user: AuthUser): string {
  return jwt.sign({ userId: user.userId, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Verifies `Authorization: Bearer <jwt>` and attaches req.user = { userId, role }. */
export function auth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    const { userId, role } = payload as { userId?: unknown; role?: unknown };
    if (typeof userId !== 'string' || !ROLES.includes(role as Role)) {
      return next(AppError.unauthorized('Invalid token payload'));
    }
    req.user = { userId, role: role as Role };
    return next();
  } catch {
    return next(AppError.unauthorized('Invalid or expired token'));
  }
}
