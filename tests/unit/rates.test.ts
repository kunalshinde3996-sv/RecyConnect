import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATES_INR_PER_KG, rateFor, valueInr } from '../../src/config/rates';
import { CATEGORIES } from '../../src/types';

test('rateFor returns a positive placeholder rate for every category', () => {
  for (const c of CATEGORIES) {
    assert.equal(rateFor(c), RATES_INR_PER_KG[c]);
    assert.ok(rateFor(c) > 0, `${c} rate should be positive`);
  }
  assert.equal(rateFor('plastic'), 12);
  assert.equal(rateFor('paper'), 8);
  assert.equal(rateFor('mixed'), 5);
});

test('valueInr multiplies rate by kg and rounds to 2 decimals', () => {
  assert.equal(valueInr(12, 2.5), 30);
  assert.equal(valueInr(8, 0.333), 2.66);
  assert.equal(valueInr(5, 1.001), 5.01); // 5 * 1.001 = 5.004999999999999 in floating point; half-up gives 5.01
  assert.equal(valueInr(12, 2.675), 32.1);
  assert.equal(valueInr(12, 0.1), 1.2); // 12 * 0.1 = 1.2000000000000002 in floating point
  assert.equal(valueInr(5, 0), 0);
});
