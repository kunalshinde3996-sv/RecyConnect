import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueDoesNotExist,
} from '@aws-sdk/client-sqs';
import { CreateTopicCommand } from '@aws-sdk/client-sns';
import { isLocalStack, s3, sns, sqs } from '../config/aws';
import { env } from '../config/env';
import { createTables } from './createTables';

/**
 * One-shot setup of everything the app needs inside LocalStack: S3 bucket (+CORS),
 * SQS queue with DLQ, SNS alerts topic, and the DynamoDB tables. Safe to run repeatedly.
 */

export const QUEUE_NAME = 'recy-classify-queue';
export const DLQ_NAME = 'recy-classify-dlq';
export const TOPIC_NAME = 'recy-alerts';
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

export async function existingQueueUrl(name: string): Promise<string | undefined> {
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

/** Refuses to run unless AWS_ENDPOINT is set, so local scripts can never touch real AWS. */
export function assertLocalStack(script: string): void {
  if (!isLocalStack) {
    console.error(`AWS_ENDPOINT is not set. ${script} only runs against LocalStack, never real AWS.`);
    process.exit(1);
  }
}

/** CreateTopic is idempotent: it returns the existing ARN if the topic is already there. */
async function ensureTopic(name: string): Promise<string> {
  const out = await sns.send(new CreateTopicCommand({ Name: name }));
  console.log(`SNS topic ${name} ready`);
  return out.TopicArn!;
}

export async function bootstrap(): Promise<{ queueUrl: string; topicArn: string }> {
  assertLocalStack('bootstrapLocal');
  console.log(`Bootstrapping LocalStack at ${env.awsEndpoint} (region ${env.region})
`);

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
  const topicArn = await ensureTopic(TOPIC_NAME);

  console.log('');
  await createTables();

  console.log(`
LocalStack is ready. Your .env should contain:

  SQS_QUEUE_URL=${queueUrl}
  SNS_TOPIC_ARN=${topicArn}
`);
  if (process.env.SQS_QUEUE_URL && process.env.SQS_QUEUE_URL !== queueUrl) {
    console.warn(`Note: your current SQS_QUEUE_URL (${process.env.SQS_QUEUE_URL}) differs from the above.`);
  }
  if (process.env.SNS_TOPIC_ARN !== topicArn) {
    console.warn(`Note: your current SNS_TOPIC_ARN (${process.env.SNS_TOPIC_ARN ?? 'unset'}) differs from the above; alerts won't be published to SNS.`);
  }
  return { queueUrl, topicArn };
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('bootstrapLocal failed:', err);
    process.exit(1);
  });
}
