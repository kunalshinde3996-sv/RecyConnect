import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/**
 * Centralised, lazily-validated configuration. Values are read on access so that
 * scripts which only need a subset (e.g. createTables) don't fail on unrelated vars.
 */
export const env = {
  get port(): number {
    return Number(optional('PORT', '5000'));
  },
  get region(): string {
    return optional('AWS_REGION', 'ap-south-1');
  },
  /** LocalStack (or other emulator) endpoint. Unset = real AWS. */
  get awsEndpoint(): string | undefined {
    return process.env.AWS_ENDPOINT || undefined;
  },
  /** Browser-reachable endpoint for presigned URLs; defaults to AWS_ENDPOINT. */
  get awsPublicEndpoint(): string | undefined {
    return process.env.AWS_PUBLIC_ENDPOINT || undefined;
  },
  get jwtSecret(): string {
    return required('JWT_SECRET');
  },
  get jwtExpiresIn(): string {
    return optional('JWT_EXPIRES_IN', '7d');
  },
  get tableUsers(): string {
    return optional('TABLE_USERS', 'recy-users');
  },
  get tablePickups(): string {
    return optional('TABLE_PICKUPS', 'recy-pickups');
  },
  get tableHandoffs(): string {
    return optional('TABLE_HANDOFFS', 'recy-handoffs');
  },
  get tableAlerts(): string {
    return optional('TABLE_ALERTS', 'recy-alerts');
  },
  /** SNS topic for operational alerts. Unset = alerts are stored and logged but not published. */
  get snsTopicArn(): string | undefined {
    return process.env.SNS_TOPIC_ARN || undefined;
  },
  /** An assigned pickup not collected within this many minutes is reported as missed (0 = immediately, for tests). */
  get missedPickupMinutes(): number {
    const n = Number(optional('MISSED_PICKUP_MINUTES', '30'));
    return Number.isFinite(n) && n >= 0 ? n : 30;
  },
  get s3Bucket(): string {
    return required('S3_BUCKET');
  },
  get sqsQueueUrl(): string {
    return required('SQS_QUEUE_URL');
  },
  get corsOrigin(): string {
    return optional('CORS_ORIGIN', 'http://localhost:5173');
  },
};
