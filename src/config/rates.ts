import type { Category } from '../types';

/**
 * Household scrap buy-back rates in INR per kg, used only to show residents an indicative value.
 * Source: https://www.thekabadiwala.com/scrap-rates/Pune (checked 17 Oct 2026; the page shows no date).
 *  - plastic: "Mix Plastic" ₹10 (PET bottles fetch more, hard plastic less)
 *  - paper: "Carton" / "White Paper" ₹10 (newspaper ₹11, magazines ₹8)
 *  - mixed: "Other" ₹0; unsorted waste has no buy-back value
 * Prices vary by recycler, quality and quantity. Update RATES_AS_OF when you change these.
 */
export const RATES_INR_PER_KG: Record<Category, number> = {
  plastic: 10,
  paper: 10,
  mixed: 0,
};

export const RATES_AS_OF = '17 Oct 2026';
export const RATES_SOURCE = 'The Kabadiwala, Pune household scrap price list';
/** Short form for the UI line "Rates as of … · The Kabadiwala, Pune (indicative)". */
export const RATES_SOURCE_LABEL = 'The Kabadiwala, Pune';

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
