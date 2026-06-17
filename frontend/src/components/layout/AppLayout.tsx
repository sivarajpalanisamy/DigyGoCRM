import { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { useCrmStore } from '@/store/crmStore';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { getSocket } from '@/lib/socket';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const initFromApi = useCrmStore((s) => s.initFromApi);
  const addNotification = useCrmStore((s) => s.addNotification);
  const refreshNotifications = useCrmStore((s) => s.refreshNotifications);
  const setWaPersonalStatus = useCrmStore((s) => s.setWaPersonalStatus);
  const { refreshPermissions } = useAuthStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  // Super admin only has the /admin page — no tenant nav, so render it full-width (no left sidebar).
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const location = useLocation();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Real-time notification delivery + Fix 14: fetch missed on reconnect
  useEffect(() => {
    const socket = getSocket();
    const ALERT_TYPES = new Set(['assigned', 'follow_up_due', 'new_message', 'appointment']);
    const handler = (n: any) => {
      const type = n.type ?? 'new_lead';
      addNotification({
        id:       n.id,
        type,
        category: ALERT_TYPES.has(type) ? 'alert' : 'activity',
        title:    n.title ?? '',
        body:     n.message ?? '',
        time:     n.created_at ?? new Date().toISOString(),
        read:     false,
      });
    };
    // Fix 14: on reconnect, fetch any notifications missed during the disconnect window
    const reconnectHandler = () => { refreshNotifications(); };
    const waStatusHandler = (data: { status: string; phone?: string | null }) => {
      setWaPersonalStatus(data.status as any, data.phone);
    };
    // DigyGo flipped the Superfone/Calls flag — reflect it live (nav + /calls guard react instantly).
    const superfoneHandler = (data: { enabled: boolean }) => {
      useCompanyStore.getState().setSuperfoneEnabled(!!data.enabled);
    };
    socket.on('notification:new', handler);
    socket.on('connect', reconnectHandler);
    socket.on('wa:status', waStatusHandler);
    socket.on('tenant:superfone', superfoneHandler);
    return () => {
      socket.off('notification:new', handler);
      socket.off('connect', reconnectHandler);
      socket.off('wa:status', waStatusHandler);
      socket.off('tenant:superfone', superfoneHandler);
    };
  }, [addNotification, refreshNotifications, setWaPersonalStatus]);

  // Re-fetch data whenever the user navigates to a new page
  useEffect(() => {
    initFromApi();
    refreshPermissions();
  }, [location.pathname]);

  // Poll CRM data every 30 seconds; permissions are stable so only refresh every 5 min
  useEffect(() => {
    pollingRef.current = setInterval(() => {
      initFromApi();
    }, 30_000);
    const permInterval = setInterval(() => {
      refreshPermissions();
    }, 5 * 60_000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      clearInterval(permInterval);
    };
  }, []);

  // Re-fetch when user returns to the tab after it was hidden (e.g. switching tabs, locking screen)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        initFromApi();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <div className="h-[100dvh] flex w-full bg-[var(--app-bg)] overflow-hidden">
      {/* Sidebar — desktop only */}
      <div className="hidden md:flex">
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AppHeader onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-hidden flex flex-col min-h-0 border-t border-black/[0.06]">
          {/* pb-16 on mobile reserves space for the bottom nav */}
          <div className="px-3 py-4 md:px-6 md:py-5 flex flex-col flex-1 min-h-0 pb-20 md:pb-10 overflow-y-auto overflow-x-hidden">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom nav — mobile only (not for super admin) */}
      {!isSuperAdmin && <MobileBottomNav />}
    </div>
  );
}
