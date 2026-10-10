import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, api, errorMessage, uploadPickupPhoto, PICKUP_STATUSES, type PickupStatus, type Timeline } from '../../api';
import { MlResult } from '../../components/MlResult';
import { Photo, PickupTimeline } from '../../components/PickupTimeline';
import { QrScanner } from '../../components/QrScanner';
import { ErrorBox, Loading, Notice } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Field, Input } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { CATEGORY_LABEL, formatKg } from '../../lib/format';

const reached = (status: PickupStatus, target: PickupStatus) => PICKUP_STATUSES.indexOf(status) >= PICKUP_STATUSES.indexOf(target);

type StepState = 'done' | 'active' | 'locked';

function Step({ n, title, state, lockedHint, children }: { n: number; title: string; state: StepState; lockedHint?: string; children?: ReactNode }) {
  return (
    <section
      aria-disabled={state === 'locked'}
      className={`rounded-2xl border bg-white p-4 shadow-sm ${state === 'active' ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-slate-200'}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            state === 'done' ? 'bg-emerald-600 text-white' : state === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
          }`}
          aria-hidden="true"
        >
          {state === 'done' ? '✓' : n}
        </span>
        <h2 className={`font-semibold ${state === 'locked' ? 'text-slate-400' : 'text-slate-900'}`}>{title}</h2>
      </div>
      {state === 'locked' && lockedHint && <p className="mt-2 pl-11 text-sm text-slate-400">{lockedHint}</p>}
      {state !== 'locked' && children && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
}

function PhotoStep({ timeline, onChanged }: { timeline: Timeline; onChanged: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUpload = timeline.status === 'assigned';
  const hasPhoto = timeline.ml.status !== 'none';
  const state: StepState = hasPhoto ? 'done' : canUpload ? 'active' : 'locked';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadPickupPhoto(timeline.pickupId, file);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Step n={1} title="Photograph the waste" state={state} lockedHint="No photo was taken before collection.">
      {timeline.photoUrl && <Photo url={timeline.photoUrl} />}
      {hasPhoto && <MlResult ml={timeline.ml} />}
      {error && <ErrorBox message={error} />}
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="sr-only"
            id="photo-input"
            data-testid="photo-input"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button variant={hasPhoto ? 'secondary' : 'primary'} className="w-full" busy={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : hasPhoto ? 'Retake photo' : 'Take / upload photo'}
          </Button>
          <p className="text-xs text-slate-500">JPEG or PNG. The photo goes straight to secure storage, then AI checks the category and contamination.</p>
        </>
      )}
    </Step>
  );
}

function CollectStep({ timeline, onChanged }: { timeline: Timeline; onChanged: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const done = reached(timeline.status, 'collected');
  const state: StepState = done ? 'done' : timeline.status === 'assigned' ? 'active' : 'locked';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const kg = Number(weight);
    if (!code.trim()) return setError("Scan the resident's QR code or enter it manually.");
    if (!Number.isFinite(kg) || kg <= 0) return setError('Enter a weight greater than 0 kg.');
    setBusy(true);
    setError(null);
    try {
      await api.pickups.collect(timeline.pickupId, code.trim(), Math.round(kg * 100) / 100);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400 && /qr/i.test(err.message)
          ? "That code doesn't match this pickup. Check you're at the right address and scan again."
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step n={2} title="Scan resident's QR & weigh" state={state}>
      {done ? (
        <p className="text-sm text-slate-600">
          QR verified · <strong>{formatKg(timeline.weightKg)}</strong> collected
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {timeline.ml.status === 'none' && <Notice tone="warning">Tip: take a photo (step 1) before collecting.</Notice>}
          <QrScanner
            onScan={(text) => {
              setCode(text);
              setScanned(true);
              setError(null);
            }}
          />
          <Field label="QR code" hint={scanned ? 'Scanned from camera ✓' : 'Or type the code shown under the resident’s QR'}>
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setScanned(false);
              }}
              placeholder="e.g. 3f2a…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="font-mono"
              data-testid="qr-input"
            />
          </Field>
          <Field label="Weight (kg)">
            <Input type="number" inputMode="decimal" min="0.01" step="0.01" max="10000" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0.00" />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" className="w-full" busy={busy}>
            Confirm collection
          </Button>
        </form>
      )}
    </Step>
  );
}

