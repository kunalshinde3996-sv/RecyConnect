import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';

// Fail fast on a missing JWT secret instead of on the first login request.
void env.jwtSecret;

app.listen(env.port, () => {
  logger.info({ event: 'api_started', port: env.port }, `RecyConnect API listening on http://localhost:${env.port}`);
});
