import { randomUUID } from 'node:crypto';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tables } from '../config/aws';
import { AppError } from '../utils/AppError';
import type { AuthUser, Category, Pickup, PickupStatus, StatusHistoryEntry } from '../types';
import { isConditionalCheckFailed, nowIso, queryAll } from './db';

/** The only legal forward move from each status. */
export const NEXT_STATUS: Record<PickupStatus, PickupStatus | null> = {
  pending: 'assigned',
  assigned: 'collected',
  collected: 'handed_off',
  handed_off: 'completed',
  completed: null,
};

/** Throws 409 unless `from -> to` is the single allowed next step. */
export function assertTransition(from: PickupStatus, to: PickupStatus): void {
  if (NEXT_STATUS[from] !== to) {
    throw AppError.conflict(`Invalid status transition: ${from} -> ${to}`);
  }
}

export function historyEntry(status: PickupStatus, by: string, at = nowIso()): StatusHistoryEntry {
  return { status, by, at };
}

/** API shape: collectorId is always present (null when unassigned). */
export function serializePickup(p: Pickup): Pickup {
  return { ...p, collectorId: p.collectorId ?? null };
}

/**
 * Builds an UpdateCommand input that moves a pickup `from -> to`, appends to statusHistory,
 * and applies any extra SET fields. The ConditionExpression re-checks the current status
 * server-side so concurrent requests can't both win (the loser gets a 409).
 */
