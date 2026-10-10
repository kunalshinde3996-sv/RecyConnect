import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, api, errorMessage, type Pickup } from '../../api';
import { Empty, ErrorBox, Loading, Notice } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { CATEGORY_LABEL, formatDateTime } from '../../lib/format';

type Tab = 'available' | 'mine';

function AvailableList() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi(() => api.pickups.available(), [], { pollMs: 10_000 });
  const [claiming, setClaiming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'info'; text: string } | null>(null);

  const claim = async (p: Pickup) => {
    setClaiming(p.pickupId);
    setNotice(null);
    try {
      await api.pickups.assign(p.pickupId);
      navigate(`/collector/pickups/${p.pickupId}`);
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.status === 409
          ? { tone: 'warning', text: 'Another collector just claimed that pickup. The list has been refreshed.' }
          : { tone: 'info', text: errorMessage(err) },
      );
      setClaiming(null);
      await reload();
    }
  };

  if (loading) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div className="space-y-3">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {!data?.length ? (
        <Empty title="No pickups waiting">New requests will show up here automatically.</Empty>
      ) : (
        <ul className="space-y-3">
          {data.map((p) => (
            <li key={p.pickupId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{p.address}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {CATEGORY_LABEL[p.declaredCategory]} · requested {formatDateTime(p.createdAt)}
                  </p>
                  {p.notes && <p className="mt-2 text-sm text-slate-600">“{p.notes}”</p>}
                </div>
              </div>
              <Button className="mt-3 w-full" busy={claiming === p.pickupId} disabled={claiming !== null} onClick={() => void claim(p)}>
                Claim pickup
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTIVE: Pickup['status'][] = ['assigned', 'collected'];

function MyPickupsList() {
  const { data, error, loading, reload } = useApi(() => api.pickups.assigned(), [], { pollMs: 10_000 });

  if (loading) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data?.length) return <Empty title="Nothing claimed yet">Claim a pickup from the Available tab.</Empty>;

  const active = data.filter((p) => ACTIVE.includes(p.status));
  const done = data.filter((p) => !ACTIVE.includes(p.status));

  const row = (p: Pickup) => (
    <li key={p.pickupId}>
      <Link
        to={`/collector/pickups/${p.pickupId}`}
        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition active:bg-slate-50 hover:border-emerald-300"
      >
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{p.address}</p>
          <p className="text-sm text-slate-500">{CATEGORY_LABEL[p.declaredCategory]}</p>
        </div>
        <StatusBadge status={p.status} />
      </Link>
    </li>
  );

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">To do ({active.length})</h2>
        {active.length ? <ul className="space-y-2">{active.map(row)}</ul> : <p className="text-sm text-slate-500">All caught up.</p>}
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Handed off / completed</h2>
          <ul className="space-y-2">{done.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

export function CollectorHome() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'mine' ? 'mine' : 'available';

  return (
    <div className="mx-auto max-w-md">
      <div role="tablist" aria-label="Pickups" className="mb-4 grid grid-cols-2 rounded-xl bg-slate-200/70 p-1">
        {(
          [
            ['available', 'Available'],
            ['mine', 'My pickups'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setParams(key === 'mine' ? { tab: 'mine' } : {}, { replace: true })}
            className={`rounded-lg py-2 text-sm font-semibold transition ${tab === key ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'available' ? <AvailableList /> : <MyPickupsList />}
    </div>
  );
}
