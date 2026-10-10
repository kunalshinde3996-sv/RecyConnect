import { app } from './app';
import { env } from './config/env';

// Fail fast on a missing JWT secret instead of on the first login request.
void env.jwtSecret;

app.listen(env.port, () => {
  console.log(`RecyConnect API listening on http://localhost:${env.port}`);
});
