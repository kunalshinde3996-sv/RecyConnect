import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import * as pickupService from '../services/pickupService';
import { getTimeline } from '../services/timelineService';
import { CATEGORIES, type AuthUser, type Pickup } from '../types';
import { ok } from '../utils/response';

const createSchema = z.object({
  address: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(1000).optional(),
  declaredCategory: z.enum(CATEGORIES),
});

const collectSchema = z.object({
  qrToken: z.string().trim().min(1),
  weightKg: z.number().positive().max(10_000),
});

const idParams = z.object({ id: z.uuid() });

// Every pickup in a response goes through toPickupView, which hides qrToken from anyone but the
// owning resident and admins (see pickupService.canSeeQrToken).
const view = (viewer: AuthUser) => (p: Pickup) => pickupService.toPickupView(p, viewer);

export const pickupsRouter = Router();
pickupsRouter.use(auth);

pickupsRouter.post('/', requireRole('resident'), validate(createSchema), async (req, res) => {
  const pickup = await pickupService.createPickup(req.user!.userId, req.body);
  ok(res, view(req.user!)(pickup), 201);
});

pickupsRouter.get('/mine', requireRole('resident'), async (req, res) => {
  const pickups = await pickupService.listByResident(req.user!.userId);
  ok(res, pickups.map(view(req.user!)));
});

pickupsRouter.get('/available', requireRole('collector'), async (req, res) => {
  const pickups = await pickupService.listByStatus('pending');
  ok(res, pickups.map(view(req.user!)));
});

pickupsRouter.get('/assigned', requireRole('collector'), async (req, res) => {
  const pickups = await pickupService.listByCollector(req.user!.userId);
  ok(res, pickups.map(view(req.user!)));
});

pickupsRouter.patch('/:id/assign', requireRole('collector'), validate(idParams, 'params'), async (req, res) => {
  const pickup = await pickupService.assignPickup(req.params.id as string, req.user!.userId);
  ok(res, view(req.user!)(pickup));
});

pickupsRouter.patch(
  '/:id/collect',
  requireRole('collector'),
  validate(idParams, 'params'),
  validate(collectSchema),
  async (req, res) => {
    const pickup = await pickupService.collectPickup(req.params.id as string, req.user!.userId, req.body);
    ok(res, view(req.user!)(pickup));
  },
);

pickupsRouter.get('/:id/timeline', validate(idParams, 'params'), async (req, res) => {
  ok(res, await getTimeline(req.user!, req.params.id as string));
});
