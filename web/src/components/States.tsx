import type { ReactNode } from 'react';

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin text-emerald-600 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border-l-4 border-red-500 bg-red-50 px-3.5 py-3 text-sm text-red-800">
      <svg viewBox="0 0 20 20" fill="currentColor" className="mt-px h-4 w-4 shrink-0 text-red-500" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2 hover:text-red-900">
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        </svg>
      </span>
      <p className="text-sm font-medium text-slate-500">{title || 'Nothing here yet'}</p>
      {children && <div className="mt-1 max-w-xs text-xs text-slate-400">{children}</div>}
    </div>
  );
}

export function Notice({ tone = 'success', children }: { tone?: 'success' | 'warning' | 'info'; children: ReactNode }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  }[tone];
  return (
    <div role="status" className={`rounded-xl border p-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}
