import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '../api';
import { homePathFor, useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Layout';
import { ErrorBox } from '../components/States';
import { Button, Card, Field, Input } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@recyconnect.dev' },
  { role: 'Collector', email: 'ravi.collector@recyconnect.dev' },
  { role: 'Collector', email: 'meena.collector@recyconnect.dev' },
  { role: 'Resident', email: 'arjun.resident@recyconnect.dev' },
  { role: 'Resident', email: 'priya.resident@recyconnect.dev' },
  { role: 'Resident', email: 'kabir.resident@recyconnect.dev' },
];
const DEMO_PASSWORD = 'password123';

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-gradient-to-b from-emerald-50 to-slate-50 px-4 py-10">
      <div className="mb-6">
        <Logo />
      </div>
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith(`/${u.role}`) ? from : homePathFor(u.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in">
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" busy={busy} className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-slate-600">
        New here?{' '}
        <Link to="/register" className="font-semibold text-emerald-700 hover:underline">
          Create an account
        </Link>
      </p>

      <div className="rounded-xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
        <p className="mb-2 font-semibold text-slate-700">
          Demo accounts <span className="font-normal text-slate-500">(password: <code>{DEMO_PASSWORD}</code>)</span>
        </p>
        <ul className="space-y-1">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-emerald-50"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                }}
                title="Fill in this account"
              >
                <span className="truncate font-mono">{a.email}</span>
                <span className="shrink-0 text-slate-400">{a.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </AuthShell>
  );
}
