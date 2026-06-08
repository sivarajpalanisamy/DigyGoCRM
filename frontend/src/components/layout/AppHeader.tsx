import { useState } from 'react';
import { Bell, X, LogOut, Settings, User, Unplug, UserPlus, UserCheck, ArrowRight, ArrowLeft, Clock, MessageCircle, CalendarCheck, Zap, Info } from 'lucide-react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useCrmStore } from '@/store/crmStore';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { useBrandingStore } from '@/store/brandingStore';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const sectionNavs: Record<string, { label: string; path: string }[]> = {
  '/inbox': [
    { label: 'Inbox', path: '/inbox' },
    { label: 'Overview', path: '/inbox/overview' },
  ],
  '/lead-generation': [
    { label: 'Overview', path: '/lead-generation' },
    { label: 'Meta Forms', path: '/lead-generation/meta-forms' },
    { label: 'Custom Forms', path: '/lead-generation/custom-forms' },
  ],
  '/lead-management': [
    { label: 'Overview', path: '/lead-management' },
    { label: 'Pipeline', path: '/leads' },
    { label: 'Follow-ups', path: '/lead-management/followups' },
    { label: 'Contacts', path: '/lead-management/contacts' },
    { label: 'Contact Group', path: '/lead-management/contact-groups' },
  ],
  '/automation': [
    { label: 'Overview', path: '/automation' },
    { label: 'Workflows', path: '/automation/workflows' },
    { label: 'Templates', path: '/automation/templates' },
    { label: 'Uploads', path: '/automation/pincode-routing' },
  ],
  '/calendar': [
    { label: 'Dashboard', path: '/calendar' },
    { label: 'Create / Edit', path: '/calendar?tab=create-edit' },
    { label: 'Appointments', path: '/calendar?tab=appointments' },
  ],
  '/fields': [
    { label: 'Standard Fields', path: '/fields' },
    { label: 'Additional Fields', path: '/fields?tab=additional' },
    { label: 'Values', path: '/fields?tab=values' },
  ],
  '/staff': [
    { label: 'Team', path: '/staff' },
    { label: 'Roles & Permissions', path: '/staff?tab=roles' },
    { label: 'Performance', path: '/staff?tab=performance' },
  ],
  '/settings': [
    { label: 'Overview', path: '/settings' },
    { label: 'Company Details', path: '/settings/company' },
    { label: 'Integrations', path: '/settings/integrations' },
    { label: 'Notifications', path: '/settings/notifications' },
  ],
};

// Pages that have a disconnect action — path → { label, endpoint, confirm }
const PAGE_DISCONNECT: Record<string, { label: string; endpoint: string; confirm: string }> = {
  '/lead-generation/meta-forms': {
    label: 'Disconnect Meta',
    endpoint: '/api/integrations/meta/disconnect',
    confirm: 'Disconnect Meta? All linked forms and leads sync will stop.',
  },
  '/lead-generation/whatsapp': {
    label: 'Disconnect WhatsApp',
    endpoint: '/api/integrations/waba/disconnect',
    confirm: 'Disconnect WhatsApp? The WABA integration will be removed.',
  },
};

type NotifType = 'new_lead' | 'assigned' | 'automation' | 'info' | 'lead_created' | 'stage_changed' | 'new_message' | 'follow_up_due' | 'appointment';

const NOTIF_META: Record<NotifType, { icon: React.ReactNode; bg: string; text: string }> = {
  new_lead:      { icon: <UserPlus size={15} />,      bg: 'bg-primary/10',       text: 'text-primary' },
  lead_created:  { icon: <UserPlus size={15} />,      bg: 'bg-primary/10',       text: 'text-primary' },
  assigned:      { icon: <UserCheck size={15} />,     bg: 'bg-blue-100',         text: 'text-blue-600' },
  stage_changed: { icon: <ArrowRight size={15} />,    bg: 'bg-purple-100',       text: 'text-purple-600' },
  follow_up_due: { icon: <Clock size={15} />,         bg: 'bg-amber-100',        text: 'text-amber-600' },
  new_message:   { icon: <MessageCircle size={15} />, bg: 'bg-emerald-500/10',   text: 'text-emerald-600' },
  appointment:   { icon: <CalendarCheck size={15} />, bg: 'bg-teal-100',         text: 'text-teal-600' },
  automation:    { icon: <Zap size={15} />,           bg: 'bg-violet-100',       text: 'text-violet-600' },
  info:          { icon: <Info size={15} />,          bg: 'bg-gray-100',         text: 'text-gray-500' },
};

