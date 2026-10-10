import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, homePathFor, useAuth } from './auth/AuthContext';
import { RequireRole } from './auth/RequireRole';
import { Layout } from './components/Layout';
import { FullPageSpinner } from './components/States';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { CollectorHome } from './pages/collector/CollectorHome';
import { CollectorPickupDetail } from './pages/collector/CollectorPickupDetail';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { ResidentHome } from './pages/resident/ResidentHome';
import { ResidentPickupDetail } from './pages/resident/ResidentPickupDetail';

function RootRedirect() {
  const { user, initialising } = useAuth();
  if (initialising) return <FullPageSpinner />;
  return <Navigate to={user ? homePathFor(user.role) : '/login'} replace />;
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-5xl font-bold text-emerald-600">404</p>
      <p className="mt-2 text-slate-600">That page doesn't exist.</p>
      <Link to="/" className="mt-4 inline-block font-semibold text-emerald-700 hover:underline">
        Go home
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<Layout />}>
            <Route path="/resident" element={<RequireRole role="resident"><ResidentHome /></RequireRole>} />
            <Route path="/resident/pickups/:id" element={<RequireRole role="resident"><ResidentPickupDetail /></RequireRole>} />
            <Route path="/collector" element={<RequireRole role="collector"><CollectorHome /></RequireRole>} />
            <Route path="/collector/pickups/:id" element={<RequireRole role="collector"><CollectorPickupDetail /></RequireRole>} />
            <Route path="/admin" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
