import { ApiError, http } from './client';
import type {
  AdminStats,
  Alert,
  AlertsResponse,
  AuthResponse,
  Category,
  CollectorSummary,
  Handoff,
  Pickup,
  PickupStatus,
  PresignResponse,
  Timeline,
  User,
} from './types';

export { ApiError, errorMessage, API_URL } from './client';
export * from './types';

export const api = {
  auth: {
    login: (email: string, password: string) => http.post<AuthResponse>('/api/auth/login', { email, password }),
    register: (input: { name: string; email: string; password: string; phone?: string; role: 'resident' | 'collector' }) =>
      http.post<AuthResponse>('/api/auth/register', input),
    me: () => http.get<User>('/api/auth/me'),
  },

  pickups: {
    create: (input: { address: string; declaredCategory: Category; notes?: string }) =>
      http.post<Pickup>('/api/pickups', input),
    mine: () => http.get<Pickup[]>('/api/pickups/mine'),
    available: () => http.get<Pickup[]>('/api/pickups/available'),
    assigned: () => http.get<Pickup[]>('/api/pickups/assigned'),
    assign: (id: string) => http.patch<Pickup>(`/api/pickups/${id}/assign`),
    collect: (id: string, qrToken: string, weightKg: number) =>
      http.patch<Pickup>(`/api/pickups/${id}/collect`, { qrToken, weightKg }),
    timeline: (id: string) => http.get<Timeline>(`/api/pickups/${id}/timeline`),
  },

  uploads: {
    presign: (pickupId: string, contentType: 'image/jpeg' | 'image/png') =>
      http.post<PresignResponse>('/api/uploads/presign', { pickupId, contentType }),
    confirm: (pickupId: string, key: string) => http.post<Pickup>('/api/uploads/confirm', { pickupId, key }),
  },

  handoffs: {
    create: (pickupId: string, facilityName: string) =>
      http.post<Handoff>('/api/handoffs', { pickupId, facilityName }),
    confirm: (handoffId: string) => http.patch<Handoff>(`/api/handoffs/${handoffId}/confirm`),
  },

  admin: {
    stats: () => http.get<AdminStats>('/api/admin/stats'),
    pickups: (status?: PickupStatus) =>
      http.get<Pickup[]>(`/api/admin/pickups${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    collectors: () => http.get<CollectorSummary[]>('/api/admin/collectors'),
    alerts: () => http.get<AlertsResponse>('/api/admin/alerts'),
    markAlertRead: (alertId: string) => http.patch<Alert>(`/api/admin/alerts/${encodeURIComponent(alertId)}/read`),
    markAllAlertsRead: () => http.post<{ updated: number }>('/api/admin/alerts/read-all'),
  },
};

/**
 * Upload a photo straight to S3 via a presigned PUT, then tell the API so it queues ML.
 * The file bytes never pass through our API.
 */
export async function uploadPickupPhoto(pickupId: string, file: File): Promise<Pickup> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
    throw new ApiError('Please choose a JPEG or PNG image.', 400);
  }
  const presigned = await api.uploads.presign(pickupId, file.type);
  let put: Response;
  try {
    put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: presigned.headers, body: file });
  } catch {
    throw new ApiError('Upload to storage failed: network or CORS error.', 0);
  }
  if (!put.ok) throw new ApiError(`Upload to storage failed (${put.status}).`, put.status);
  return api.uploads.confirm(pickupId, presigned.key);
}
