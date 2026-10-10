import { randomUUID } from 'node:crypto';
import { BatchWriteCommand, type BatchWriteCommandInput, type BatchWriteCommandOutput } from '@aws-sdk/lib-dynamodb';
import { ddb, tables } from '../config/aws';
import { createUser, findUserByEmail } from '../services/userService';
import type { Category, Handoff, Pickup, PickupStatus, Role, StatusHistoryEntry, User } from '../types';

const PASSWORD = 'password123';

const SEED_USERS: { name: string; email: string; role: Role; phone: string }[] = [
  { name: 'Asha Admin', email: 'admin@recyconnect.dev', role: 'admin', phone: '+91-9000000001' },
  { name: 'Ravi Collector', email: 'ravi.collector@recyconnect.dev', role: 'collector', phone: '+91-9000000011' },
  { name: 'Meena Collector', email: 'meena.collector@recyconnect.dev', role: 'collector', phone: '+91-9000000012' },
  { name: 'Arjun Resident', email: 'arjun.resident@recyconnect.dev', role: 'resident', phone: '+91-9000000021' },
  { name: 'Priya Resident', email: 'priya.resident@recyconnect.dev', role: 'resident', phone: '+91-9000000022' },
  { name: 'Kabir Resident', email: 'kabir.resident@recyconnect.dev', role: 'resident', phone: '+91-9000000023' },
];

const ORDER: PickupStatus[] = ['pending', 'assigned', 'collected', 'handed_off', 'completed'];
const HOUR = 60 * 60 * 1000;

interface PickupSpec {
  resident: User;
  collector?: User;
  status: PickupStatus;
  category: Category;
  address: string;
  notes?: string;
  weightKg?: number;
  ml?: { contamination: boolean; confidence: number };
  facilityName?: string;
  daysAgo: number;
}

function buildPickup(spec: PickupSpec, admin: User): { pickup: Pickup; handoff?: Handoff } {
  const pickupId = randomUUID();
  const start = Date.now() - spec.daysAgo * 24 * HOUR;
  const at = (step: number) => new Date(start + step * 3 * HOUR).toISOString();

  // Replay the state machine so statusHistory is a valid chain of custody.
  const reached = ORDER.slice(0, ORDER.indexOf(spec.status) + 1);
  const actorFor = (s: PickupStatus) =>
    s === 'pending' ? spec.resident.userId : s === 'completed' ? admin.userId : spec.collector!.userId;
  const statusHistory: StatusHistoryEntry[] = reached.map((s, i) => ({ status: s, by: actorFor(s), at: at(i) }));
  const lastAt = statusHistory[statusHistory.length - 1].at;

  const photoKey = spec.ml ? `pickups/${pickupId}/seed-placeholder.jpg` : undefined;
  const pickup: Pickup = {
    pickupId,
    residentId: spec.resident.userId,
    // Omit collectorId (not null) when unassigned: it's a GSI key.
    ...(spec.collector ? { collectorId: spec.collector.userId } : {}),
    address: spec.address,
    notes: spec.notes,
    status: spec.status,
    qrToken: randomUUID(),
    declaredCategory: spec.category,
    mlStatus: spec.ml ? 'done' : 'none',
    ...(spec.ml
      ? { mlCategory: spec.category, mlContamination: spec.ml.contamination, mlConfidence: spec.ml.confidence }
      : {}),
    weightKg: spec.weightKg,
    photoKey,
    createdAt: at(0),
    updatedAt: lastAt,
    statusHistory,
  };

  let handoff: Handoff | undefined;
  if (spec.status === 'handed_off' || spec.status === 'completed') {
    const handedOffAt = statusHistory.find((h) => h.status === 'handed_off')!.at;
    const completed = statusHistory.find((h) => h.status === 'completed');
    handoff = {
      handoffId: randomUUID(),
      pickupId,
      collectorId: spec.collector!.userId,
      facilityName: spec.facilityName ?? 'GreenCycle MRF, Whitefield',
      confirmedByRecycler: Boolean(completed),
      confirmedAt: completed?.at,
      createdAt: handedOffAt,
    };
  }
  return { pickup, handoff };
}

async function batchPut(tableName: string, items: object[]) {
  for (let i = 0; i < items.length; i += 25) {
    let requests: BatchWriteCommandInput['RequestItems'] = {
      [tableName]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item: Item as Record<string, unknown> } })),
    };
    while (requests && Object.keys(requests).length) {
      const out: BatchWriteCommandOutput = await ddb.send(new BatchWriteCommand({ RequestItems: requests }));
      requests = out.UnprocessedItems;
    }
  }
}

function printCredentials() {
  console.log('\nLogin credentials (password for all: ' + PASSWORD + ')');
  console.table(SEED_USERS.map(({ role, name, email }) => ({ role, name, email, password: PASSWORD })));
}

async function main() {
  if (await findUserByEmail(SEED_USERS[0].email)) {
    console.log('Seed data already present (admin user exists); skipping inserts.');
    printCredentials();
    return;
  }

  console.log('Creating users...');
  const users: User[] = [];
  for (const u of SEED_USERS) {
    users.push(await createUser({ ...u, password: PASSWORD }));
  }
  const [admin, ravi, meena, arjun, priya, kabir] = users;

  const specs: PickupSpec[] = [
    {
      resident: arjun, status: 'pending', category: 'plastic', daysAgo: 0,
      address: '12 MG Road, Bengaluru 560001', notes: 'PET bottles, rinsed. Gate code 4521.',
    },
    {
      resident: priya, collector: ravi, status: 'assigned', category: 'paper', daysAgo: 1,
      address: '45 Indiranagar 100ft Rd, Bengaluru 560038', notes: 'Old newspapers and cartons',
    },
    {
      resident: kabir, collector: ravi, status: 'collected', category: 'mixed', daysAgo: 2,
      address: '8 Koramangala 5th Block, Bengaluru 560095', weightKg: 4.2,
      ml: { contamination: false, confidence: 0.81 },
    },
    {
      resident: arjun, collector: meena, status: 'handed_off', category: 'plastic', daysAgo: 3,
      address: '12 MG Road, Bengaluru 560001', weightKg: 7.5,
      ml: { contamination: false, confidence: 0.92 }, facilityName: 'GreenCycle MRF, Whitefield',
    },
    {
      resident: priya, collector: meena, status: 'completed', category: 'mixed', daysAgo: 5,
      address: '45 Indiranagar 100ft Rd, Bengaluru 560038', weightKg: 12.0,
      ml: { contamination: true, confidence: 0.74 }, facilityName: 'EcoLoop Recyclers, Peenya',
    },
    {
      resident: kabir, collector: ravi, status: 'completed', category: 'paper', daysAgo: 7,
      address: '8 Koramangala 5th Block, Bengaluru 560095', weightKg: 3.1,
      ml: { contamination: false, confidence: 0.88 }, facilityName: 'GreenCycle MRF, Whitefield',
    },
  ];

  const built = specs.map((s) => buildPickup(s, admin));
  console.log('Creating pickups and handoffs...');
  await batchPut(tables.pickups, built.map((b) => b.pickup));
  await batchPut(tables.handoffs, built.flatMap((b) => (b.handoff ? [b.handoff] : [])));

  console.log('\nPickups:');
  console.table(
    built.map(({ pickup }) => ({
      pickupId: pickup.pickupId,
      status: pickup.status,
      resident: users.find((u) => u.userId === pickup.residentId)!.name,
      collector: users.find((u) => u.userId === pickup.collectorId)?.name ?? '-',
      qrToken: pickup.qrToken,
    })),
  );
  printCredentials();
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
