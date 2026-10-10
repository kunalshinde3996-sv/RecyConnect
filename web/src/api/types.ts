// Mirrors the backend contracts in ../src (types.ts, services/*, handlers/*).

export type Role = 'resident' | 'collector' | 'admin';
export type PickupStatus = 'pending' | 'assigned' | 'collected' | 'handed_off' | 'completed';
export type Category = 'plastic' | 'paper' | 'mixed';
export type MlStatus = 'none' | 'queued' | 'done';

export const PICKUP_STATUSES: PickupStatus[] = ['pending', 'assigned', 'collected', 'handed_off', 'completed'];
export const CATEGORIES: Category[] = ['plastic', 'paper', 'mixed'];

export interface User {
  userId: string;
  name: string;
  email: string;
  role: Role;
  phone?: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface StatusHistoryEntry {
  status: PickupStatus;
  by: string;
  at: string;
}

export interface Pickup {
  pickupId: string;
  residentId: string;
  collectorId: string | null;
  address: string;
  notes?: string;
  status: PickupStatus;
  /** Only present in resident (/mine) and admin responses; stripped for collectors. */
  qrToken?: string;
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

export interface TimelineEntry extends StatusHistoryEntry {
  actor: { name: string; role: Role } | null;
}

export interface Timeline {
  pickupId: string;
  status: PickupStatus;
  residentId: string;
  collectorId: string | null;
  declaredCategory: Category;
  weightKg: number | null;
  /** Presigned GET URL (expires after ~15 min); null when no photo. */
  photoUrl: string | null;
  ml: {
    status: MlStatus;
    category: Category | null;
    contamination: boolean | null;
    confidence: number | null;
  };
  history: TimelineEntry[];
  handoffs: Handoff[];
}

export interface PresignResponse {
  uploadUrl: string;
  key: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
}

export interface AdminStats {
  totalPickups: number;
  byStatus: Record<PickupStatus, number>;
  totalKgCollected: number;
  contaminationCount: number;
  mlQueued: number;
}

export interface CollectorSummary extends User {
  assignedCount: number;
  inTransitCount: number;
  completedCount: number;
  totalPickups: number;
  totalKgCollected: number;
}
