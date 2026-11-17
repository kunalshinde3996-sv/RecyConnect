import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage, PICKUP_STATUSES, type Alert, type AlertType, type Pickup, type PickupStatus } from '../../api';
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

const statIconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-3.5 w-3.5 shrink-0 text-slate-400',
  'aria-hidden': true,
} as const;

const RecycleIcon = () => (
  <svg {...statIconProps}>
    <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" />
    <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" />
    <path d="m14 16-3 3 3 3" />
    <path d="M8.293 13.596 7.196 9.5 3.1 10.598" />
    <path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" />
    <path d="m13.378 9.633 4.096 1.098 1.097-4.096" />
  </svg>
);

const AlertTriangleIcon = () => (
  <svg {...statIconProps}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const PackageIcon = () => (
  <svg {...statIconProps}>
    <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
    <path d="M12 22V12" />
    <path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7" />
    <path d="m7.5 4.27 9 5.15" />
  </svg>
);

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{children}</p>;
}

function StatCard({ label, value, accent, sub, icon }: { label: string; value: ReactNode; accent?: string; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <p className="flex items-center gap-1.5 text-xs leading-tight font-medium text-slate-500">
        {accent && <span className={`h-2 w-2 shrink-0 rounded-full ${accent}`} aria-hidden="true" />}
        {icon}
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
    <div className="space-y-5">
      <section>
        <SectionLabel>Overview</SectionLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Total kg collected"
            value={<span className="text-emerald-600">{formatKg(data.totalKgCollected)}</span>}
            accent="bg-emerald-500"
            icon={<RecycleIcon />}
          />
          <StatCard
            label="Contamination flagged"
            value={<span className={data.contaminationCount ? 'text-red-600' : ''}>{data.contaminationCount}</span>}
            accent="bg-red-500"
            icon={<AlertTriangleIcon />}
            sub={data.mlQueued ? `${data.mlQueued} photo(s) being analysed` : undefined}
          />
          <StatCard label="Total pickups" value={data.totalPickups} accent="bg-slate-400" icon={<PackageIcon />} />
        </div>
      </section>
      <section>
        <SectionLabel>By status</SectionLabel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {PICKUP_STATUSES.map((s) => (
            <StatCard key={s} label={STATUS_LABEL[s]} value={data.byStatus[s] ?? 0} accent={STATUS_STYLE[s].dot} />
          ))}
        </div>
      </section>
      {error && <p className="text-xs text-amber-700">Live refresh failed: {error}</p>}
    </div>
  );
}

const ALERT_META: Record<AlertType, { label: string; dot: string }> = {
  contamination: { label: 'Contamination', dot: 'bg-red-500' },
  missed_pickup: { label: 'Missed pickup', dot: 'bg-amber-500' },
  handoff: { label: 'Hand-off', dot: 'bg-indigo-500' },
  recycler_confirmed: { label: 'Recycler confirmed', dot: 'bg-emerald-500' },
};

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return formatDateTime(iso);
}

