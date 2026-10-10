import { tables } from '../config/aws';
import { PICKUP_STATUSES, type Pickup, type PickupStatus } from '../types';
import { scanAll } from './db';
import { listByCollector, listByStatus, serializePickup } from './pickupService';
import { listUsersByRole } from './userService';

/** Statuses at which waste has physically been weighed and taken from the resident. */
const COLLECTED_OR_LATER: PickupStatus[] = ['collected', 'handed_off', 'completed'];

export async function getStats() {
  const pickups = await scanAll<Pick<Pickup, 'status' | 'weightKg' | 'mlContamination' | 'mlStatus'>>({
    TableName: tables.pickups,
    ProjectionExpression: '#status, weightKg, mlContamination, mlStatus',
    ExpressionAttributeNames: { '#status': 'status' },
  });

  const byStatus = Object.fromEntries(PICKUP_STATUSES.map((s) => [s, 0])) as Record<PickupStatus, number>;
  let totalKgCollected = 0;
  let contaminationCount = 0;
  let mlQueued = 0;

  for (const p of pickups) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    if (COLLECTED_OR_LATER.includes(p.status) && typeof p.weightKg === 'number') {
      totalKgCollected += p.weightKg;
    }
    if (p.mlContamination === true) contaminationCount++;
    if (p.mlStatus === 'queued') mlQueued++;
  }

  return {
    totalPickups: pickups.length,
    byStatus,
    totalKgCollected: Math.round(totalKgCollected * 100) / 100,
    contaminationCount,
    mlQueued,
  };
}

export async function listPickups(status?: PickupStatus): Promise<Pickup[]> {
  if (status) return listByStatus(status);
  const items = await scanAll<Pickup>({ TableName: tables.pickups });
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(serializePickup);
}

export async function listCollectorsWithCounts() {
  const collectors = await listUsersByRole('collector');
  return Promise.all(
    collectors.map(async (c) => {
      const pickups = await listByCollector(c.userId);
      const count = (s: PickupStatus) => pickups.filter((p) => p.status === s).length;
      const totalKg = pickups
        .filter((p) => COLLECTED_OR_LATER.includes(p.status))
        .reduce((sum, p) => sum + (p.weightKg ?? 0), 0);
      return {
        ...c,
        assignedCount: count('assigned'),
        inTransitCount: count('collected') + count('handed_off'),
        completedCount: count('completed'),
        totalPickups: pickups.length,
        totalKgCollected: Math.round(totalKg * 100) / 100,
      };
    }),
  );
}
