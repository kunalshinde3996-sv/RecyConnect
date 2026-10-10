import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueDoesNotExist,
} from '@aws-sdk/client-sqs';
import { isLocalStack, s3, sqs } from '../config/aws';
import { env } from '../config/env';
import { createTables } from './createTables';

/**
 * One-shot setup of everything the app needs inside LocalStack: S3 bucket (+CORS),
 * SQS queue with DLQ, and the DynamoDB tables. Safe to run repeatedly.
 */

const QUEUE_NAME = 'recy-classify-queue';
const DLQ_NAME = 'recy-classify-dlq';
const FRONTEND_ORIGIN = 'http://localhost:5173';

async function ensureBucket(bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`S3 bucket ${bucket} already exists, skipping create`);
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw err;
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        // us-east-1 is the only region that must NOT send a LocationConstraint.
        ...(env.region === 'us-east-1'
          ? {}
          : { CreateBucketConfiguration: { LocationConstraint: env.region as never } }),
      }),
    );
    console.log(`S3 bucket ${bucket} created`);
  }

  // Idempotent: PutBucketCors replaces the whole configuration.
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['PUT', 'GET'],
            AllowedOrigins: [FRONTEND_ORIGIN],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );
  console.log(`S3 CORS set (PUT/GET from ${FRONTEND_ORIGIN})`);
}

async function existingQueueUrl(name: string): Promise<string | undefined> {
  try {
    const out = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    return out.QueueUrl;
  } catch (err) {
    if (err instanceof QueueDoesNotExist || (err as Error).name === 'AWS.SimpleQueueService.NonExistentQueue') {
      return undefined;
    }
    throw err;
  }
}

async function ensureQueue(name: string, attributes: Record<string, string>): Promise<string> {
  const existing = await existingQueueUrl(name);
  if (existing) {
    console.log(`SQS queue ${name} already exists, skipping`);
    return existing;
  }
  const out = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
  console.log(`SQS queue ${name} created`);
  return out.QueueUrl!;
}

async function main() {
  if (!isLocalStack) {
    console.error('AWS_ENDPOINT is not set. bootstrapLocal only runs against LocalStack, never real AWS.');
    process.exit(1);
  }
  console.log(`Bootstrapping LocalStack at ${env.awsEndpoint} (region ${env.region})\n`);

  await ensureBucket(env.s3Bucket);

  const dlqUrl = await ensureQueue(DLQ_NAME, {});
  const dlqAttrs = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }),
  );
  const queueUrl = await ensureQueue(QUEUE_NAME, {
    VisibilityTimeout: '60',
    ReceiveMessageWaitTimeSeconds: '20',
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqAttrs.Attributes!.QueueArn, maxReceiveCount: 5 }),
  });

  console.log('');
  await createTables();

  console.log(`\nLocalStack is ready. Put this in your .env:\n\n  SQS_QUEUE_URL=${queueUrl}\n`);
  if (process.env.SQS_QUEUE_URL && process.env.SQS_QUEUE_URL !== queueUrl) {
    console.warn(`Note: your current SQS_QUEUE_URL (${process.env.SQS_QUEUE_URL}) differs from the above.`);
  }
}

main().catch((err) => {
  console.error('bootstrapLocal failed:', err);
  process.exit(1);
});
