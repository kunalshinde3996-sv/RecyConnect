import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignedAt, findMissed } from '../../src/jobs/missedPickups';
import type { Pickup, PickupStatus } from '../../src/types';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function pickup(id: string, status: PickupStatus, assignedMinutesAgo: number): Pickup {
  return {
    pickupId: id,
    residentId: 'r',
    collectorId: 'c',
    address: `${id} Street`,
    status,
    qrToken: 'q',
    declaredCategory: 'paper',
    mlStatus: 'none',
    createdAt: minutesAgo(assignedMinutesAgo + 10),
    updatedAt: minutesAgo(assignedMinutesAgo),
    statusHistory: [
      { status: 'pending', by: 'r', at: minutesAgo(assignedMinutesAgo + 10) },
      { status: 'assigned', by: 'c', at: minutesAgo(assignedMinutesAgo) },
    ],
  };
}

test('flags assigned pickups at or past the threshold only', () => {
  const missed = findMissed(
    [pickup('fresh', 'assigned', 5), pickup('edge', 'assigned', 30), pickup('old', 'assigned', 600)],
    30,
    NOW,
  );
  assert.deepEqual(
    missed.map((m) => [m.pickup.pickupId, m.minutesAssigned]),
    [
      ['edge', 30],
      ['old', 600],
    ],
  );
});

test('ignores pickups that are no longer assigned', () => {
  assert.equal(findMissed([pickup('done', 'collected', 600)], 30, NOW).length, 0);
});

test('assignedAt uses the assignment time, not when the pickup was requested', () => {
  assert.equal(assignedAt(pickup('p', 'assigned', 45)), minutesAgo(45));
});