export function AppHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifTab, setNotifTab] = useState<'alerts' | 'activity'>('alerts');
  const [showProfile, setShowProfile] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const { notifications, markAllNotificationsRead, markNotificationRead, removeNotification, clearAllNotifications } = useCrmStore();
  const { currentUser, logout, isImpersonating, exitImpersonation } = useAuthStore();
  const { companyName } = useCompanyStore();
  const { branded, tenantName, logoUrl } = useBrandingStore();

  // Badge counts only alerts (action-required) — activity is FYI
  const alertNotifs = notifications.filter((n) => n.category === 'alert');
  const activityNotifs = notifications.filter((n) => n.category === 'activity');
  const unreadAlerts = alertNotifs.filter((n) => !n.read).length;
  // Activity auto-reads after 24h visually
  const isStale = (time: string) => Date.now() - new Date(time).getTime() > 86_400_000;
  const visiblyUnread = (n: { read: boolean; category: string; time: string }) =>
    !n.read && !(n.category === 'activity' && isStale(n.time));
  const badgeCount = alertNotifs.filter((n) => !n.read).length;

  const initials = currentUser
    ? `${currentUser.name.split(' ')[0][0]}${currentUser.name.split(' ')[1]?.[0] ?? ''}`
    : 'U';

  const roleLabel = currentUser?.role === 'super_admin'
    ? 'Super Admin'
    : currentUser?.role === 'owner'
      ? 'Owner'
      : 'Staff';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const pageDisconnect = PAGE_DISCONNECT[location.pathname] ?? null;
  const handleDisconnect = async () => {
    if (!pageDisconnect) return;
    if (!window.confirm(pageDisconnect.confirm)) return;
    setDisconnecting(true);
    try {
      await api.delete(pageDisconnect.endpoint);
      toast.success(`${pageDisconnect.label.replace('Disconnect ', '')} disconnected`);
      navigate(location.pathname); // reload same page to reflect state
      window.location.reload();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const activeSection = Object.keys(sectionNavs).find((prefix) => {
    // exclude calendar edit page — let it show no sub-nav
    if (prefix === '/calendar' && location.pathname.startsWith('/calendar/edit')) return false;
    if (location.pathname === prefix || location.pathname.startsWith(prefix + '/')) return true;
    // also activate lead-management nav when on /leads
    if (prefix === '/lead-management' && location.pathname === '/leads') return true;
    return false;
  });
  const subNav = activeSection ? sectionNavs[activeSection] : null;

  const isTabActive = (path: string) => {
    const [p, q] = path.split('?');
    if (q) return location.pathname === p && location.search === `?${q}`;
    // for paths without query, only match if there's no search query either
    return location.pathname === p && !location.search;
  };

  return (
    <header className="bg-white border-b border-black/5 sticky top-0 z-30 shrink-0" style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
      <div className="h-14 md:h-16 flex items-center px-4 md:px-6 gap-3 md:gap-5">

        {/* Mobile: logo mark */}
        <div className="md:hidden flex items-center gap-2 shrink-0">
          {branded && logoUrl ? (
            <img src={logoUrl} alt={tenantName ?? ''} className="h-7 max-w-[100px] object-contain" />
          ) : branded && tenantName ? (
            <span className="font-headline text-[15px] font-bold text-[#1c1410] truncate max-w-[120px]">{tenantName}</span>
          ) : (
            <>
              <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                <img src="/digygo-logo.png" alt="DigyGo" className="w-full h-full object-contain" />
              </div>
              <span className="font-headline text-[15px] font-bold text-[#1c1410] truncate max-w-[110px]">{companyName}</span>
            </>
          )}
        </div>

        {/* Desktop: DigyGo logo for super admin (the left sidebar that held it is hidden on /admin).
            The PNG is a 1080x1080 square with lots of padding, so we render it 2x the header
            height inside an overflow-hidden box (centered) to crop the whitespace — same trick
            the sidebar uses — so the wordmark fills the bar instead of looking tiny. */}
        {currentUser?.role === 'super_admin' && (
          <div className="hidden md:flex items-center justify-center shrink-0 mr-2 h-16 w-40 overflow-hidden">
            <img src="/digygo-logo.png" alt="DigyGo" className="h-32 max-w-none object-contain" />
          </div>
        )}

        {/* Tab nav — desktop only in full, scrollable on mobile */}
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide">
          {subNav ? (
            <nav className="flex items-center h-14 md:h-16">
              {subNav.map((tab) => (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={cn(
                    'relative flex items-center h-full px-3 md:px-4 text-[12px] md:text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 select-none',
                    isTabActive(tab.path)
                      ? 'text-primary font-semibold'
                      : 'text-[#7a6b5c] hover:text-[#1c1410]'
                  )}
                >
                  {tab.label}
                  {isTabActive(tab.path) && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
                  )}
                </Link>
              ))}
            </nav>
          ) : (
            <div />
          )}

          {/* Per-page Disconnect button */}
          {pageDisconnect && (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="ml-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-red-500 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Unplug className="w-3.5 h-3.5" />
              {disconnecting ? 'Disconnecting…' : pageDisconnect.label}
            </button>
          )}
        </div>

        {/* Right — bell + profile, always visible */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">

          {/* Back to Admin — only while impersonating a tenant */}
          {isImpersonating && (
            <button
              onClick={async () => { await exitImpersonation(); navigate('/admin'); }}
              title="Exit impersonation — back to Super Admin"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-white shrink-0 hover:-translate-y-px transition-transform"
              style={{ background: 'linear-gradient(90deg, var(--brand-dark), var(--brand))' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Back to Admin</span>
            </button>
          )}

          {/* Bell */}
          <div className="relative">
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className={cn(
                'relative p-2 rounded-xl text-[#7a6b5c] hover:text-primary hover:bg-[var(--accent-tint)] transition-colors',
                showNotifs && 'text-primary bg-[var(--accent-tint)]'
              )}
            >
              <Bell className="w-5 h-5" />
              {badgeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1 leading-none">
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </button>

            {/* Notification dropdown */}
            {showNotifs && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
                <div className="fixed md:absolute right-2 md:right-0 top-16 md:top-11 left-2 md:left-auto md:w-[340px] bg-white rounded-2xl z-50 flex flex-col overflow-hidden" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.14)', maxHeight: '80vh' }}>

                  {/* Header */}
                  <div className="px-5 pt-4 pb-3 border-b border-black/5 shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[14px] font-bold text-[#1c1410]">Notifications</p>
                      <div className="flex items-center gap-2">
                        {(unreadAlerts > 0 || notifications.some((n) => !n.read)) && (
                          <button onClick={() => markAllNotificationsRead()} className="text-[10px] font-bold text-primary hover:underline">
                            Mark all read
                          </button>
                        )}
                        {notifications.length > 0 && (
                          <button onClick={() => clearAllNotifications()} className="text-[10px] font-bold text-[#7a6b5c] hover:underline">
                            Clear all
                          </button>
                        )}
                        <button onClick={() => setShowNotifs(false)} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    {/* Tabs */}
                    <div className="flex gap-1">
                      {(['alerts', 'activity'] as const).map((tab) => {
                        const count = tab === 'alerts' ? alertNotifs.filter((n) => !n.read).length : activityNotifs.filter((n) => visiblyUnread(n)).length;
                        return (
                          <button
                            key={tab}
                            onClick={() => setNotifTab(tab)}
                            className={cn(
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors',
                              notifTab === tab
                                ? 'bg-[var(--accent-tint)] text-primary'
                                : 'text-[#7a6b5c] hover:bg-[var(--app-bg)]'
                            )}
                          >
                            {tab === 'alerts' ? 'Alerts' : 'Activity'}
                            {count > 0 && (
                              <span className={cn(
                                'min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1',
                                notifTab === tab ? 'bg-primary text-white' : 'bg-black/8 text-[#7a6b5c]'
                              )}>
                                {count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* List */}
                  <div className="overflow-y-auto divide-y divide-black/5 flex-1">
                    {(() => {
                      const list = notifTab === 'alerts' ? alertNotifs : activityNotifs;
                      if (list.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-10 gap-2">
                            <div className="w-10 h-10 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center">
                              <Bell size={20} className="text-[#c4b09e]" />
                            </div>
                            <p className="text-[13px] font-semibold text-[#8a7c6e]">
                              {notifTab === 'alerts' ? 'No alerts' : 'No activity'}
                            </p>
                            <p className="text-[11px] text-[#a09080]">
                              {notifTab === 'alerts' ? 'Assignments, follow-ups and messages appear here' : 'New leads and stage changes appear here'}
                            </p>
                          </div>
                        );
                      }
                      return list.slice(0, 30).map((n) => {
                        const meta = NOTIF_META[n.type as NotifType] ?? NOTIF_META['info'];
                        const unread = visiblyUnread(n);
                        return (
                          <div
                            key={n.id}
                            className={cn(
                              'group flex items-start gap-3 px-4 py-3 hover:bg-[var(--app-bg)] transition-colors',
                              unread && 'bg-primary/[0.03]'
                            )}
                          >
                            {/* Icon */}
                            <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5', meta.bg, meta.text)}>
                              {meta.icon}
                            </div>

                            {/* Text */}
                            <button
                              onClick={() => {
                                markNotificationRead(n.id);
                                setShowNotifs(false);
                                if (n.leadId) navigate(`/leads?highlight=${n.leadId}`);
                              }}
                              className="flex-1 min-w-0 text-left"
                            >
                              <p className={cn('text-[13px] leading-snug line-clamp-1', unread ? 'font-semibold text-[#1c1410]' : 'font-medium text-[#3a2e26]')}>
                                {n.title}
                              </p>
                              {n.body && (
                                <p className="text-[11.5px] text-[#8a7c6e] mt-0.5 leading-snug line-clamp-1">{n.body}</p>
                              )}
                              <p className="text-[10.5px] text-[#a09080] mt-1">
                                {formatDistanceToNow(new Date(n.time), { addSuffix: true })}
                              </p>
                            </button>

                            {/* Right side: unread dot + dismiss */}
                            <div className="flex flex-col items-center gap-2 shrink-0 pt-1">
                              {unread && <div className="w-2 h-2 rounded-full bg-primary" />}
                              <button
                                onClick={(e) => { e.stopPropagation(); removeNotification(n.id); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-black/8 text-[#a09080] transition-all"
                                title="Dismiss"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>

                </div>
              </>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-black/8" />

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => { setShowProfile((v) => !v); setShowNotifs(false); }}
              className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-[var(--accent-tint)] transition-colors"
            >
              <div className="hidden sm:block text-right">
                <p className="text-[13px] font-semibold text-[#1c1410] leading-tight">{currentUser?.name ?? 'User'}</p>
                <p className="text-[11px] text-[#7a6b5c] leading-tight mt-0.5">{roleLabel}</p>
              </div>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-primary/20 hover:ring-primary/40 transition-all shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
              >
                {initials}
              </div>
            </button>

            {/* Profile dropdown */}
            {showProfile && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowProfile(false)} />
                <div className="absolute right-0 top-12 z-50 w-56 bg-white rounded-2xl border border-black/5 overflow-hidden"
                  style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.14)' }}>

                  {/* User info */}
                  <div className="px-4 py-3.5 border-b border-black/5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-[#1c1410] truncate">{currentUser?.name}</p>
                        <p className="text-[11px] text-[#7a6b5c] truncate">{currentUser?.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div className="py-1.5">
                    <Link to="/settings/company" onClick={() => setShowProfile(false)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[var(--app-bg)] transition-colors">
                      <User className="w-4 h-4 text-[#7a6b5c]" /> Profile
                    </Link>
                    <Link to="/settings" onClick={() => setShowProfile(false)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#1c1410] hover:bg-[var(--app-bg)] transition-colors">
                      <Settings className="w-4 h-4 text-[#7a6b5c]" /> Settings
                    </Link>
                  </div>

                  <div className="border-t border-black/5 py-1.5">
                    <button onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-500 hover:bg-red-50 transition-colors font-medium">
                      <LogOut className="w-4 h-4" /> Log out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
