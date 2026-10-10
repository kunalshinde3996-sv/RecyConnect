import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Role } from '../api';
import { FullPageSpinner } from '../components/States';
import { homePathFor, useAuth } from './AuthContext';

/** Renders children only for a signed-in user with the given role; otherwise redirects. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homePathFor(user.role)} replace />;
  return <>{children}</>;
}
