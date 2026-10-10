import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { errorMessage } from '../api';
import { homePathFor, useAuth } from '../auth/AuthContext';
import { ErrorBox } from '../components/States';
import { Button, Card, Field, Input } from '../components/ui';
import { AuthShell } from './Login';

type RegisterRole = 'resident' | 'collector';

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', role: 'resident' as RegisterRole });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await register({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        phone: form.phone.trim() || undefined,
      });
      navigate(homePathFor(u.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create an account">
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">I am a…</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['resident', 'collector'] as const).map((r) => (
                <label
                  key={r}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium transition-colors ${
                    form.role === r ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input type="radio" name="role" value={r} checked={form.role === r} onChange={() => setForm({ ...form, role: r })} className="sr-only" />
                  {r === 'resident' ? 'Resident' : 'Collector'}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Full name">
            <Input required autoComplete="name" maxLength={100} value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Email">
            <Input type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <Input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
          </Field>
          <Field label="Phone (optional)">
            <Input type="tel" autoComplete="tel" maxLength={20} value={form.phone} onChange={set('phone')} />
          </Field>
          <Button type="submit" busy={busy} className="w-full">
            Create account
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-slate-600">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
