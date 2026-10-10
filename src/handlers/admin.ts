import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import * as adminService from '../services/adminService';
import * as alertService from '../services/alertService';
import { toPickupView } from '../services/pickupService';
import { PICKUP_STATUSES } from '../types';
import { ok } from '../utils/response';

const listQuery = z.object({ status: z.enum(PICKUP_STATUSES).optional() });
const alertParams = z.object({ id: z.string().regex(/^[\w-]{1,128}$/, 'invalid alert id') });

export const adminRouter = Router();
adminRouter.use(auth, requireRole('admin'));

adminRouter.get('/stats', async (_req, res) => {
  ok(res, await adminService.getStats());
});

adminRouter.get('/pickups', validate(listQuery, 'query'), async (req, res) => {
  const { status } = res.locals.validated.query as z.infer<typeof listQuery>;
  const pickups = await adminService.listPickups(status);
  ok(res, pickups.map((p) => toPickupView(p, req.user!)));
});

adminRouter.get('/collectors', async (_req, res) => {
  ok(res, await adminService.listCollectorsWithCounts());
});

adminRouter.get('/alerts', async (_req, res) => {
  ok(res, await alertService.listAlerts());
});

adminRouter.patch('/alerts/:id/read', validate(alertParams, 'params'), async (req, res) => {
  ok(res, await alertService.markRead(req.params.id as string));
});

adminRouter.post('/alerts/read-all', async (_req, res) => {
  ok(res, await alertService.markAllRead());
});
