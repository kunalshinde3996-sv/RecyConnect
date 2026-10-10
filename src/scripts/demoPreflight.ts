import { createServer } from 'node:net';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { dynamoClient, tables } from '../config/aws';
import { env } from '../config/env';
import { assertLocalStack } from './bootstrapLocal';
import { assertLocalStackUp } from './localstackHealth';

/**
 * Runs before `npm run demo` starts the API, worker and web app: checks LocalStack is up, the
 * resources exist, and the ports are free, so the demo fails fast with a clear message.
 */

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => server.close(() => resolve(true)))
      .listen(port);
  });
}

async function main() {
  assertLocalStack('npm run demo');
  await assertLocalStackUp();

  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: tables.alerts }));
  } catch {
    console.error(`Table ${tables.alerts} not found in LocalStack. Run: npm run demo:reset`);
    process.exit(1);
  }
  if (!env.snsTopicArn) {
    console.warn('Warning: SNS_TOPIC_ARN is not set in .env; alerts will be stored but not published to SNS.');
  }

  const busy: number[] = [];
  for (const port of [env.port, 5173]) if (!(await portFree(port))) busy.push(port);
  if (busy.length) {
    console.error(`Port(s) ${busy.join(', ')} already in use. Stop the running dev servers first.`);
    process.exit(1);
  }
  console.log(`LocalStack OK at ${env.awsEndpoint}. Starting API (:${env.port}), worker, missed-pickup job and web (:5173)...`);
}

main().catch((err) => {
  console.error('demo preflight failed:', err);
  process.exit(1);
});
