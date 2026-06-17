import { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useBrandingStore } from '@/store/brandingStore';
import { useBillingStore } from '@/store/billingStore';
import { PaymentDuePage } from '@/pages/PaymentDuePage';

export function AuthGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUser     = useAuthStore((s) => s.currentUser);
  const billingBlocked  = useBillingStore((s) => s.blocked);
  const bootstrapFromRefresh = useAuthStore((s) => s.bootstrapFromRefresh);
  const fetchBranding   = useBrandingStore((s) => s.fetchBranding);
  const [checking, setChecking] = useState(!isAuthenticated);
  const location = useLocation();

  useEffect(() => {
    // Fetch white-label branding in parallel — non-blocking
    fetchBranding().catch(() => null);
    if (isAuthenticated) { setChecking(false); return; }
    bootstrapFromRefresh().finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--app-bg)]">
        <div className="w-8 h-8 border-4 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Super-admin-only routes — redirect everyone else to dashboard
  const isSuperAdminRoute = location.pathname.startsWith('/admin');
  if (isSuperAdminRoute && currentUser?.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  // Super admin without a tenant context must stay on /admin.
  // Without tenantId every tenant-scoped API returns 403.
  if (!isSuperAdminRoute && currentUser?.role === 'super_admin' && !currentUser?.tenantId) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  // Subscription expired → block the whole tenant UI behind the Payment Due screen.
  // Super admin is never blocked (no tenant subscription).
  if (billingBlocked && currentUser?.role !== 'super_admin') {
    return <PaymentDuePage />;
  }

  return <Outlet />;
}
