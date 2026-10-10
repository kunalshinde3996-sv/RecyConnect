import type { SQSBatchResponse, SQSEvent, SQSHandler } from 'aws-lambda';
import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { sqs } from '../config/aws';
import { env } from '../config/env';
import { getClassifier, type WasteClassifier } from '../ml/mockClassifier';
import { getPickup, writeMlResult } from '../services/pickupService';
import type { ClassifyMessage } from '../services/uploadService';
import { raiseAlert } from '../services/alertService';
import { log } from '../utils/logger';

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
 * Every outcome is logged as one `worker_job` line with pickupId, outcome and durationMs.
 */
export async function processMessage(body: string, messageId?: string): Promise<void> {
  const startedAt = Date.now();
  let jobLog = log().child({ messageId });
  const done = (outcome: string, extra: Record<string, unknown> = {}, msg = outcome) =>
    jobLog.info({ event: 'worker_job', outcome, durationMs: Date.now() - startedAt, ...extra }, msg);

  let msg: ClassifyMessage;
  try {
    msg = parseMessage(body);
  } catch (err) {
    // Retrying a malformed message never helps; drop it (a DLQ would also catch this).
    jobLog.error({ event: 'worker_job', outcome: 'malformed', durationMs: Date.now() - startedAt, err }, 'dropping malformed message');
    return;
  }
  jobLog = jobLog.child({ pickupId: msg.pickupId });

  try {
    const pickup = await getPickup(msg.pickupId);
    if (!pickup) return done('pickup_not_found', {}, 'pickup not found; dropping message');
    if (pickup.photoKey !== msg.key) return done('stale', {}, 'stale message (photo replaced); skipping');

    const result = await classifier.classify({
      pickupId: pickup.pickupId,
      declaredCategory: pickup.declaredCategory,
      image: { bucket: env.s3Bucket, key: msg.key },
    });

    const written = await writeMlResult(pickup.pickupId, msg.key, result);
    if (!written) return done('discarded', {}, 'photo changed during classification; result discarded');

    done(
      'classified',
      { classifier: classifier.name, ...result },
      `${result.category}, contamination=${result.contamination}, confidence=${result.confidence}`,
    );
    if (result.contamination) {
      await raiseAlert({
        type: 'contamination',
        pickupId: pickup.pickupId,
        message: `Contamination flagged in ${result.category} pickup at ${pickup.address} (confidence ${Math.round(
          result.confidence * 100,
        )}%). Check before it reaches the recycler.`,
      });
    }
  } catch (err) {
    jobLog.error({ event: 'worker_job', outcome: 'failed', durationMs: Date.now() - startedAt, err }, 'job failed; will retry');
    throw err;
  }
}

/** Lambda entry point for the SQS trigger. Lambda deletes successful messages itself. */
export const handler: SQSHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of event.Records) {
    try {
      await processMessage(record.body, record.messageId);
    } catch {
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
    log().info({ event: 'worker_stopping' }, 'shutting down after current poll');
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  log().info({ event: 'worker_started', queueUrl, classifier: classifier.name }, 'polling for classification jobs');
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
          await processMessage(m.Body ?? '', m.MessageId);
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
        } catch {
          // Already logged by processMessage. Not deleted -> visible again after VisibilityTimeout, retried.
        }
      }
    } catch (err) {
      log().error({ event: 'worker_receive_failed', err }, 'receive failed; backing off 5s');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (require.main === module) {
  pollForever().catch((err) => {
    log().fatal({ err }, 'worker crashed');
    process.exit(1);
  });
}
