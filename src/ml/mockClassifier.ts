import type { Category } from '../types';

/**
 * Contract every waste classifier must satisfy. The worker depends only on this interface,
 * so swapping the mock for a real model (SageMaker endpoint, Rekognition Custom Labels,
 * a container on Lambda, ...) means writing one new class and changing `getClassifier()`.
 */
export interface ClassifierInput {
  pickupId: string;
  /** What the resident said it is. A real model may ignore this or use it as a prior. */
  declaredCategory: Category;
  /** S3 location of the photo to classify. */
  image: { bucket: string; key: string };
}

export interface ClassificationResult {
  category: Category;
  /** True when the load appears to contain non-recyclable / contaminating material. */
  contamination: boolean;
  /** 0..1 */
  confidence: number;
}

export interface WasteClassifier {
  readonly name: string;
  classify(input: ClassifierInput): Promise<ClassificationResult>;
}

const CONTAMINATION_RATE = 0.15;
const MIN_CONFIDENCE = 0.7;
const MAX_CONFIDENCE = 0.95;

/**
 * Rule-based stand-in: echoes the declared category with a randomised confidence in
 * [0.7, 0.95] and flags contamination ~15% of the time. It never reads the image.
 * `random` is injectable so tests and the seed script can be deterministic.
 */
export class MockClassifier implements WasteClassifier {
  readonly name = 'mock-rule-based-v1';

  constructor(private readonly random: () => number = Math.random) {}

  async classify(input: ClassifierInput): Promise<ClassificationResult> {
    const confidence = MIN_CONFIDENCE + this.random() * (MAX_CONFIDENCE - MIN_CONFIDENCE);
    return {
      category: input.declaredCategory,
      contamination: this.random() < CONTAMINATION_RATE,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
}

/** Single place to choose the implementation (e.g. by env var once a real model exists). */
export function getClassifier(): WasteClassifier {
  return new MockClassifier();
}
