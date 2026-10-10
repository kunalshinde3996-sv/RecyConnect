import { useState, type ReactNode } from 'react';
import { PICKUP_STATUSES, type PickupStatus, type Timeline, type TimelineEntry } from '../api';
import { useStableUrl } from '../hooks/useStableUrl';
import { CATEGORY_LABEL, ROLE_LABEL, formatDateTime, formatKg } from '../lib/format';
import { MlResult } from './MlResult';
import { STATUS_STYLE, StatusBadge } from './StatusBadge';

const STEP_TITLE: Record<PickupStatus, string> = {
  pending: 'Pickup requested',
  assigned: 'Collector assigned',
  collected: 'Collected & weighed',
  handed_off: 'Handed to recycler',
  completed: 'Recycling confirmed',
};

const STEP_WAITING: Record<PickupStatus, string> = {
  pending: 'Waiting for request',
  assigned: 'Waiting for a collector to claim it',
  collected: 'Waiting for collection (QR scan + weighing)',
  handed_off: 'Waiting for hand-off to a recycling facility',
  completed: 'Waiting for the recycler to confirm receipt',
};

/** S3 photo from a presigned URL; stays stable across polls and re-signs once if the link expired. */
export function Photo({ url: freshUrl, className = '' }: { url: string; className?: string }) {
  const stableUrl = useStableUrl(freshUrl)!;
  const [retryUrl, setRetryUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const samePath = (a: string | null, b: string) => a?.split('?')[0] === b.split('?')[0];
  const url = samePath(retryUrl, freshUrl) ? retryUrl! : stableUrl;

  const onError = () => {
    // Most likely the signature expired: try the newest URL from the last poll once.
    if (url !== freshUrl) setRetryUrl(freshUrl);
    else setFailedUrl(url);
  };

  if (failedUrl === url) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-slate-100 p-4 text-center text-xs text-slate-500">
        Photo unavailable (the link may have expired; reload to refresh it).
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`block ${className}`}>
      <img
        src={url}
        alt="Photo of the collected waste"
        onError={onError}
        className="aspect-[4/3] w-full rounded-xl border border-slate-200 bg-slate-100 object-cover"
      />
    </a>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-sm">
      <span className="text-slate-500">{label}: </span>
      <span className="font-medium text-slate-800">{children}</span>
    </div>
  );
}

/**
 * Chain-of-custody view: the waste's evidence (photo + AI result + weight) and a vertical
 * timeline of every custody step with who did it and when. Future steps are shown greyed out.
 */
export function PickupTimeline({ timeline }: { timeline: Timeline }) {
  const byStatus = new Map<PickupStatus, TimelineEntry>(timeline.history.map((h) => [h.status, h]));
  const handoff = timeline.handoffs.at(-1);
  const reachedIndex = PICKUP_STATUSES.indexOf(timeline.status);

  const stepDetails = (status: PickupStatus): ReactNode => {
    switch (status) {
      case 'pending':
        return <Detail label="Declared as">{CATEGORY_LABEL[timeline.declaredCategory]}</Detail>;
      case 'collected':
        return (
          <>
            <Detail label="Weight">{formatKg(timeline.weightKg)}</Detail>
            <Detail label="Resident QR">verified ✓</Detail>
          </>
        );
      case 'handed_off':
        return handoff ? <Detail label="Facility">{handoff.facilityName}</Detail> : null;
      case 'completed':
        return handoff?.confirmedByRecycler ? (
          <Detail label="Recycler receipt">confirmed {formatDateTime(handoff.confirmedAt)}</Detail>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      {/* Evidence */}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <div>
          {timeline.photoUrl ? (
            <Photo url={timeline.photoUrl} />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-400">
              No photo yet
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={timeline.status} />
            <span className="text-sm text-slate-500">
              Declared <strong className="text-slate-800">{CATEGORY_LABEL[timeline.declaredCategory]}</strong>
            </span>
            {timeline.weightKg !== null && (
              <span className="text-sm text-slate-500">
                · <strong className="text-slate-800">{formatKg(timeline.weightKg)}</strong>
              </span>
            )}
          </div>
          <MlResult ml={timeline.ml} />
        </div>
      </div>

      {/* Chain of custody */}
      <div>
        <h3 className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">Chain of custody</h3>
        <ol className="relative">
          {PICKUP_STATUSES.map((status, i) => {
            const entry = byStatus.get(status);
            const done = Boolean(entry) || i <= reachedIndex;
            const isLast = i === PICKUP_STATUSES.length - 1;
            const isCurrent = i === reachedIndex;
            return (
              <li key={status} className="relative flex gap-4 pb-6 last:pb-0">
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-8 left-[0.9375rem] -ml-px h-[calc(100%-2rem)] w-0.5 ${i < reachedIndex ? 'bg-emerald-400' : 'bg-slate-200'}`}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${
                    done ? `${STATUS_STYLE[status].dot} text-white` : 'border-2 border-dashed border-slate-300 bg-white text-slate-300'
                  } ${isCurrent ? 'shadow-md shadow-emerald-200' : ''}`}
                >
                  {done ? (
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <span className="text-xs font-bold">{i + 1}</span>
                  )}
                </span>
                <div className={`min-w-0 flex-1 pt-1 ${done ? '' : 'opacity-60'}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className={`font-semibold ${done ? 'text-slate-900' : 'text-slate-500'}`}>{STEP_TITLE[status]}</p>
                    {entry && <time className="text-xs text-slate-500" dateTime={entry.at}>{formatDateTime(entry.at)}</time>}
                  </div>
                  {entry ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-sm text-slate-600">
                        by <span className="font-medium text-slate-800">{entry.actor?.name ?? 'Unknown user'}</span>
                        {entry.actor && <span className="text-slate-400"> · {ROLE_LABEL[entry.actor.role]}</span>}
                      </p>
                      {stepDetails(status)}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-sm text-slate-400">{STEP_WAITING[status]}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
