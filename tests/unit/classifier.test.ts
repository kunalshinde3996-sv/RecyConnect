import { test } from 'node:test';
import assert from 'node:assert/strict';

// Unit tests must never download the CLIP model.
process.env.CLASSIFIER = 'mock';

import { env } from '../../src/config/env';
import { MockClassifier, type ClassifierInput, type WasteClassifier } from '../../src/ml/mockClassifier';
import { FallbackClassifier, selectClassifier } from '../../src/ml/selectClassifier';
import { logger } from '../../src/utils/logger';

logger.level = 'silent';

const input: ClassifierInput = {
  pickupId: 'pickup-1',
  declaredCategory: 'paper',
  image: { bucket: 'unit-test-bucket', key: 'pickups/pickup-1/photo.png' },
};

const failing: WasteClassifier = {
  name: 'failing',
  classify: async () => {
    throw new Error('model download failed');
  },
};

const hanging: WasteClassifier = {
  name: 'hanging',
  classify: () => new Promise(() => {}),
};

test('CLASSIFIER=mock selects the mock only (no CLIP instance)', () => {
  assert.equal(env.classifier, 'mock');
  const { classifier, clip } = selectClassifier(env.classifier);
  assert.ok(classifier instanceof MockClassifier);
  assert.equal(clip, undefined);
});

test('mock result is tagged source: mock', async () => {
  const result = await new MockClassifier(() => 0.5).classify(input);
  assert.deepEqual(result, { category: 'paper', contamination: false, confidence: 0.83, source: 'mock' });
});

test('fallback uses the mock when the primary throws', async () => {
  const result = await new FallbackClassifier(failing, new MockClassifier(() => 0.5)).classify(input);
  assert.equal(result.source, 'mock');
  assert.equal(result.category, 'paper');
});

test('fallback uses the mock when the primary times out', async () => {
  const result = await new FallbackClassifier(hanging, new MockClassifier(() => 0.5), 20).classify(input);
  assert.equal(result.source, 'mock');
});

test('fallback returns the primary result when it succeeds', async () => {
  const primary: WasteClassifier = {
    name: 'ok',
    classify: async () => ({ category: 'plastic', contamination: true, confidence: 0.61, source: 'clip' }),
  };
  const result = await new FallbackClassifier(primary, new MockClassifier()).classify(input);
  assert.deepEqual(result, { category: 'plastic', contamination: true, confidence: 0.61, source: 'clip' });
});