function HandoffStep({ timeline, onChanged }: { timeline: Timeline; onChanged: () => Promise<void> }) {
  const [facility, setFacility] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = reached(timeline.status, 'handed_off');
  const state: StepState = done ? 'done' : timeline.status === 'collected' ? 'active' : 'locked';
  const handoff = timeline.handoffs.at(-1);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!facility.trim()) return setError('Enter the recycling facility name.');
    setBusy(true);
    setError(null);
    try {
      await api.handoffs.create(timeline.pickupId, facility.trim());
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step n={3} title="Hand off to recycler" state={state} lockedHint="Available after collection.">
      {done ? (
        <p className="text-sm text-slate-600">
          Handed to <strong>{handoff?.facilityName ?? 'facility'}</strong>.{' '}
          {timeline.status === 'completed' ? 'Recycler confirmed receipt ✓' : 'Waiting for the recycler to confirm receipt.'}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="Recycling facility">
            <Input value={facility} onChange={(e) => setFacility(e.target.value)} maxLength={200} placeholder="e.g. GreenCycle MRF, Whitefield" />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" className="w-full" busy={busy}>
            Record hand-off
          </Button>
        </form>
      )}
    </Step>
  );
}

export function CollectorPickupDetail() {
  const { id = '' } = useParams();
  const [showTimeline, setShowTimeline] = useState(false);

  const pickupQ = useApi(async () => {
    const mine = await api.pickups.assigned();
    const found = mine.find((p) => p.pickupId === id);
    if (!found) throw new Error('This pickup is not assigned to you.');
    return found;
  }, [id]);
  // While the AI is analysing, poll every 2s (as the photo-processing worker is async).
  const [polling, setPolling] = useState(false);
  const timelineQ = useApi(
    async () => {
      const t = await api.pickups.timeline(id);
      setPolling(t.ml.status === 'queued');
      return t;
    },
    [id],
    { pollMs: polling ? 2000 : undefined },
  );

  const refresh = async () => {
    await Promise.all([timelineQ.reload(), pickupQ.reload()]);
  };

  const loading = pickupQ.loading || timelineQ.loading;
  const error = (!pickupQ.data && pickupQ.error) || (!timelineQ.data && timelineQ.error);
  const p = pickupQ.data;
  const t = timelineQ.data;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link to="/collector?tab=mine" className="inline-block text-sm font-medium text-emerald-700 hover:underline">
        ← My pickups
      </Link>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={() => void refresh()} />
      ) : p && t ? (
        <>
          <header className="rounded-2xl bg-emerald-700 p-4 text-white shadow">
            <div className="flex items-start justify-between gap-3">
              <p className="text-lg leading-snug font-semibold">{p.address}</p>
              <StatusBadge status={t.status} />
            </div>
            <p className="mt-1 text-sm text-emerald-100">Declared: {CATEGORY_LABEL[p.declaredCategory]}</p>
            {p.notes && <p className="mt-2 text-sm text-emerald-50">“{p.notes}”</p>}
          </header>

          {timelineQ.error && <ErrorBox message={`Couldn't refresh: ${timelineQ.error}`} />}
          <PhotoStep timeline={t} onChanged={refresh} />
          <CollectStep timeline={t} onChanged={refresh} />
          <HandoffStep timeline={t} onChanged={refresh} />

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              aria-expanded={showTimeline}
              onClick={() => setShowTimeline((v) => !v)}
              className="flex w-full items-center justify-between p-4 text-left font-semibold text-slate-900"
            >
              Chain of custody
              <span className="text-slate-400">{showTimeline ? '−' : '+'}</span>
            </button>
            {showTimeline && (
              <div className="border-t border-slate-100 p-4">
                <PickupTimeline timeline={t} />
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
