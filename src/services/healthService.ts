import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { GetTopicAttributesCommand } from '@aws-sdk/client-sns';
import { dynamoClient, isLocalStack, s3, sns, sqs, tables } from '../config/aws';
import { env } from '../config/env';

const CHECK_TIMEOUT_MS = 3000;

export interface DependencyStatus {
  status: 'ok' | 'error' | 'not_configured';
  latencyMs?: number;
  /** Error class only (e.g. ResourceNotFoundException), never the message: this endpoint is public. */
  error?: string;
}

async function check(fn: (signal: AbortSignal) => Promise<unknown>): Promise<DependencyStatus> {
  const started = Date.now();
  try {
    await fn(AbortSignal.timeout(CHECK_TIMEOUT_MS));
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const code = (err as { code?: string }).code;
    const error =
      name === 'AbortError' || name === 'TimeoutError'
        ? 'Timeout'
        : name === 'AggregateError' || code === 'ECONNREFUSED' || code === 'ENOTFOUND'
          ? 'Unreachable' // connection refused / DNS failure
          : name;
    return { status: 'error', latencyMs: Date.now() - started, error };
  }
}

/**
 * Connectivity to every AWS dependency, checked in parallel with a 3 s timeout each.
 * DynamoDB: DescribeTable on each table. S3: HeadBucket. SQS: GetQueueAttributes. SNS: GetTopicAttributes.
 * SNS is optional (alerts are still stored without it), so `not_configured` doesn't fail the check.
 */
export async function getHealth() {
  const tableNames = [tables.users, tables.pickups, tables.handoffs, tables.alerts];
  const [dynamodb, s3Status, sqsStatus, snsStatus] = await Promise.all([
    check((abortSignal) =>
      Promise.all(tableNames.map((TableName) => dynamoClient.send(new DescribeTableCommand({ TableName }), { abortSignal }))),
    ),
    check((abortSignal) => s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }), { abortSignal })),
    check((abortSignal) =>
      sqs.send(new GetQueueAttributesCommand({ QueueUrl: env.sqsQueueUrl, AttributeNames: ['QueueArn'] }), { abortSignal }),
    ),
    env.snsTopicArn
      ? check((abortSignal) => sns.send(new GetTopicAttributesCommand({ TopicArn: env.snsTopicArn }), { abortSignal }))
      : Promise.resolve<DependencyStatus>({ status: 'not_configured' }),
  ]);

  const dependencies = { dynamodb, s3: s3Status, sqs: sqsStatus, sns: snsStatus };
  const healthy = Object.values(dependencies).every((d) => d.status !== 'error');
  return {
    status: healthy ? ('ok' as const) : ('degraded' as const),
    environment: isLocalStack ? 'localstack' : 'aws',
    region: env.region,
    dependencies,
  };
}
