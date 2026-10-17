import { Router } from 'express';
import { RATES_AS_OF, RATES_DISCLAIMER, RATES_INR_PER_KG, RATES_SOURCE, RATES_SOURCE_LABEL } from '../config/rates';
import { auth } from '../middleware/auth';
import { ok } from '../utils/response';

export const ratesRouter = Router();
ratesRouter.use(auth);

// Any role: residents use it for the live estimate on the request form.
ratesRouter.get('/', (_req, res) => {
  ok(res, {
    currency: 'INR',
    ratesPerKg: RATES_INR_PER_KG,
    asOf: RATES_AS_OF,
    source: RATES_SOURCE,
    sourceLabel: RATES_SOURCE_LABEL,
    disclaimer: RATES_DISCLAIMER,
  });
});