/** Alerts raised by the backend (also published to SNS). Refreshes with the stats. */
function AlertsPanel({ refreshKey, onOpenPickup }: { refreshKey: number; onOpenPickup: (pickupId: string) => void }) {
  const { data, error, loading, reload } = useApi(() => api.admin.alerts(), [], { pollMs: REFRESH_MS });
  useRefreshOn(refreshKey, reload);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const unread = data?.unreadCount ?? 0;
  const open = (a: Alert) => {
    onOpenPickup(a.pickupId);
    if (!a.read) void act(a.alertId, () => api.admin.markAlertRead(a.alertId));
  };

  return (
    <Card className="flex max-h-[26rem] flex-col !p-0" data-testid="alerts-panel">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          Alerts
          <span
            data-testid="alerts-unread"
            aria-label={`${unread} unread`}
            className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${unread ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'}`}
          >
            {unread}
          </span>
        </h2>
        {unread > 0 && (
          <Button
            variant="ghost"
            className="!min-h-8 !px-2 !py-1 text-xs"
            busy={busy === 'all'}
            disabled={busy !== null}
            onClick={() => void act('all', () => api.admin.markAllAlertsRead())}
          >
            Mark all read
          </Button>
        )}
      </div>
      {actionError && (
        <div className="p-3 pb-0">
          <ErrorBox message={actionError} />
        </div>
      )}
      {loading ? (
        <Loading label="Loading alerts…" />
      ) : error && !data ? (
        <div className="p-4">
          <ErrorBox message={error} onRetry={reload} />
        </div>
      ) : !data?.alerts.length ? (
        <div className="p-4">
          <Empty title="No alerts">Contamination, hand-offs, confirmations and missed pickups appear here.</Empty>
        </div>
      ) : (
        <ul className="space-y-2 overflow-y-auto p-3">
          {data.alerts.map((a) => (
            <li
              key={a.alertId}
              className={`overflow-hidden rounded-xl border ${
                a.type === 'contamination' ? 'border-red-200 bg-red-50' : a.read ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/60'
              }`}
            >
              <button
                type="button"
                onClick={() => open(a)}
                className={`block w-full p-3 text-left transition-colors focus:outline-none ${
                  a.type === 'contamination' ? 'hover:bg-red-100/60 focus:bg-red-100/60' : 'hover:bg-emerald-50/60 focus:bg-emerald-50'
                }`}
                aria-label={`${a.read ? '' : 'Unread: '}${ALERT_META[a.type].label}. ${a.message}`}
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${ALERT_META[a.type].dot}`} aria-hidden="true" />
                  {ALERT_META[a.type].label}
                  {!a.read && <span className="text-[10px] font-bold text-red-600 uppercase">New</span>}
                  <span className="ml-auto font-normal text-slate-400">{timeAgo(a.createdAt)}</span>
                </p>
                <p className={`mt-1 text-sm ${a.read ? 'text-slate-600' : 'font-medium text-slate-900'}`}>{a.message}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && data && <p className="px-4 pb-3 text-xs text-amber-700">Live refresh failed: {error}</p>}
    </Card>
  );
}

/** Muted placeholder for columns a pickup hasn't reached yet. */
function PendingCell() {
  return <span className="text-xs text-slate-300 italic">— pending</span>;
}

const AVATAR_PALETTE = ['bg-emerald-100 text-emerald-800', 'bg-sky-100 text-sky-800', 'bg-amber-100 text-amber-800', 'bg-violet-100 text-violet-800'];

function avatarClass(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
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
                  className={`cursor-pointer transition-colors focus:bg-emerald-50 focus:outline-none ${
                    p.mlStatus === 'done' && p.mlContamination ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-gray-50'
                  }`}
                  aria-label={`Open timeline for pickup at ${p.address}`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateTime(p.createdAt)}</td>
                  <td className="max-w-[16rem] truncate px-4 py-3 font-medium text-slate-900" title={p.address}>
                    {p.address}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{CATEGORY_LABEL[p.declaredCategory]}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-slate-700 tabular-nums">
                    {p.weightKg === null || p.weightKg === undefined ? <PendingCell /> : formatKg(p.weightKg)}
                  </td>
                  <td className="px-4 py-3">
                    {p.mlStatus === 'done' && p.mlContamination !== undefined ? (
                      <ContaminationBadge contaminated={p.mlContamination} />
                    ) : p.mlStatus === 'queued' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Spinner className="h-3 w-3" /> Analysing
                      </span>
                    ) : (
                      <PendingCell />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'handed_off' && (
                      <Button
                        className="!min-h-8 !px-3 !py-1 text-xs whitespace-nowrap !transition-all hover:scale-[1.03] hover:shadow-sm active:scale-[0.98] disabled:scale-100"
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
                <tr key={c.userId} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarClass(c.name)}`}
                        aria-hidden="true"
                      >
                        {c.name.trim().charAt(0).toUpperCase() || '?'}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{c.name}</p>
                        <p className="text-xs text-slate-500">{c.email}</p>
                      </div>
                    </div>
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

type PickupRef = Pick<Pickup, 'pickupId'> & { address?: string };

function TimelineModal({ pickup, onClose, onChanged }: { pickup: PickupRef; onClose: () => void; onChanged: () => void }) {
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
          {pickup.address ?? 'Pickup'} <span className="font-mono text-xs font-normal text-slate-400">#{shortId(pickup.pickupId)}</span>
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
  const [selected, setSelected] = useState<PickupRef | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const close = useCallback(() => setSelected(null), []);

  return (
    <>
      <PageTitle action={<span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Live</span>}>
        Operations dashboard
      </PageTitle>
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <StatsCards refreshKey={refreshKey} />
          <AlertsPanel refreshKey={refreshKey} onOpenPickup={(pickupId) => setSelected({ pickupId })} />
        </div>
        <PickupsTable onOpen={setSelected} refreshKey={refreshKey} onChanged={bump} />
        <CollectorsTable refreshKey={refreshKey} />
      </div>
      {selected && <TimelineModal pickup={selected} onClose={close} onChanged={bump} />}
    </>
  );
}
