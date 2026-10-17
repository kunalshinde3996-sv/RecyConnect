import type { Category } from '../types';

/**
 * PLACEHOLDER rates in INR per kg, used only to show residents an indicative value.
 * These are NOT real market rates; actual scrap prices vary by city, recycler and quality.
 */
export const RATES_INR_PER_KG: Record<Category, number> = {
  plastic: 12,
  paper: 8,
  mixed: 5,
};

export const RATES_DISCLAIMER =
  'Indicative estimate only. Actual value depends on the recycler, quality and contamination. No payment is made by this app.';

export function rateFor(category: Category): number {
  return RATES_INR_PER_KG[category];
}

/**
 * rate × kg, rounded half-up to 2 decimals (paise). toPrecision drops float noise first
 * (5 × 1.001 = 5.004999… in binary, which would otherwise round down to 5.00).
 */
export function valueInr(rate: number, kg: number): number {
  const paise = Number((rate * kg * 100).toPrecision(12));
  return Math.round(paise) / 100;
}
