import { randomUUID } from 'node:crypto';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tables } from '../config/aws';
import { getNotifier } from '../notify/notifier';
import type { Alert, AlertType } from '../types';
import { AppError } from '../utils/AppError';
import { log } from '../utils/logger';
import { isConditionalCheckFailed, nowIso, scanAll } from './db';

export interface RaiseAlertInput {
  type: AlertType;
  pickupId: string;
  message: string;
  /**
   * Fixed alertId for alerts that must fire at most once (e.g. one missed-pickup alert per
   * pickup, however often the job runs). Omit for a fresh random id.
   */
  dedupeId?: string;
}

/**
 * Stores the alert in recy-alerts, then publishes it through the notifier (SNS).
 *
 * Alerts are side effects of state changes that have already committed, so this never throws:
 * a failure is logged and the caller carries on. Returns the alert, or null if it wasn't raised
 * (duplicate dedupeId, or the store failed). If only the publish fails, the alert is still
 * stored and visible on the dashboard.
 */
export async function raiseAlert(input: RaiseAlertInput): Promise<Alert | null> {
  const alert: Alert = {
    alertId: input.dedupeId ?? randomUUID(),
    type: input.type,
    pickupId: input.pickupId,
    message: input.message,
    createdAt: nowIso(),
    read: false,
  };
  const alertLog = log().child({ alertId: alert.alertId, type: alert.type, pickupId: alert.pickupId });

  try {
    await ddb.send(
      new PutCommand({
        TableName: tables.alerts,
        Item: alert,
        ConditionExpression: 'attribute_not_exists(alertId)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      alertLog.debug({ event: 'alert_duplicate' }, 'alert already raised; skipping');
    } else {
      alertLog.error({ event: 'alert_store_failed', err }, 'could not store alert');
    }
    return null;
  }

  const notifier = getNotifier();
  try {
    await notifier.publish(alert);
    alertLog.info({ event: 'alert_published', notifier: notifier.name }, alert.message);
  } catch (err) {
    alertLog.error({ event: 'alert_publish_failed', notifier: notifier.name, err }, 'alert stored but not published');
  }
  return alert;
}

/** Newest first. Scan is fine at prototype scale (see db.scanAll). */
export async function listAlerts(limit = 50): Promise<{ alerts: Alert[]; unreadCount: number }> {
  const all = await scanAll<Alert>({ TableName: tables.alerts });
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { alerts: all.slice(0, limit), unreadCount: all.filter((a) => !a.read).length };
}

export async function markRead(alertId: string): Promise<Alert> {
  try {
    const out = await ddb.send(
      new UpdateCommand({
        TableName: tables.alerts,
        Key: { alertId },
        UpdateExpression: 'SET #read = :true',
        ConditionExpression: 'attribute_exists(alertId)',
        ExpressionAttributeNames: { '#read': 'read' },
        ExpressionAttributeValues: { ':true': true },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return out.Attributes as Alert;
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw AppError.notFound('Alert not found');
    throw err;
  }
}

export async function markAllRead(): Promise<{ updated: number }> {
  const unread = await scanAll<Pick<Alert, 'alertId'>>({
    TableName: tables.alerts,
    ProjectionExpression: 'alertId',
    FilterExpression: '#read = :false',
    ExpressionAttributeNames: { '#read': 'read' },
    ExpressionAttributeValues: { ':false': false },
  });
  await Promise.all(unread.map((a) => markRead(a.alertId).catch(() => undefined)));
  return { updated: unread.length };
}
