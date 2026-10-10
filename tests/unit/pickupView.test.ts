import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSeeQrToken, toPickupView } from '../../src/services/pickupService';
import type { AuthUser, Pickup } from '../../src/types';

// qrToken must only ever reach the owning resident and admins. These tests pin that rule.

const RESIDENT_ID = 'resident-1';
const COLLECTOR_ID = 'collector-1';
const SECRET = 'qr-secret-1234';

const pickup: Pickup = {
  pickupId: 'pickup-1',
  residentId: RESIDENT_ID,
  collectorId: COLLECTOR_ID,
  address: '1 Test Lane',
  status: 'assigned',
  qrToken: SECRET,
  declaredCategory: 'plastic',
  mlStatus: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  statusHistory: [],
};

const owner: AuthUser = { userId: RESIDENT_ID, role: 'resident' };
const otherResident: AuthUser = { userId: 'resident-2', role: 'resident' };
const assignedCollector: AuthUser = { userId: COLLECTOR_ID, role: 'collector' };
const otherCollector: AuthUser = { userId: 'collector-2', role: 'collector' };
// A collector whose userId happens to equal the residentId must still not see it (role matters).
const collectorWithResidentsId: AuthUser = { userId: RESIDENT_ID, role: 'collector' };
const admin: AuthUser = { userId: 'admin-1', role: 'admin' };

test('owning resident and admin can see qrToken', () => {
  assert.equal(canSeeQrToken(owner, pickup), true);
  assert.equal(canSeeQrToken(admin, pickup), true);
  assert.equal(toPickupView(pickup, owner).qrToken, SECRET);
  assert.equal(toPickupView(pickup, admin).qrToken, SECRET);
});

for (const [label, viewer] of [
  ['assigned collector', assignedCollector],
  ['unassigned collector', otherCollector],
  ['collector sharing the resident userId', collectorWithResidentsId],
  ['a different resident', otherResident],
] as const) {
  test(`${label} never gets qrToken`, () => {
    assert.equal(canSeeQrToken(viewer, pickup), false);
    const view = toPickupView(pickup, viewer);
    assert.equal('qrToken' in view, false, 'qrToken key must be absent, not just empty');
    assert.equal(JSON.stringify(view).includes(SECRET), false, 'secret value must not appear anywhere');
  });
}

test('toPickupView keeps the other fields and normalises collectorId', () => {
  const unassigned = { ...pickup, collectorId: undefined };
  const view = toPickupView(unassigned, otherCollector);
  assert.equal(view.collectorId, null);
  assert.equal(view.pickupId, pickup.pickupId);
  assert.equal(view.address, pickup.address);
});

test('toPickupView does not mutate the stored pickup', () => {
  const copy = structuredClone(pickup);
  toPickupView(copy, assignedCollector);
  assert.equal(copy.qrToken, SECRET);
});
