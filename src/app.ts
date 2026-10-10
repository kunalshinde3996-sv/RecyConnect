import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { adminRouter } from './handlers/admin';
import { authRouter } from './handlers/auth';
import { handoffsRouter } from './handlers/handoffs';
import { pickupsRouter } from './handlers/pickups';
import { uploadsRouter } from './handlers/uploads';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { getHealth } from './services/healthService';
import { ok } from './utils/response';

/**
 * The Express app is the "Lambda (business logic)" box in the architecture. It never calls
 * listen(): server.ts does that locally, lambda.ts wraps it for API Gateway.
 * Express 5 forwards rejected promises from async handlers to errorHandler automatically.
 */
export const app = express();

app.disable('x-powered-by');
app.use(requestLogger);
app.use(cors({ origin: env.corsOrigin.split(',').map((o) => o.trim()) }));
app.use(express.json({ limit: '100kb' }));

// Liveness: the process is up. Cheap enough for a load balancer to hit every few seconds.
app.get('/health', (_req, res) => {
  ok(res, { status: 'ok' });
});

// Readiness: can we reach DynamoDB, S3, SQS and SNS? 503 if any configured dependency fails.
app.get('/api/health', async (_req, res) => {
  const health = await getHealth();
  ok(res, health, health.status === 'ok' ? 200 : 503);
});

app.use('/api/auth', authRouter);
app.use('/api/pickups', pickupsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/handoffs', handoffsRouter);
app.use('/api/admin', adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);
