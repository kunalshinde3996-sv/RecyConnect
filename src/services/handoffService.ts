import { randomUUID } from 'node:crypto';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tables } from '../config/aws';
import { AppError } from '../utils/AppError';
import type { Handoff } from '../types';
import { isConditionalCheckFailed, nowIso, queryAll } from './db';
import { assertTransition, buildTransitionUpdate, requirePickup } from './pickupService';

export async function getHandoff(handoffId: string): Promise<Handoff | undefined> {
  const out = await ddb.send(new GetCommand({ TableName: tables.handoffs, Key: { handoffId } }));
  return out.Item as Handoff | undefined;
}

export async function listByPickup(pickupId: string): Promise<Handoff[]> {
  const items = await queryAll<Handoff>({
    TableName: tables.handoffs,
    IndexName: 'pickupId-index',
    KeyConditionExpression: 'pickupId = :id',
    ExpressionAttributeValues: { ':id': pickupId },
  });
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Collector hands a collected pickup to a recycling facility. The handoff record and the
 * pickup status change are written in one transaction so the chain of custody can't diverge.
 */
export async function createHandoff(
  collectorId: string,
  input: { pickupId: string; facilityName: string; handoffPhotoKey?: string },
): Promise<Handoff> {
  const pickup = await requirePickup(input.pickupId);
  if (pickup.collectorId !== collectorId) {
    throw AppError.forbidden('This pickup is not assigned to you');
  }
  assertTransition(pickup.status, 'handed_off');
  if (input.handoffPhotoKey && !input.handoffPhotoKey.startsWith(`pickups/${pickup.pickupId}/`)) {
    throw AppError.badRequest('handoffPhotoKey does not belong to this pickup');
  }

  const handoff: Handoff = {
    handoffId: randomUUID(),
    pickupId: pickup.pickupId,
    collectorId,
    facilityName: input.facilityName,
    handoffPhotoKey: input.handoffPhotoKey,
    confirmedByRecycler: false,
    createdAt: nowIso(),
  };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tables.handoffs,
              Item: handoff,
              ConditionExpression: 'attribute_not_exists(handoffId)',
            },
          },
          {
            Update: buildTransitionUpdate({
              pickupId: pickup.pickupId,
              from: 'collected',
              to: 'handed_off',
              by: collectorId,
              extraCondition: { expression: 'collectorId = :collector', values: { ':collector': collectorId } },
            }),
          },
        ],
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw AppError.conflict('Pickup was modified by another request; reload and try again');
    }
    throw err;
  }
  return handoff;
}

/**
 * Recycling facility confirms receipt -> handoff confirmed, pickup completed.
 * TODO: introduce a 'recycler' role tied to a facility and require it here; in the
 * prototype an admin performs the confirmation on the recycler's behalf.
 */
export async function confirmHandoff(handoffId: string, confirmedBy: string): Promise<Handoff> {
  const handoff = await getHandoff(handoffId);
  if (!handoff) throw AppError.notFound('Handoff not found');
  if (handoff.confirmedByRecycler) throw AppError.conflict('Handoff is already confirmed');

  const pickup = await requirePickup(handoff.pickupId);
  assertTransition(pickup.status, 'completed');

  const confirmedAt = nowIso();
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tables.handoffs,
              Key: { handoffId },
              UpdateExpression: 'SET confirmedByRecycler = :true, confirmedAt = :at',
              ConditionExpression: 'attribute_exists(handoffId) AND confirmedByRecycler = :false',
              ExpressionAttributeValues: { ':true': true, ':false': false, ':at': confirmedAt },
            },
          },
          {
            Update: buildTransitionUpdate({
              pickupId: pickup.pickupId,
              from: 'handed_off',
              to: 'completed',
              by: confirmedBy,
            }),
          },
        ],
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw AppError.conflict('Handoff or pickup was modified by another request; reload and try again');
    }
    throw err;
  }
  return { ...handoff, confirmedByRecycler: true, confirmedAt };
}
