import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import * as pickupService from '../services/pickupService';
import { getTimeline } from '../services/timelineService';
import { CATEGORIES, type Pickup } from '../types';
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

/**
 * qrToken is the resident's proof-of-presence secret (shown as a QR code on their phone).
 * Collectors must scan it, so it is never included in collector-facing responses.
 */
const withoutQr = ({ qrToken: _qr, ...rest }: Pickup) => rest;

export const pickupsRouter = Router();
pickupsRouter.use(auth);

pickupsRouter.post('/', requireRole('resident'), validate(createSchema), async (req, res) => {
  ok(res, await pickupService.createPickup(req.user!.userId, req.body), 201);
});

pickupsRouter.get('/mine', requireRole('resident'), async (req, res) => {
  ok(res, await pickupService.listByResident(req.user!.userId));
});

pickupsRouter.get('/available', requireRole('collector'), async (_req, res) => {
  const pickups = await pickupService.listByStatus('pending');
  ok(res, pickups.map(withoutQr));
});

pickupsRouter.get('/assigned', requireRole('collector'), async (req, res) => {
  const pickups = await pickupService.listByCollector(req.user!.userId);
  ok(res, pickups.map(withoutQr));
});

pickupsRouter.patch('/:id/assign', requireRole('collector'), validate(idParams, 'params'), async (req, res) => {
  const pickup = await pickupService.assignPickup(req.params.id as string, req.user!.userId);
  ok(res, withoutQr(pickup));
});

pickupsRouter.patch(
  '/:id/collect',
  requireRole('collector'),
  validate(idParams, 'params'),
  validate(collectSchema),
  async (req, res) => {
    const pickup = await pickupService.collectPickup(req.params.id as string, req.user!.userId, req.body);
    ok(res, withoutQr(pickup));
  },
);

pickupsRouter.get('/:id/timeline', validate(idParams, 'params'), async (req, res) => {
  ok(res, await getTimeline(req.user!, req.params.id as string));
});
