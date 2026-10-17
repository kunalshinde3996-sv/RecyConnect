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

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234.5 -> "₹1,234.50" */
export function formatInr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '-';
  return inr.format(amount);
}

export const MIXED_NO_VALUE = 'Mixed waste has no buy-back value. Separate plastic and paper to earn.';

/** "Rates as of 17 Oct 2026 · The Kabadiwala, Pune (indicative)" */
export function ratesAsOfLine(rates: { asOf: string; sourceLabel: string }): string {
  return `Rates as of ${rates.asOf} · ${rates.sourceLabel} (indicative)`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
