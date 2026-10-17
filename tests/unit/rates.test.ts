import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATES_AS_OF, RATES_INR_PER_KG, RATES_SOURCE, rateFor, valueInr } from '../../src/config/rates';
import { CATEGORIES } from '../../src/types';

test('rateFor returns the Pune household scrap rate for every category', () => {
  for (const c of CATEGORIES) {
    assert.equal(rateFor(c), RATES_INR_PER_KG[c]);
    assert.ok(rateFor(c) >= 0, `${c} rate should not be negative`);
  }
  assert.equal(rateFor('plastic'), 10);
  assert.equal(rateFor('paper'), 10);
  assert.equal(rateFor('mixed'), 0); // unsorted waste has no buy-back value
  assert.equal(RATES_AS_OF, '17 Oct 2026');
  assert.match(RATES_SOURCE, /Kabadiwala/);
});

test('valueInr multiplies rate by kg and rounds to 2 decimals', () => {
  assert.equal(valueInr(12, 2.5), 30);
  assert.equal(valueInr(8, 0.333), 2.66);
  assert.equal(valueInr(5, 1.001), 5.01); // 5 * 1.001 = 5.004999999999999 in floating point; half-up gives 5.01
  assert.equal(valueInr(12, 2.675), 32.1);
  assert.equal(valueInr(12, 0.1), 1.2); // 12 * 0.1 = 1.2000000000000002 in floating point
  assert.equal(valueInr(5, 0), 0);
  assert.equal(valueInr(rateFor('mixed'), 7.5), 0);
});
