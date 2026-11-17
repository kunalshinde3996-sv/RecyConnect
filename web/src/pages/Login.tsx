import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '../api';
import { homePathFor, useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Layout';
import { ErrorBox } from '../components/States';
import { Button, Card, Field, Input } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'Admin', name: 'Asha Admin', email: 'admin@recyconnect.dev' },
  { role: 'Collector', name: 'Ravi Collector', email: 'ravi.collector@recyconnect.dev' },
  { role: 'Collector', name: 'Meena Collector', email: 'meena.collector@recyconnect.dev' },
  { role: 'Resident', name: 'Arjun Resident', email: 'arjun.resident@recyconnect.dev' },
  { role: 'Resident', name: 'Priya Resident', email: 'priya.resident@recyconnect.dev' },
  { role: 'Resident', name: 'Kabir Resident', email: 'kabir.resident@recyconnect.dev' },
] as const;
const DEMO_PASSWORD = 'password123';

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-[18px] w-[18px]',
  'aria-hidden': true,
} as const;

const ROLE_AVATAR: Record<(typeof DEMO_ACCOUNTS)[number]['role'], { className: string; icon: React.ReactNode }> = {
  Admin: {
    className: 'bg-emerald-100 text-emerald-800',
    icon: (
      <svg {...iconProps}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  Collector: {
    className: 'bg-sky-100 text-sky-800',
    icon: (
      <svg {...iconProps}>
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
        <circle cx="17" cy="18" r="2" />
        <circle cx="7" cy="18" r="2" />
      </svg>
    ),
  },
  Resident: {
    className: 'bg-amber-100 text-amber-800',
    icon: (
      <svg {...iconProps}>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
};

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
      <Card className="!p-5 !shadow-lg sm:!p-6">
        <form onSubmit={submit} className="space-y-5">
          {error && <ErrorBox message={error} />}
          <Field label="Email">
            <Input type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" busy={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-slate-600">
        New here?{' '}
        <Link to="/register" className="font-semibold text-emerald-700 hover:underline">
          Create an account
        </Link>
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-lg sm:p-5">
        <p className="text-sm font-semibold text-slate-700">Demo accounts</p>
        <p className="mt-0.5 mb-3 text-[11px] text-slate-400">
          password: <code className="font-mono">{DEMO_PASSWORD}</code> · tap a card to fill in
        </p>
        <ul className="grid grid-cols-2 gap-2">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border-[0.5px] border-slate-300 bg-white p-3 text-left transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(DEMO_PASSWORD);
                }}
                title={`Fill in ${a.email}`}
                aria-label={`Fill in ${a.name} (${a.role}, ${a.email})`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ROLE_AVATAR[a.role].className}`}>
                  {ROLE_AVATAR[a.role].icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-slate-900">{a.name}</span>
                  <span className="block text-[11px] text-slate-500">{a.role}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </AuthShell>
  );
}
