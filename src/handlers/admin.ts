import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import * as adminService from '../services/adminService';
import { PICKUP_STATUSES } from '../types';
import { ok } from '../utils/response';

const listQuery = z.object({ status: z.enum(PICKUP_STATUSES).optional() });

export const adminRouter = Router();
adminRouter.use(auth, requireRole('admin'));

adminRouter.get('/stats', async (_req, res) => {
  ok(res, await adminService.getStats());
});

adminRouter.get('/pickups', validate(listQuery, 'query'), async (_req, res) => {
  const { status } = res.locals.validated.query as z.infer<typeof listQuery>;
  ok(res, await adminService.listPickups(status));
});

adminRouter.get('/collectors', async (_req, res) => {
  ok(res, await adminService.listCollectorsWithCounts());
});
