import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { api, type Pickup } from '../../api';
import { PickupTimeline } from '../../components/PickupTimeline';
import { ErrorBox, Loading, Notice } from '../../components/States';
import { Button, Card } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';

function QrCard({ pickup }: { pickup: Pickup }) {
  const [copied, setCopied] = useState(false);
  const used = pickup.status !== 'pending' && pickup.status !== 'assigned';
  if (!pickup.qrToken) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pickup.qrToken!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the code is still visible to select manually */
    }
  };

  return (
    <Card className="text-center">
      <h2 className="text-lg font-semibold text-slate-900">Collection QR code</h2>
      {used ? (
        <p className="mt-2 text-sm text-slate-500">Scanned by your collector on collection. No longer needed.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">Show this to your collector when they arrive.</p>
          <div className="mx-auto mt-4 w-fit rounded-xl border border-slate-200 bg-white p-3">
            <QRCodeSVG value={pickup.qrToken} size={208} level="M" marginSize={2} title="Pickup QR code" />
          </div>
          <p className="mt-3 text-xs text-slate-500">Can't scan? Read out this code:</p>
          <p className="mt-1 font-mono text-xs break-all text-slate-800 select-all" data-testid="qr-token">
            {pickup.qrToken}
          </p>
          <Button variant="ghost" className="mt-1" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy code'}
          </Button>
        </>
      )}
    </Card>
  );
}

export function ResidentPickupDetail() {
  const { id = '' } = useParams();
  const location = useLocation();
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated;

  // /mine is the only resident endpoint that includes qrToken + address; the timeline has the custody chain.
  const pickupQ = useApi(async () => {
    const mine = await api.pickups.mine();
    const found = mine.find((p) => p.pickupId === id);
    if (!found) throw new Error('Pickup not found.');
    return found;
  }, [id], { pollMs: 5000 });
  const timelineQ = useApi(() => api.pickups.timeline(id), [id], { pollMs: 5000 });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link to="/resident" className="inline-block text-sm font-medium text-emerald-700 hover:underline">
        ← My pickups
      </Link>
      {justCreated && <Notice>Pickup requested! A collector will claim it soon. Keep this QR code handy.</Notice>}

      {pickupQ.loading ? (
        <Loading />
      ) : pickupQ.error && !pickupQ.data ? (
        <ErrorBox message={pickupQ.error} onRetry={pickupQ.reload} />
      ) : pickupQ.data ? (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <div className="space-y-4">
            <QrCard pickup={pickupQ.data} />
            <Card>
              <h2 className="text-sm font-semibold text-slate-500">Address</h2>
              <p className="mt-1 text-slate-900">{pickupQ.data.address}</p>
              {pickupQ.data.notes && <p className="mt-2 text-sm text-slate-600">“{pickupQ.data.notes}”</p>}
              <p className="mt-2 text-xs text-slate-400">Requested {formatDateTime(pickupQ.data.createdAt)}</p>
            </Card>
          </div>
          <Card>
            {timelineQ.loading ? (
              <Loading label="Loading timeline…" />
            ) : timelineQ.error && !timelineQ.data ? (
              <ErrorBox message={timelineQ.error} onRetry={timelineQ.reload} />
            ) : timelineQ.data ? (
              <PickupTimeline timeline={timelineQ.data} />
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
