import type { AuthUser } from '../types';
import { listByPickup } from './handoffService';
import { requireAccessiblePickup } from './pickupService';
import { presignView } from './uploadService';
import { getUserById } from './userService';

/**
 * Full chain of custody for one pickup: status history (with actor names), handoffs, ML result,
 * and a short-lived photoUrl (presigned GET) so clients can display the private S3 photo.
 */
export async function getTimeline(user: AuthUser, pickupId: string) {
  const pickup = await requireAccessiblePickup(user, pickupId);
  const [handoffs, photoUrl] = await Promise.all([
    listByPickup(pickupId),
    pickup.photoKey ? presignView(pickup.photoKey) : Promise.resolve(null),
  ]);

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
    photoUrl,
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
