import type { Timeline } from '../api';
import { CATEGORY_LABEL } from '../lib/format';
import { Spinner } from './States';

export function ContaminationBadge({ contaminated }: { contaminated: boolean }) {
  return contaminated ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d="M10 2 1 18h18L10 2Zm0 5 .1 0c.5 0 .9.4.9.9l-.3 4.6a.7.7 0 0 1-1.4 0L9 7.9c0-.5.4-.9 1-.9Zm0 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
      </svg>
      Contamination flagged
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
      No contamination
    </span>
  );
}

/** Compact AI classification result: "Analysing…" while queued, then category / confidence / contamination. */
export function MlResult({ ml }: { ml: Timeline['ml'] }) {
  if (ml.status === 'none') {
    return <p className="text-sm text-slate-500">No photo analysed yet.</p>;
  }
  if (ml.status === 'queued') {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-slate-700" role="status">
        <Spinner className="h-4 w-4" /> Analysing photo…
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm text-slate-500">
          AI category <strong className="ml-1 text-base text-slate-900">{ml.category ? CATEGORY_LABEL[ml.category] : '-'}</strong>
        </span>
        {ml.confidence !== null && (
          <span className="text-sm text-slate-500">
            Confidence <strong className="ml-1 text-base text-slate-900">{Math.round(ml.confidence * 100)}%</strong>
          </span>
        )}
      </div>
      {ml.confidence !== null && (
        <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(ml.confidence * 100)}%` }} />
        </div>
      )}
      {ml.contamination !== null && <ContaminationBadge contaminated={ml.contamination} />}
    </div>
  );
}
