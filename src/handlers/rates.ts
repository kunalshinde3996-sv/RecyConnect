import { Router } from 'express';
import { RATES_DISCLAIMER, RATES_INR_PER_KG } from '../config/rates';
import { auth } from '../middleware/auth';
import { ok } from '../utils/response';

export const ratesRouter = Router();
ratesRouter.use(auth);

// Any role: residents use it for the live estimate on the request form.
ratesRouter.get('/', (_req, res) => {
  ok(res, { currency: 'INR', ratesPerKg: RATES_INR_PER_KG, disclaimer: RATES_DISCLAIMER });
});
