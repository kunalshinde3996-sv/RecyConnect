import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { RawImage, ZeroShotImageClassificationPipeline } from '@huggingface/transformers';
import { s3 } from '../config/aws';
import type { Category } from '../types';
import { log } from '../utils/logger';
import type { ClassificationResult, ClassifierInput, WasteClassifier } from './mockClassifier';

const MODEL = 'Xenova/clip-vit-base-patch32';

const CATEGORY_LABELS: Record<string, Category> = {
  'a photo of plastic waste': 'plastic',
  'a photo of paper or cardboard waste': 'paper',
  'a photo of mixed household waste': 'mixed',
};

const CLEAN_LABEL = 'clean recyclable material';
const DIRTY_LABEL = 'dirty waste with food or liquid';
const CONTAMINATION_THRESHOLD = 0.6;

/**
 * Zero-shot CLIP: scores the photo against text prompts. It was not trained on waste data,
 * so results are indicative only. The model (~600 MB) is downloaded on first use, cached on disk,
 * and loaded once per process. The worker wraps this in a fallback to MockClassifier.
 */
export class ClipClassifier implements WasteClassifier {
  readonly name = `clip-zero-shot (${MODEL})`;
  private pipe?: Promise<ZeroShotImageClassificationPipeline>;

  /** Lazily loads the model once. A failed load is forgotten so the next call retries. */
  load(): Promise<ZeroShotImageClassificationPipeline> {
    this.pipe ??= (async () => {
      const startedAt = Date.now();
      // Dynamic import keeps onnxruntime out of processes that only use the mock (API, unit tests).
      const { pipeline } = await import('@huggingface/transformers');
      const p = (await pipeline('zero-shot-image-classification', MODEL)) as ZeroShotImageClassificationPipeline;
      log().info({ event: 'clip_model_loaded', model: MODEL, durationMs: Date.now() - startedAt }, 'CLIP model ready');
      return p;
    })().catch((err) => {
      this.pipe = undefined;
      throw err;
    });
    return this.pipe;
  }

  async classify(input: ClassifierInput): Promise<ClassificationResult> {
    const [classify, image] = await Promise.all([this.load(), readImage(input.image)]);

    const categories = await classify(image, Object.keys(CATEGORY_LABELS));
    const top = categories[0];
    const dirt = await classify(image, [CLEAN_LABEL, DIRTY_LABEL]);
    const dirtyScore = dirt.find((r) => r.label === DIRTY_LABEL)?.score ?? 0;

    return {
      category: CATEGORY_LABELS[top.label],
      contamination: dirtyScore > CONTAMINATION_THRESHOLD,
      confidence: Math.round(top.score * 100) / 100,
      source: 'clip',
    };
  }
}

/** Reads the photo with the worker's own S3 client (internal endpoint), not a browser-facing URL. */
async function readImage({ bucket, key }: ClassifierInput['image']): Promise<RawImage> {
  const { RawImage } = await import('@huggingface/transformers');
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw new Error(`Empty S3 object: ${key}`);
  const bytes = await out.Body.transformToByteArray();
  return RawImage.fromBlob(new Blob([bytes], { type: out.ContentType ?? 'image/jpeg' }));
}