export function buildTransitionUpdate(params: {
  pickupId: string;
  from: PickupStatus;
  to: PickupStatus;
  by: string;
  set?: Record<string, unknown>;
  extraCondition?: { expression: string; values: Record<string, unknown> };
}) {
  const { pickupId, from, to, by, set = {}, extraCondition } = params;
  assertTransition(from, to);
  const at = nowIso();

  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = {
    ':from': from,
    ':to': to,
    ':now': at,
    ':entry': [historyEntry(to, by, at)],
    ':empty': [],
  };
  const setParts = [
    '#status = :to',
    'updatedAt = :now',
    'statusHistory = list_append(if_not_exists(statusHistory, :empty), :entry)',
  ];
  Object.entries(set).forEach(([field, value], i) => {
    names[`#f${i}`] = field;
    values[`:v${i}`] = value;
    setParts.push(`#f${i} = :v${i}`);
  });

  let condition = 'attribute_exists(pickupId) AND #status = :from';
  if (extraCondition) {
    condition += ` AND (${extraCondition.expression})`;
    Object.assign(values, extraCondition.values);
  }

  return {
    TableName: tables.pickups,
    Key: { pickupId },
    UpdateExpression: `SET ${setParts.join(', ')}`,
    ConditionExpression: condition,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

async function runTransition(input: ReturnType<typeof buildTransitionUpdate>): Promise<Pickup> {
  try {
    const out = await ddb.send(new UpdateCommand({ ...input, ReturnValues: 'ALL_NEW' }));
    return serializePickup(out.Attributes as Pickup);
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw AppError.conflict('Pickup was modified by another request; reload and try again');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getPickup(pickupId: string): Promise<Pickup | undefined> {
  const out = await ddb.send(new GetCommand({ TableName: tables.pickups, Key: { pickupId } }));
  return out.Item as Pickup | undefined;
}

export async function requirePickup(pickupId: string): Promise<Pickup> {
  const pickup = await getPickup(pickupId);
  if (!pickup) throw AppError.notFound('Pickup not found');
  return pickup;
}

/** Residents see their own; collectors see what they're assigned; admins see everything. */
export function canAccessPickup(user: AuthUser, pickup: Pickup): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'resident') return pickup.residentId === user.userId;
  if (user.role === 'collector') return pickup.collectorId === user.userId;
  return false;
}

export async function requireAccessiblePickup(user: AuthUser, pickupId: string): Promise<Pickup> {
  const pickup = await requirePickup(pickupId);
  // 404 rather than 403 so callers can't probe for other users' pickup IDs.
  if (!canAccessPickup(user, pickup)) throw AppError.notFound('Pickup not found');
  return pickup;
}

const newestFirst = (a: Pickup, b: Pickup) => b.createdAt.localeCompare(a.createdAt);

export async function listByResident(residentId: string): Promise<Pickup[]> {
  const items = await queryAll<Pickup>({
    TableName: tables.pickups,
    IndexName: 'residentId-index',
    KeyConditionExpression: 'residentId = :id',
    ExpressionAttributeValues: { ':id': residentId },
    ScanIndexForward: false,
  });
  return items.sort(newestFirst).map(serializePickup);
}

export async function listByCollector(collectorId: string): Promise<Pickup[]> {
  const items = await queryAll<Pickup>({
    TableName: tables.pickups,
    IndexName: 'collectorId-index',
    KeyConditionExpression: 'collectorId = :id',
    ExpressionAttributeValues: { ':id': collectorId },
    ScanIndexForward: false,
  });
  return items.sort(newestFirst).map(serializePickup);
}

export async function listByStatus(status: PickupStatus): Promise<Pickup[]> {
  const items = await queryAll<Pickup>({
    TableName: tables.pickups,
    IndexName: 'status-index',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status },
    ScanIndexForward: false,
  });
  return items.sort(newestFirst).map(serializePickup);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreatePickupInput {
  address: string;
  notes?: string;
  declaredCategory: Category;
}

export async function createPickup(residentId: string, input: CreatePickupInput): Promise<Pickup> {
  const now = nowIso();
  // collectorId is deliberately omitted (not null): it's a GSI key, and DynamoDB rejects
  // NULL-typed index keys. Omitting it keeps collectorId-index sparse.
  const pickup: Pickup = {
    pickupId: randomUUID(),
    residentId,
    address: input.address,
    notes: input.notes,
    status: 'pending',
    qrToken: randomUUID(),
    declaredCategory: input.declaredCategory,
    mlStatus: 'none',
    createdAt: now,
    updatedAt: now,
    statusHistory: [historyEntry('pending', residentId, now)],
  };
  await ddb.send(
    new PutCommand({
      TableName: tables.pickups,
      Item: pickup,
      ConditionExpression: 'attribute_not_exists(pickupId)',
    }),
  );
  return serializePickup(pickup);
}

/** Collector claims a pending pickup. */
export async function assignPickup(pickupId: string, collectorId: string): Promise<Pickup> {
  const pickup = await requirePickup(pickupId);
  assertTransition(pickup.status, 'assigned');
  return runTransition(
    buildTransitionUpdate({
      pickupId,
      from: 'pending',
      to: 'assigned',
      by: collectorId,
      set: { collectorId },
    }),
  );
}

/** Collector scans the resident's QR code and records the weight. */
export async function collectPickup(
  pickupId: string,
  collectorId: string,
  input: { qrToken: string; weightKg: number },
): Promise<Pickup> {
  const pickup = await requirePickup(pickupId);
  if (pickup.collectorId !== collectorId) {
    throw AppError.forbidden('This pickup is not assigned to you');
  }
  assertTransition(pickup.status, 'collected');
  if (input.qrToken !== pickup.qrToken) {
    throw AppError.badRequest('QR token does not match this pickup');
  }
  return runTransition(
    buildTransitionUpdate({
      pickupId,
      from: 'assigned',
      to: 'collected',
      by: collectorId,
      set: { weightKg: input.weightKg },
      extraCondition: {
        expression: 'collectorId = :collector AND qrToken = :qr',
        values: { ':collector': collectorId, ':qr': input.qrToken },
      },
    }),
  );
}

/** Saves the uploaded photo key and marks ML classification as queued. */
export async function markPhotoQueued(pickupId: string, photoKey: string): Promise<Pickup> {
  const out = await ddb.send(
    new UpdateCommand({
      TableName: tables.pickups,
      Key: { pickupId },
      UpdateExpression:
        'SET photoKey = :key, mlStatus = :queued, updatedAt = :now REMOVE mlCategory, mlContamination, mlConfidence',
      ConditionExpression: 'attribute_exists(pickupId)',
      ExpressionAttributeValues: { ':key': photoKey, ':queued': 'queued', ':now': nowIso() },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return serializePickup(out.Attributes as Pickup);
}

export async function setMlStatus(pickupId: string, mlStatus: Pickup['mlStatus']): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tables.pickups,
      Key: { pickupId },
      UpdateExpression: 'SET mlStatus = :s, updatedAt = :now',
      ConditionExpression: 'attribute_exists(pickupId)',
      ExpressionAttributeValues: { ':s': mlStatus, ':now': nowIso() },
    }),
  );
}

/**
 * Called by the async worker. Only writes if the pickup still points at the photo that was
 * classified, so a stale message can't overwrite the result for a newer upload.
 * Returns false when the result was discarded as stale.
 */
export async function writeMlResult(
  pickupId: string,
  photoKey: string,
  result: { category: Category; contamination: boolean; confidence: number },
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tables.pickups,
        Key: { pickupId },
        UpdateExpression:
          'SET mlCategory = :cat, mlContamination = :cont, mlConfidence = :conf, mlStatus = :done, updatedAt = :now',
        ConditionExpression: 'attribute_exists(pickupId) AND photoKey = :key',
        ExpressionAttributeValues: {
          ':cat': result.category,
          ':cont': result.contamination,
          ':conf': result.confidence,
          ':done': 'done',
          ':now': nowIso(),
          ':key': photoKey,
        },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}
