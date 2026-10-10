import { QueryCommand, ScanCommand, type QueryCommandInput, type ScanCommandInput } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../config/aws';

/** Runs a Query and follows LastEvaluatedKey until all pages are read. */
export async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...((out.Items ?? []) as T[]));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * Full-table Scan with pagination. Fine for the prototype's admin views; replace with
 * pre-aggregated counters (e.g. DynamoDB Streams -> stats item) before data grows.
 */
export async function scanAll<T>(input: ScanCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(new ScanCommand({ ...input, ExclusiveStartKey }));
    items.push(...((out.Items ?? []) as T[]));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export function isConditionalCheckFailed(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'ConditionalCheckFailedException') return true;
  // TransactWriteItems reports per-item reasons inside TransactionCanceledException
  if (err.name === 'TransactionCanceledException') {
    const reasons = (err as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
    return reasons.some((r) => r.Code === 'ConditionalCheckFailed');
  }
  return false;
}

export const nowIso = () => new Date().toISOString();
