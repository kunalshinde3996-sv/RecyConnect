import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { confirmHandoff, createHandoff } from '../services/handoffService';
import { ok } from '../utils/response';

const createSchema = z.object({
  pickupId: z.uuid(),
  facilityName: z.string().trim().min(1).max(200),
  handoffPhotoKey: z.string().trim().min(1).max(512).optional(),
});

const idParams = z.object({ id: z.uuid() });

export const handoffsRouter = Router();
handoffsRouter.use(auth);

handoffsRouter.post('/', requireRole('collector'), validate(createSchema), async (req, res) => {
  ok(res, await createHandoff(req.user!.userId, req.body), 201);
});

// TODO: replace 'admin' with a dedicated 'recycler' role once recycling facilities get accounts.
handoffsRouter.patch('/:id/confirm', requireRole('admin'), validate(idParams, 'params'), async (req, res) => {
  ok(res, await confirmHandoff(req.params.id as string, req.user!.userId));
});
