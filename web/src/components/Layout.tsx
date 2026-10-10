import { Link, Outlet, useNavigate } from 'react-router';
import { homePathFor, useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../lib/format';

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      RecyConnect
    </span>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to={user ? homePathFor(user.role) : '/login'} aria-label="RecyConnect home">
            <Logo />
          </Link>
          {user && (
            <div className="flex min-w-0 items-center gap-3">
              <div className="hidden min-w-0 text-right sm:block">
                <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
                <p className="text-xs text-slate-500">{ROLE_LABEL[user.role]}</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:hidden">
                {ROLE_LABEL[user.role]}
              </span>
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate('/login', { replace: true });
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
