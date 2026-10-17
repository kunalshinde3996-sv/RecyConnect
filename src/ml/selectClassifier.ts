import { log } from '../utils/logger';
import { ClipClassifier } from './clipClassifier';
import { MockClassifier, type ClassificationResult, type ClassifierInput, type WasteClassifier } from './mockClassifier';

export const CLIP_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`classifier timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Tries the primary classifier; on any error or timeout logs a warning and uses the fallback.
 * The model must never crash the worker, so only a fallback failure can reject.
 */
export class FallbackClassifier implements WasteClassifier {
  readonly name: string;

  constructor(
    private readonly primary: WasteClassifier,
    private readonly fallback: WasteClassifier,
    private readonly timeoutMs = CLIP_TIMEOUT_MS,
  ) {
    this.name = `${primary.name} (fallback: ${fallback.name})`;
  }

  async classify(input: ClassifierInput): Promise<ClassificationResult> {
    try {
      return await withTimeout(this.primary.classify(input), this.timeoutMs);
    } catch (err) {
      log().warn(
        { event: 'classifier_fallback', pickupId: input.pickupId, primary: this.primary.name, err },
        `${this.primary.name} failed; using ${this.fallback.name}`,
      );
      return this.fallback.classify(input);
    }
  }
}

/** CLASSIFIER=mock -> mock only; otherwise (default) CLIP with mock fallback. */
export function selectClassifier(kind: 'clip' | 'mock'): { classifier: WasteClassifier; clip?: ClipClassifier } {
  if (kind === 'mock') return { classifier: new MockClassifier() };
  const clip = new ClipClassifier();
  return { classifier: new FallbackClassifier(clip, new MockClassifier()), clip };
}
