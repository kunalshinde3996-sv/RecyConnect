import { env } from '../config/env';
import { raiseAlert } from '../services/alertService';
import { listByStatus } from '../services/pickupService';
import { getUserById } from '../services/userService';
import type { Pickup } from '../types';
import { log, withLogContext } from '../utils/logger';

/**
 * Missed-pickup check: finds pickups that have been `assigned` for longer than
 * MISSED_PICKUP_MINUTES (default 30) without being collected, and raises one alert per pickup.
 *
 * Entry points:
 *  - `handler`: deploy as a Lambda on an EventBridge schedule (e.g. rate(5 minutes)).
 *  - `npm run job:missed`: run once locally. Add `-- --watch` to repeat every
 *    MISSED_PICKUP_INTERVAL_SECONDS (default 60), standing in for the schedule.
 *
 * Re-running is safe: the alert id is derived from the pickup, so each pickup alerts once.
 */

/** When the pickup entered `assigned` (the latest such history entry). */
export function assignedAt(pickup: Pick<Pickup, 'statusHistory' | 'updatedAt'>): string {
  const entry = [...pickup.statusHistory].reverse().find((h) => h.status === 'assigned');
  return entry?.at ?? pickup.updatedAt;
}

/** Pure selection logic, exported for tests. */
export function findMissed(pickups: Pickup[], thresholdMinutes: number, now = Date.now()) {
  return pickups
    .filter((p) => p.status === 'assigned')
    .map((p) => ({ pickup: p, minutesAssigned: Math.floor((now - Date.parse(assignedAt(p))) / 60_000) }))
    .filter(({ minutesAssigned }) => minutesAssigned >= thresholdMinutes);
}

export async function checkMissedPickups(thresholdMinutes = env.missedPickupMinutes) {
  const startedAt = Date.now();
  const assigned = await listByStatus('assigned');
  const missed = findMissed(assigned, thresholdMinutes);

  let alerted = 0;
  for (const { pickup, minutesAssigned } of missed) {
    const collector = pickup.collectorId ? await getUserById(pickup.collectorId) : undefined;
    const alert = await raiseAlert({
      type: 'missed_pickup',
      pickupId: pickup.pickupId,
      dedupeId: `missed-${pickup.pickupId}`,
      message: `Pickup at ${pickup.address} was assigned to ${collector?.name ?? 'a collector'} ${formatAge(
        minutesAssigned,
      )} ago and has not been collected (threshold ${thresholdMinutes} min).`,
    });
    if (alert) alerted++;
  }

  const summary = { checked: assigned.length, overdue: missed.length, newAlerts: alerted, thresholdMinutes };
  log().info({ event: 'job_missed_pickups', durationMs: Date.now() - startedAt, ...summary }, 'missed-pickup check done');
  return summary;
}

function formatAge(minutes: number): string {
  if (minutes < 120) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} days`;
}

/** Lambda entry point for an EventBridge scheduled rule. */
export const handler = async () => withLogContext({ job: 'missedPickups' }, () => checkMissedPickups());

if (require.main === module) {
  const watch = process.argv.includes('--watch');
  const intervalMs = Math.max(5, Number(process.env.MISSED_PICKUP_INTERVAL_SECONDS) || 60) * 1000;
  const runOnce = () =>
    withLogContext({ job: 'missedPickups' }, () => checkMissedPickups()).catch((err) => {
      log().error({ event: 'job_missed_pickups_failed', err }, 'missed-pickup check failed');
      if (!watch) process.exit(1);
    });

  void runOnce().then(() => {
    if (watch) {
      log().info({ event: 'job_watch', intervalMs }, 'missed-pickup check repeating');
      setInterval(() => void runOnce(), intervalMs);
    }
  });
}
