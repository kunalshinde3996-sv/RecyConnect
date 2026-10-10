import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, CATEGORIES, errorMessage, type Category } from '../../api';
import { Empty, ErrorBox, Loading } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { Button, Card, Field, PageTitle, Select, Textarea } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import { CATEGORY_LABEL, formatDateTime } from '../../lib/format';

function RequestPickupForm() {
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState<Category>('plastic');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const pickup = await api.pickups.create({ address, declaredCategory: category, notes: notes.trim() || undefined });
      navigate(`/resident/pickups/${pickup.pickupId}`, { state: { justCreated: true } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-slate-900">Request a pickup</h2>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Pickup address">
          <Textarea required rows={2} maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House no., street, area, city, PIN" />
        </Field>
        <Field label="What are you recycling?">
          <Select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes for the collector (optional)">
          <Textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Bags are by the gate" />
        </Field>
        <Button type="submit" busy={busy} className="w-full">
          Request pickup
        </Button>
      </form>
    </Card>
  );
}

function MyPickups() {
  const { data, error, loading, reload } = useApi(() => api.pickups.mine(), [], { pollMs: 10_000 });

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold text-slate-900">My pickups</h2>
      {loading ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data?.length ? (
        <Empty title="No pickups yet">Request your first pickup using the form.</Empty>
      ) : (
        <ul className="space-y-2">
          {data.map((p) => (
            <li key={p.pickupId}>
              <Link
                to={`/resident/pickups/${p.pickupId}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-emerald-300 hover:shadow"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{p.address}</p>
                  <p className="text-xs text-slate-500">
                    {CATEGORY_LABEL[p.declaredCategory]} · {formatDateTime(p.createdAt)}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResidentHome() {
  return (
    <>
      <PageTitle>Your recycling</PageTitle>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_1fr]">
        <div>
          <RequestPickupForm />
        </div>
        <MyPickups />
      </div>
    </>
  );
}
