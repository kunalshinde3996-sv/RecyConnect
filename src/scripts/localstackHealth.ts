import { env } from '../config/env';

const REQUIRED_SERVICES = ['dynamodb', 's3', 'sqs', 'sns'];

/**
 * Exits with a helpful message unless LocalStack answers on AWS_ENDPOINT with every service the
 * app needs. LocalStack reports each service as "available" (lazy, not started yet) or "running".
 */
export async function assertLocalStackUp(): Promise<void> {
  const endpoint = env.awsEndpoint!.replace(/\/$/, '');
  let services: Record<string, string>;
  try {
    const res = await fetch(`${endpoint}/_localstack/health`, { signal: AbortSignal.timeout(3000) });
    services = ((await res.json()) as { services?: Record<string, string> }).services ?? {};
  } catch {
    console.error(`LocalStack is not reachable at ${endpoint}. Start Docker, then run: npm run local:up`);
    process.exit(1);
  }
  const missing = REQUIRED_SERVICES.filter((s) => !['available', 'running'].includes(services[s]));
  if (missing.length) {
    console.error(
      `LocalStack at ${endpoint} is missing: ${missing.join(', ')}.\n` +
        'Recreate the container so it picks up SERVICES from docker-compose.yml: npm run local:down && npm run local:up',
    );
    process.exit(1);
  }
}
