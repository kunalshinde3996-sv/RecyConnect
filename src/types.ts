export const ROLES = ['resident', 'collector', 'admin'] as const;
// TODO: add a 'recycler' role so recycling facilities confirm handoffs themselves (admin does it in the prototype).
export type Role = (typeof ROLES)[number];

export const PICKUP_STATUSES = ['pending', 'assigned', 'collected', 'handed_off', 'completed'] as const;
export type PickupStatus = (typeof PICKUP_STATUSES)[number];

export const CATEGORIES = ['plastic', 'paper', 'mixed'] as const;
export type Category = (typeof CATEGORIES)[number];

export type MlStatus = 'none' | 'queued' | 'done';

export interface User {
  userId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  phone?: string;
  createdAt: string;
}

export type PublicUser = Omit<User, 'passwordHash'>;

export interface StatusHistoryEntry {
  status: PickupStatus;
  by: string;
  at: string;
}

export interface Pickup {
  pickupId: string;
  residentId: string;
  collectorId?: string | null;
  address: string;
  notes?: string;
  status: PickupStatus;
  qrToken: string;
  declaredCategory: Category;
  mlCategory?: Category;
  mlContamination?: boolean;
  mlConfidence?: number;
  mlStatus: MlStatus;
  weightKg?: number;
  photoKey?: string;
  createdAt: string;
  updatedAt: string;
  statusHistory: StatusHistoryEntry[];
}

export interface Handoff {
  handoffId: string;
  pickupId: string;
  collectorId: string;
  facilityName: string;
  handoffPhotoKey?: string;
  confirmedByRecycler: boolean;
  confirmedAt?: string;
  createdAt: string;
}

export interface AuthUser {
  userId: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
