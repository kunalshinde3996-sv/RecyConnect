import type { AuthUser } from '../types';
import { listByPickup } from './handoffService';
import { requireAccessiblePickup } from './pickupService';
import { getUserById } from './userService';

/** Full chain of custody for one pickup: status history (with actor names) + handoffs + ML result. */
export async function getTimeline(user: AuthUser, pickupId: string) {
  const pickup = await requireAccessiblePickup(user, pickupId);
  const handoffs = await listByPickup(pickupId);

  const actorIds = [...new Set(pickup.statusHistory.map((h) => h.by))];
  const actors = new Map(
    await Promise.all(
      actorIds.map(async (id) => {
        const u = await getUserById(id);
        return [id, u ? { name: u.name, role: u.role } : null] as const;
      }),
    ),
  );

  return {
    pickupId: pickup.pickupId,
    status: pickup.status,
    residentId: pickup.residentId,
    collectorId: pickup.collectorId ?? null,
    declaredCategory: pickup.declaredCategory,
    weightKg: pickup.weightKg ?? null,
    ml: {
      status: pickup.mlStatus,
      category: pickup.mlCategory ?? null,
      contamination: pickup.mlContamination ?? null,
      confidence: pickup.mlConfidence ?? null,
    },
    history: pickup.statusHistory.map((h) => ({ ...h, actor: actors.get(h.by) ?? null })),
    handoffs,
  };
}
