import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { env } from './env';

/**
 * Shared AWS SDK v3 clients (DynamoDB, S3, SQS, SNS). Credentials come from the default provider chain:
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY locally, the execution role on Lambda.
 * Clients are created once per container and reused across Lambda invocations.
 *
 * When AWS_ENDPOINT is set (LocalStack), every client is pointed at it with dummy
 * credentials. When it is unset, the clients are configured exactly as for real AWS.
 */
const region = env.region;
const endpoint = env.awsEndpoint;

export const isLocalStack = Boolean(endpoint);

const baseConfig = endpoint
  ? { region, endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }
  : { region };

export const dynamoClient = new DynamoDBClient(baseConfig);

export const ddb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

// Path-style (http://host:4566/bucket/key) because LocalStack can't serve virtual-hosted buckets on localhost.
export const s3 = new S3Client(endpoint ? { ...baseConfig, forcePathStyle: true } : baseConfig);

/**
 * Client used only to sign upload URLs, which the *browser* calls.
 * - With LocalStack the URL must be reachable from the browser (http://localhost:4566);
 *   AWS_PUBLIC_ENDPOINT overrides it if the API runs in Docker and AWS_ENDPOINT is internal.
 * - requestChecksumCalculation 'WHEN_REQUIRED': by default the SDK signs a CRC32 of the
 *   (empty) body into the presigned URL, and real S3 then rejects the browser's actual
 *   upload with BadDigest. PutObject doesn't require a checksum, so this omits it.
 */
const publicEndpoint = env.awsPublicEndpoint ?? endpoint;
export const s3Presigner = new S3Client({
  ...baseConfig,
  ...(publicEndpoint ? { endpoint: publicEndpoint, forcePathStyle: true } : {}),
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

export const sqs = new SQSClient(baseConfig);

export const sns = new SNSClient(baseConfig);

export const tables = {
  get users() {
    return env.tableUsers;
  },
  get pickups() {
    return env.tablePickups;
  },
  get handoffs() {
    return env.tableHandoffs;
  },
  get alerts() {
    return env.tableAlerts;
  },
};
