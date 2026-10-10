import { DeleteTableCommand, ResourceNotFoundException, waitUntilTableNotExists } from '@aws-sdk/client-dynamodb';
import { DeleteBucketCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DeleteQueueCommand } from '@aws-sdk/client-sqs';
import { DeleteTopicCommand, ListTopicsCommand } from '@aws-sdk/client-sns';
import { dynamoClient, s3, sns, sqs } from '../config/aws';
import { env } from '../config/env';
import { assertLocalStack, bootstrap, DLQ_NAME, existingQueueUrl, QUEUE_NAME, TOPIC_NAME } from './bootstrapLocal';
import { definitions } from './createTables';
import { assertLocalStackUp } from './localstackHealth';
import { seed } from './seed';

/**
 * npm run demo:reset: deletes every table, the bucket (and its photos), both queues and the
 * alerts topic in LocalStack, re-creates them, and re-seeds clean demo data.
 * Refuses to run without AWS_ENDPOINT, so it can never touch real AWS.
 */

async function deleteTables() {
  for (const { TableName } of definitions()) {
    try {
      await dynamoClient.send(new DeleteTableCommand({ TableName }));
      await waitUntilTableNotExists({ client: dynamoClient, maxWaitTime: 60 }, { TableName });
      console.log(`Deleted table ${TableName}`);
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
    }
  }
}

async function deleteBucket(bucket: string) {
  try {
    let ContinuationToken: string | undefined;
    let removed = 0;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }));
      const keys = (page.Contents ?? []).map(({ Key }) => ({ Key: Key! }));
      if (keys.length) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
        removed += keys.length;
      }
      ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    console.log(`Deleted bucket ${bucket} (${removed} object(s))`);
  } catch (err) {
    if ((err as Error).name !== 'NoSuchBucket') throw err;
  }
}

async function deleteQueues() {
  for (const name of [QUEUE_NAME, DLQ_NAME]) {
    const url = await existingQueueUrl(name);
    if (url) {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
      console.log(`Deleted queue ${name}`);
    }
  }
}

async function deleteTopic() {
  let NextToken: string | undefined;
  do {
    const page = await sns.send(new ListTopicsCommand({ NextToken }));
    for (const { TopicArn } of page.Topics ?? []) {
      if (TopicArn?.endsWith(`:${TOPIC_NAME}`)) {
        await sns.send(new DeleteTopicCommand({ TopicArn }));
        console.log(`Deleted topic ${TOPIC_NAME}`);
      }
    }
    NextToken = page.NextToken;
  } while (NextToken);
}

async function main() {
  assertLocalStack('demo:reset');
  await assertLocalStackUp();
  console.log(`Resetting LocalStack at ${env.awsEndpoint}\n`);

  await deleteTables();
  await deleteBucket(env.s3Bucket);
  await deleteQueues();
  await deleteTopic();

  console.log('\n--- Re-creating ---');
  await bootstrap();
  console.log('--- Seeding ---');
  await seed();
  console.log('\nDemo data reset. Start everything with: npm run demo');
}

main().catch((err) => {
  console.error('demo:reset failed:', err);
  process.exit(1);
});
