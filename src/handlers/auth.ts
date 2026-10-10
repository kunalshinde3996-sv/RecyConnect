import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as userService from '../services/userService';
import { ok } from '../utils/response';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  phone: z.string().trim().max(20).optional(),
  // Admins cannot self-register; they are created by the seed script or directly in DynamoDB.
  role: z.enum(['resident', 'collector']).default('resident'),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), async (req, res) => {
  ok(res, await userService.register(req.body), 201);
});

authRouter.post('/login', validate(loginSchema), async (req, res) => {
  ok(res, await userService.login(req.body.email, req.body.password));
});

authRouter.get('/me', auth, async (req, res) => {
  const user = await userService.requireUser(req.user!.userId);
  ok(res, userService.toPublicUser(user));
});
