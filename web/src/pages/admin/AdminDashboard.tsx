import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage, PICKUP_STATUSES, type Pickup, type PickupStatus } from '../../api';
import { ContaminationBadge } from '../../components/MlResult';
import { Modal } from '../../components/Modal';
import { PickupTimeline } from '../../components/PickupTimeline';
import { Empty, ErrorBox, Loading, Notice, Spinner } from '../../components/States';
import { STATUS_STYLE, StatusBadge } from '../../components/StatusBadge';
import { Button, Card, PageTitle, Select } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { CATEGORY_LABEL, STATUS_LABEL, formatDateTime, formatKg, shortId } from '../../lib/format';

const REFRESH_MS = 5000;

/**
 * Confirms recycler receipt for a handed-off pickup. The admin acts as the recycler in the
 * prototype (TODO: dedicated 'recycler' role). Needs the handoffId, which comes from the timeline.
 */
async function confirmReceipt(pickupId: string) {
  const timeline = await api.pickups.timeline(pickupId);
  const pending = timeline.handoffs.find((h) => !h.confirmedByRecycler);
  if (!pending) throw new Error('No unconfirmed hand-off found for this pickup.');
  await api.handoffs.confirm(pending.handoffId);
}

function StatCard({ label, value, accent, sub }: { label: string; value: ReactNode; accent?: string; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {accent && <span className={`h-2 w-2 rounded-full ${accent}`} aria-hidden="true" />}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/** Refetch in the background (no spinner) whenever refreshKey changes after the first render. */
function useRefreshOn(refreshKey: number, reload: () => Promise<void>) {
  useEffect(() => {
    if (refreshKey) void reload();
  }, [refreshKey, reload]);
}

function StatsCards({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useApi(() => api.admin.stats(), [], { pollMs: REFRESH_MS });
  useRefreshOn(refreshKey, reload);
  if (loading) return <Loading label="Loading stats…" />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Total kg collected" value={formatKg(data.totalKgCollected)} accent="bg-emerald-500" />
        <StatCard
          label="Contamination flagged"
          value={<span className={data.contaminationCount ? 'text-red-600' : ''}>{data.contaminationCount}</span>}
          accent="bg-red-500"
          sub={data.mlQueued ? `${data.mlQueued} photo(s) being analysed` : undefined}
        />
        <StatCard label="Total pickups" value={data.totalPickups} accent="bg-slate-400" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {PICKUP_STATUSES.map((s) => (
          <StatCard key={s} label={STATUS_LABEL[s]} value={data.byStatus[s] ?? 0} accent={STATUS_STYLE[s].dot} />
        ))}
      </div>
      {error && <p className="text-xs text-amber-700">Live refresh failed: {error}</p>}
    </div>
  );
}

function PickupsTable({ onOpen, refreshKey, onChanged }: { onOpen: (p: Pickup) => void; refreshKey: number; onChanged: () => void }) {
  const [status, setStatus] = useState<PickupStatus | ''>('');
  const { data, error, loading, reload } = useApi(() => api.admin.pickups(status || undefined), [status], { pollMs: REFRESH_MS });
  useRefreshOn(refreshKey, reload);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const confirm = async (p: Pickup) => {
    setConfirming(p.pickupId);
    setActionError(null);
    try {
      await confirmReceipt(p.pickupId);
      onChanged();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setConfirming(null);
      await reload();
    }
  };

  return (
    <Card className="!p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <h2 className="text-lg font-semibold text-slate-900">Pickups</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Status
          <Select value={status} onChange={(e) => setStatus(e.target.value as PickupStatus | '')} className="!w-40">
            <option value="">All</option>
            {PICKUP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {actionError && (
        <div className="p-4 pb-0">
          <ErrorBox message={actionError} />
        </div>
      )}
      {loading ? (
        <Loading />
      ) : error && !data ? (
        <div className="p-4">
          <ErrorBox message={error} onRetry={reload} />
        </div>
      ) : !data?.length ? (
        <div className="p-4">
          <Empty title={status ? `No ${STATUS_LABEL[status].toLowerCase()} pickups` : 'No pickups yet'} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 font-semibold">Requested</th>
                <th className="px-4 py-2 font-semibold">Address</th>
                <th className="px-4 py-2 font-semibold">Category</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Weight</th>
                <th className="px-4 py-2 font-semibold">AI check</th>
                <th className="px-4 py-2 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((p) => (
                <tr
                  key={p.pickupId}
                  onClick={() => onOpen(p)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(p))}
                  tabIndex={0}
                  className="cursor-pointer hover:bg-emerald-50/50 focus:bg-emerald-50 focus:outline-none"
                  aria-label={`Open timeline for pickup at ${p.address}`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateTime(p.createdAt)}</td>
                  <td className="max-w-[16rem] truncate px-4 py-3 font-medium text-slate-900">{p.address}</td>
                  <td className="px-4 py-3 text-slate-600">{CATEGORY_LABEL[p.declaredCategory]}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-slate-700 tabular-nums">{formatKg(p.weightKg)}</td>
                  <td className="px-4 py-3">
                    {p.mlStatus === 'done' && p.mlContamination !== undefined ? (
                      <ContaminationBadge contaminated={p.mlContamination} />
                    ) : p.mlStatus === 'queued' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Spinner className="h-3 w-3" /> Analysing
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'handed_off' && (
                      <Button
                        className="!min-h-8 !px-3 !py-1 text-xs whitespace-nowrap"
                        busy={confirming === p.pickupId}
                        disabled={confirming !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          void confirm(p);
                        }}
                      >
                        Confirm recycler receipt
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CollectorsTable({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useApi(() => api.admin.collectors(), [], { pollMs: REFRESH_MS * 2 });
  useRefreshOn(refreshKey, reload);
  return (
    <Card className="!p-0">
      <h2 className="border-b border-slate-100 p-4 text-lg font-semibold text-slate-900">Collectors</h2>
      {loading ? (
        <Loading />
      ) : error && !data ? (
        <div className="p-4">
          <ErrorBox message={error} onRetry={reload} />
        </div>
      ) : !data?.length ? (
        <div className="p-4">
          <Empty title="No collectors registered yet" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 font-semibold">Collector</th>
                <th className="px-4 py-2 text-right font-semibold">Assigned</th>
                <th className="px-4 py-2 text-right font-semibold">In transit</th>
                <th className="px-4 py-2 text-right font-semibold">Completed</th>
                <th className="px-4 py-2 text-right font-semibold">Kg collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((c) => (
                <tr key={c.userId}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.email}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.assignedCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.inTransitCount}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-700 tabular-nums">{c.completedCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatKg(c.totalKgCollected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TimelineModal({ pickup, onClose, onChanged }: { pickup: Pickup; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi(() => api.pickups.timeline(pickup.pickupId), [pickup.pickupId], { pollMs: REFRESH_MS });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await confirmReceipt(pickup.pickupId);
      setDone(true);
      onChanged();
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={
        <>
          {pickup.address} <span className="font-mono text-xs font-normal text-slate-400">#{shortId(pickup.pickupId)}</span>
        </>
      }
    >
      {loading ? (
        <Loading label="Loading timeline…" />
      ) : error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : data ? (
        <div className="space-y-4">
          {data.status === 'handed_off' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-sm text-indigo-900">
                Handed to <strong>{data.handoffs.at(-1)?.facilityName}</strong>. Acting as the recycler, confirm the waste arrived.
              </p>
              <Button busy={busy} onClick={() => void confirm()}>
                Confirm recycler receipt
              </Button>
            </div>
          )}
          {done && <Notice>Receipt confirmed. Pickup completed.</Notice>}
          {actionError && <ErrorBox message={actionError} />}
          <PickupTimeline timeline={data} />
        </div>
      ) : null}
    </Modal>
  );
}

export function AdminDashboard() {
  const [selected, setSelected] = useState<Pickup | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const close = useCallback(() => setSelected(null), []);

  return (
    <>
      <PageTitle action={<span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Live</span>}>
        Operations dashboard
      </PageTitle>
      <div className="space-y-6">
        <StatsCards refreshKey={refreshKey} />
        <PickupsTable onOpen={setSelected} refreshKey={refreshKey} onChanged={bump} />
        <CollectorsTable refreshKey={refreshKey} />
      </div>
      {selected && <TimelineModal pickup={selected} onClose={close} onChanged={bump} />}
    </>
  );
}
