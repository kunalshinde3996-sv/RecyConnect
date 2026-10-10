import type { Category, PickupStatus, Role } from '../api';

export const STATUS_LABEL: Record<PickupStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  collected: 'Collected',
  handed_off: 'Handed off',
  completed: 'Completed',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  plastic: 'Plastic',
  paper: 'Paper',
  mixed: 'Mixed',
};

export const ROLE_LABEL: Record<Role, string> = {
  resident: 'Resident',
  collector: 'Collector',
  admin: 'Admin',
};

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : dateTime.format(d);
}

export function formatKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined) return '-';
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
