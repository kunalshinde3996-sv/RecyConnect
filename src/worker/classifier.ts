import type { SQSBatchResponse, SQSEvent, SQSHandler } from 'aws-lambda';
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { sqs } from '../config/aws';
import { env } from '../config/env';
import { getClassifier, type WasteClassifier } from '../ml/mockClassifier';
import { getPickup, writeMlResult } from '../services/pickupService';
import type { ClassifyMessage } from '../services/uploadService';

/**
 * Async classification worker: S3 -> SQS -> [this] -> ML classifier -> DynamoDB.
 *
 * Two entry points share processMessage():
 *  - `handler`: deploy as a Lambda with an SQS event source mapping
 *    (enable "Report batch item failures" so only failed messages are retried).
 *  - `npm run worker`: local long-polling loop for development.
 */

const classifier: WasteClassifier = getClassifier();

function parseMessage(body: string): ClassifyMessage {
  const parsed = JSON.parse(body) as Partial<ClassifyMessage>;
  if (typeof parsed.pickupId !== 'string' || typeof parsed.key !== 'string') {
    throw new Error(`Malformed message body: ${body}`);
  }
  return { pickupId: parsed.pickupId, key: parsed.key };
}

/**
 * Processes one message. Resolves when the message is done (including permanently
 * unprocessable cases that should be dropped); throws only for retryable failures.
 */
export async function processMessage(body: string): Promise<void> {
  let msg: ClassifyMessage;
  try {
    msg = parseMessage(body);
  } catch (err) {
    // Retrying a malformed message never helps; drop it (a DLQ would also catch this).
    console.error('[worker] dropping malformed message', err);
    return;
  }

  const pickup = await getPickup(msg.pickupId);
  if (!pickup) {
    console.warn(`[worker] pickup ${msg.pickupId} not found; dropping message`);
    return;
  }
  if (pickup.photoKey !== msg.key) {
    console.info(`[worker] stale message for ${msg.pickupId} (photo replaced); skipping`);
    return;
  }

  const result = await classifier.classify({
    pickupId: pickup.pickupId,
    declaredCategory: pickup.declaredCategory,
    image: { bucket: env.s3Bucket, key: msg.key },
  });

  const written = await writeMlResult(pickup.pickupId, msg.key, result);
  console.info(
    written
      ? `[worker] ${pickup.pickupId} -> ${result.category}, contamination=${result.contamination}, confidence=${result.confidence} (${classifier.name})`
      : `[worker] ${pickup.pickupId}: photo changed during classification; result discarded`,
  );
}

/** Lambda entry point for the SQS trigger. Lambda deletes successful messages itself. */
export const handler: SQSHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of event.Records) {
    try {
      await processMessage(record.body);
    } catch (err) {
      console.error(`[worker] failed message ${record.messageId}`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

/** Local dev: long-poll the queue, process, and delete each message on success. */
export async function pollForever(): Promise<void> {
  const queueUrl = env.sqsQueueUrl;
  let running = true;
  const stop = () => {
    console.log('\n[worker] shutting down after current poll...');
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`[worker] polling ${queueUrl} with classifier "${classifier.name}"`);
  while (running) {
    try {
      const out = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 60,
        }),
      );
      for (const m of out.Messages ?? []) {
        try {
          await processMessage(m.Body ?? '');
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
        } catch (err) {
          // Not deleted -> becomes visible again after VisibilityTimeout and is retried.
          console.error(`[worker] failed message ${m.MessageId}; will retry`, err);
        }
      }
    } catch (err) {
      console.error('[worker] receive failed; backing off 5s', err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (require.main === module) {
  pollForever().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
