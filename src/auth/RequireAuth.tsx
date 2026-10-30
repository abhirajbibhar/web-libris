import { Navigate, Outlet, useLocation } from '~/router/compat';
import { ProgressSpinner } from 'primereact/progressspinner';
import { tokenStore } from '../api/client';
import { useAuth } from './AuthContext';

/** Redirects to /login when there is no session; renders the app when signed in. */
export default function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (!tokenStore.access) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (loading || !user) {
    return (
      <div className="flex align-items-center justify-content-center h-screen">
        <ProgressSpinner />
      </div>
    );
  }

  return <Outlet />;
}
