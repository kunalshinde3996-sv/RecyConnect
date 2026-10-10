import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { s3, s3Presigner, sqs } from '../config/aws';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { log } from '../utils/logger';
import type { AuthUser, Pickup } from '../types';
import { markPhotoQueued, requireAccessiblePickup, serializePickup, setMlStatus } from './pickupService';

export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXTENSIONS: Record<AllowedContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const PRESIGN_TTL_SECONDS = 300;

/** Message contract between the API and the classifier worker. */
export interface ClassifyMessage {
  pickupId: string;
  key: string;
}

const keyPrefix = (pickupId: string) => `pickups/${pickupId}/`;

/** Step 1: client asks for a URL and PUTs the image straight to S3 (bytes never hit the API). */
export async function presignUpload(user: AuthUser, pickupId: string, contentType: AllowedContentType) {
  await requireAccessiblePickup(user, pickupId);
  const key = `${keyPrefix(pickupId)}${randomUUID()}.${EXTENSIONS[contentType]}`;
  const uploadUrl = await getSignedUrl(
    s3Presigner,
    new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, ContentType: contentType }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  return {
    uploadUrl,
    key,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    expiresIn: PRESIGN_TTL_SECONDS,
  };
}

const VIEW_TTL_SECONDS = 15 * 60;

/** Short-lived GET URL so the browser can display a private photo (the bucket stays private). */
export async function presignView(key: string): Promise<string> {
  return getSignedUrl(s3Presigner, new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }), {
    expiresIn: VIEW_TTL_SECONDS,
  });
}

/** Step 2: client confirms the upload; we record it and enqueue async classification. */
export async function confirmUpload(user: AuthUser, pickupId: string, key: string): Promise<Pickup> {
  const pickup = await requireAccessiblePickup(user, pickupId);
  if (!key.startsWith(keyPrefix(pickupId))) {
    throw AppError.badRequest('Key does not belong to this pickup');
  }

  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (err instanceof Error && err.name === 'NotFound')) {
      throw AppError.badRequest('No object found at that key; upload the file before confirming');
    }
    throw err;
  }

  const updated = await markPhotoQueued(pickup.pickupId, key);

  const message: ClassifyMessage = { pickupId: pickup.pickupId, key };
  try {
    await sqs.send(
      new SendMessageCommand({ QueueUrl: env.sqsQueueUrl, MessageBody: JSON.stringify(message) }),
    );
    log().info({ event: 'classification_queued', pickupId: pickup.pickupId, key }, 'photo queued for classification');
  } catch (err) {
    log().error({ event: 'classification_enqueue_failed', pickupId: pickup.pickupId, key, err }, 'failed to enqueue classification');
    await setMlStatus(pickup.pickupId, 'none').catch(() => undefined);
    throw new AppError(502, 'Photo saved but classification could not be queued; please retry confirm');
  }
  return serializePickup(updated);
}
