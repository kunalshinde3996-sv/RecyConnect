import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ALLOWED_CONTENT_TYPES, confirmUpload, presignUpload } from '../services/uploadService';
import { ok } from '../utils/response';

const presignSchema = z.object({
  pickupId: z.uuid(),
  contentType: z.enum(ALLOWED_CONTENT_TYPES, { message: 'contentType must be image/jpeg or image/png' }),
});

const confirmSchema = z.object({
  pickupId: z.uuid(),
  key: z.string().trim().min(1).max(512),
});

export const uploadsRouter = Router();
// Any role that can access the pickup (owning resident, assigned collector, admin) may upload.
uploadsRouter.use(auth);

uploadsRouter.post('/presign', validate(presignSchema), async (req, res) => {
  ok(res, await presignUpload(req.user!, req.body.pickupId, req.body.contentType));
});

uploadsRouter.post('/confirm', validate(confirmSchema), async (req, res) => {
  ok(res, await confirmUpload(req.user!, req.body.pickupId, req.body.key), 202);
});
