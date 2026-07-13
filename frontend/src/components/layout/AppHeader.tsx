import { useState, useRef, useCallback } from 'react';
import { Bell, X, LogOut, Settings, User, Unplug, UserPlus, UserCheck, ArrowRight, ArrowLeft, Clock, MessageCircle, CalendarCheck, Workflow, Info, ChevronDown, Search, HelpCircle, LifeBuoy, Send, Menu } from 'lucide-react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useCrmStore } from '@/store/crmStore';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';
import { useBrandingStore } from '@/store/brandingStore';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { confirmDialog } from '@/lib/confirm';
import { useHeaderSearchStore } from '@/store/headerSearchStore';

type NavTab = { label: string; path: string };
type NavDropdown = { label: string; children: NavTab[] };
type NavItem = NavTab | NavDropdown;
const isDropdown = (item: NavItem): item is NavDropdown => 'children' in item;

const sectionNavs: Record<string, NavItem[]> = {
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
    {
      label: 'WhatsApp',
      children: [
        { label: 'Devices', path: '/automation/devices' },
        { label: 'Templates', path: '/automation/templates' },
        { label: 'Single Send', path: '/automation/wa-send' },
      ],
    },
    {
      label: 'WABA',
      children: [
        { label: 'Dashboard', path: '/automation/waba' },
        { label: 'Templates', path: '/automation/waba-templates' },
        { label: 'Single Send', path: '/automation/waba-send' },
        { label: 'Broadcast', path: '/automation/waba-broadcast' },
      ],
    },
    { label: 'Uploads', path: '/automation/pincode-routing' },
  ],
  '/calendar': [
    { label: 'Dashboard', path: '/calendar' },
    { label: 'Create / Edit', path: '/calendar?tab=create-edit' },
    { label: 'Appointments', path: '/calendar?tab=appointments' },
  ],
  '/reports': [
    { label: 'Overview', path: '/reports' },
    { label: 'Pipeline', path: '/reports/pipeline' },
    { label: 'Response Time', path: '/reports/response-time' },
    { label: 'Staff Scorecard', path: '/reports/staff-scorecard' },
    { label: 'Funnel', path: '/reports/conversion-funnel' },
    { label: 'Follow-ups', path: '/reports/followup-compliance' },
    { label: 'Source ROI', path: '/reports/source-roi' },
  ],
  '/fields': [
    { label: 'Standard Fields', path: '/fields' },
    { label: 'Additional Fields', path: '/fields?tab=additional' },
    { label: 'Values', path: '/fields?tab=values' },
    { label: 'Tags', path: '/fields?tab=tags' },
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

// Pages that have a disconnect action - path → { label, endpoint, confirm }
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
  automation:    { icon: <Workflow size={15} />,      bg: 'bg-violet-100',       text: 'text-violet-600' },
  info:          { icon: <Info size={15} />,          bg: 'bg-gray-100',         text: 'text-gray-500' },
};

export function AppHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifTab, setNotifTab] = useState<'alerts' | 'activity'>('alerts');
  const [showProfile, setShowProfile] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [helpSubject, setHelpSubject] = useState('');
  const [helpMessage, setHelpMessage] = useState('');
  const [helpSending, setHelpSending] = useState(false);

  const submitTicket = async () => {
    const subject = helpSubject.trim();
    const message = helpMessage.trim();
    if (!subject || !message) { toast.error('Please add a subject and describe your issue'); return; }
    setHelpSending(true);
    try {
      await api.post('/api/support/ticket', { subject, message });
      toast.success('Ticket raised - our team will get back to you by email');
      setShowHelp(false);
      setHelpSubject('');
      setHelpMessage('');
    } catch (e: any) {
      toast.error(e?.message || 'Could not raise your ticket. Please try again.');
    } finally {
      setHelpSending(false);
    }
  };
  // Context-aware search: the current page registers its config; we render one input.
  const searchConfig = useHeaderSearchStore((s) => s.config);
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const setSearchQuery = useHeaderSearchStore((s) => s.setQuery);
  const dropdownBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const openNav = useCallback((label: string) => {
    const btn = dropdownBtnRefs.current[label];
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left });
    }
    setOpenDropdown(label);
  }, []);
  const { notifications, markAllNotificationsRead, markNotificationRead, removeNotification, clearAllNotifications } = useCrmStore();
  const { currentUser, logout, isImpersonating, exitImpersonation } = useAuthStore();
  const { companyName } = useCompanyStore();
  const { branded, tenantName, logoUrl } = useBrandingStore();

  // Badge counts only alerts (action-required) - activity is FYI
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
    if (!(await confirmDialog({ title: pageDisconnect.label, message: pageDisconnect.confirm, confirmText: 'Disconnect' }))) return;
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
    // exclude calendar edit page - let it show no sub-nav
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
    <header className="bg-transparent shrink-0">
      <div className="relative h-12 md:h-[52px] flex items-center px-4 md:px-6 gap-3 md:gap-4">

        {/* Mobile: hamburger opens the full-nav sidebar drawer */}
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="md:hidden p-2 -ml-1 rounded-lg text-[#6b7280] hover:bg-[var(--surface-2)] transition-colors shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile: logo mark */}
        <div className="md:hidden flex items-center gap-2 shrink-0">
          {branded && logoUrl ? (
            <img src={logoUrl} alt={tenantName ?? ''} className="h-7 max-w-[100px] object-contain" />
          ) : branded && tenantName ? (
            <span className="font-headline text-[16px] font-bold text-[#111318] truncate max-w-[120px]">{tenantName}</span>
          ) : (
            <>
              <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                <img src="/favicon.png" alt="Hawcus" className="w-full h-full object-contain" />
              </div>
              <span className="font-headline text-[16px] font-bold text-[#111318] truncate max-w-[110px]">{companyName}</span>
            </>
          )}
        </div>

        {/* Desktop: company name - sits just after the rail's favicon (brand lockup across the boundary) */}
        <span className="hidden md:block font-headline font-bold text-[15px] text-[#111318] truncate max-w-[200px] shrink-0">
          {(branded && tenantName) ? tenantName : companyName}
        </span>

        {/* Super admin logo removed - sidebar already shows the logo */}

        {/* Context-aware search (mobile) - full-width overlay toggled by the icon */}
        {searchConfig && mobileSearchOpen && (
          <div className="md:hidden absolute inset-0 z-40 bg-white flex items-center gap-2 px-4">
            <Search className="w-4 h-4 text-[#9ca3af] shrink-0" />
            <input
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              name="header-search-mobile"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMobileSearchOpen(false);
                else if (e.key === 'Enter' && searchConfig.onSubmit) { searchConfig.onSubmit(searchQuery); setMobileSearchOpen(false); }
              }}
              placeholder={searchConfig.placeholder}
              className="flex-1 h-9 text-[15px] bg-transparent outline-none placeholder:text-[#9ca3af]"
            />
            <button onClick={() => { setSearchQuery(''); setMobileSearchOpen(false); }} className="p-1.5 rounded-lg text-[#6b7280] hover:bg-[var(--accent-tint)] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Tab nav - desktop only in full, scrollable on mobile */}
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide">
          {subNav ? (
            <nav className="flex items-center gap-1 rounded-full bg-[var(--surface-2)] p-1">
              {subNav.map((item) => {
                if (isDropdown(item)) {
                  const childActive = item.children.some((c) => isTabActive(c.path));
                  const isOpen = openDropdown === item.label;
                  return (
                    <div key={item.label} className="relative flex items-center">
                      <button
                        ref={(el) => { dropdownBtnRefs.current[item.label] = el; }}
                        onClick={() => isOpen ? setOpenDropdown(null) : openNav(item.label)}
                        className={cn(
                          'relative flex items-center gap-1 rounded-full px-3 md:px-4 py-1.5 text-[13px] md:text-[14px] font-semibold whitespace-nowrap transition-all duration-150 select-none',
                          childActive
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-[#6b7280] hover:text-[#111318]'
                        )}
                      >
                        {item.label}
                        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
                      </button>
                      {isOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                          <div
                            className="fixed z-50 min-w-[160px] bg-white rounded-xl border border-black/5 py-1.5"
                            style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.12)', top: dropdownPos.top, left: dropdownPos.left }}
                          >
                            {item.children.map((child) => (
                              <Link
                                key={child.path}
                                to={child.path}
                                onClick={() => setOpenDropdown(null)}
                                className={cn(
                                  'block px-4 py-2 text-[14px] font-medium transition-colors whitespace-nowrap',
                                  isTabActive(child.path)
                                    ? 'text-primary bg-[var(--accent-tint)] font-semibold'
                                    : 'text-[#2b2f36] hover:bg-[var(--app-bg)]'
                                )}
                              >
                                {child.label}
                              </Link>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'relative flex items-center rounded-full px-3 md:px-4 py-1.5 text-[13px] md:text-[14px] font-semibold whitespace-nowrap transition-all duration-150 select-none',
                      isTabActive(item.path)
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-[#6b7280] hover:text-[#111318]'
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <div />
          )}

          {/* Per-page Disconnect button */}
          {pageDisconnect && (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="ml-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-red-500 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Unplug className="w-3.5 h-3.5" />
              {disconnecting ? 'Disconnecting…' : pageDisconnect.label}
            </button>
          )}
        </div>

        {/* Right - bell + profile, always visible */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">

          {/* Back to Admin - only while impersonating a tenant */}
          {isImpersonating && (
            <button
              onClick={async () => { await exitImpersonation(); navigate('/admin'); }}
              title="Exit impersonation - back to Super Admin"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-white shrink-0 hover:-translate-y-px transition-transform"
              style={{ background: 'linear-gradient(90deg, var(--brand-dark), var(--brand))' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Back to Admin</span>
            </button>
          )}

          {/* Context-aware search (desktop) - to the left of the notification bell */}
          {searchConfig && (
            <div className="hidden md:flex items-center relative w-52 lg:w-72 shrink-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af] pointer-events-none" />
              <input
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                name="header-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setSearchQuery(''); (e.target as HTMLInputElement).blur(); }
                  else if (e.key === 'Enter' && searchConfig.onSubmit) { searchConfig.onSubmit(searchQuery); }
                }}
                placeholder={searchConfig.placeholder}
                className="w-full h-10 pl-10 pr-9 text-[14px] font-medium text-[#111318] bg-white border border-[var(--hairline)] rounded-full outline-none shadow-[0_1px_3px_rgba(16,24,40,0.06)] focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-[#9ca3af] transition-all"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full hover:bg-black/5 flex items-center justify-center text-[#9ca3af]">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Search trigger (mobile) - opens the full-width search overlay */}
          {searchConfig && (
            <button
              onClick={() => setMobileSearchOpen(true)}
              className="md:hidden p-2 rounded-full text-[#6b7280] hover:text-primary hover:bg-[var(--surface-2)] transition-colors"
            >
              <Search className="w-5 h-5" />
            </button>
          )}

          {/* Bell */}
          <div className="relative">
            <button
              onClick={() => { setShowNotifs(!showNotifs); setOpenDropdown(null); }}
              className={cn(
                'relative h-10 w-10 flex items-center justify-center rounded-full bg-white border border-[var(--hairline)] shadow-[0_1px_3px_rgba(16,24,40,0.06)] text-[#6b7280] hover:text-primary hover:bg-[var(--surface-2)] transition-colors',
                showNotifs && 'text-primary bg-[var(--surface-2)]'
              )}
            >
              <Bell className="w-[19px] h-[19px]" />
              {badgeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
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
                      <p className="text-[15px] font-bold text-[#111318]">Notifications</p>
                      <div className="flex items-center gap-2">
                        {(unreadAlerts > 0 || notifications.some((n) => !n.read)) && (
                          <button onClick={() => markAllNotificationsRead()} className="text-[11px] font-bold text-primary hover:underline">
                            Mark all read
                          </button>
                        )}
                        {notifications.length > 0 && (
                          <button onClick={() => clearAllNotifications()} className="text-[11px] font-bold text-[#6b7280] hover:underline">
                            Clear all
                          </button>
                        )}
                        <button onClick={() => setShowNotifs(false)} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#6b7280] transition-colors">
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
                              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
                              notifTab === tab
                                ? 'bg-[var(--accent-tint)] text-primary'
                                : 'text-[#6b7280] hover:bg-[var(--app-bg)]'
                            )}
                          >
                            {tab === 'alerts' ? 'Alerts' : 'Activity'}
                            {count > 0 && (
                              <span className={cn(
                                'min-w-[18px] h-[18px] rounded-full text-[11px] font-bold flex items-center justify-center px-1',
                                notifTab === tab ? 'bg-primary text-white' : 'bg-black/8 text-[#6b7280]'
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
                  <div className="max-h-[340px] overflow-y-auto thin-scroll divide-y divide-black/5 flex-1">
                    {(() => {
                      const list = notifTab === 'alerts' ? alertNotifs : activityNotifs;
                      if (list.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-10 gap-2">
                            <div className="w-10 h-10 rounded-2xl bg-[var(--accent-tint)] flex items-center justify-center">
                              <Bell size={20} className="text-[#c3c8cf]" />
                            </div>
                            <p className="text-[14px] font-semibold text-[#6b7280]">
                              {notifTab === 'alerts' ? 'No alerts' : 'No activity'}
                            </p>
                            <p className="text-[12px] text-[#8b929c]">
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
                              <p className={cn('text-[14px] leading-snug line-clamp-1', unread ? 'font-semibold text-[#111318]' : 'font-medium text-[#2b2f36]')}>
                                {n.title}
                              </p>
                              {n.body && (
                                <p className="text-[12.5px] text-[#6b7280] mt-0.5 leading-snug line-clamp-1">{n.body}</p>
                              )}
                              <p className="text-[11.5px] text-[#8b929c] mt-1">
                                {formatDistanceToNow(new Date(n.time), { addSuffix: true })}
                              </p>
                            </button>

                            {/* Right side: unread dot + dismiss */}
                            <div className="flex flex-col items-center gap-2 shrink-0 pt-1">
                              {unread && <div className="w-2 h-2 rounded-full bg-primary" />}
                              <button
                                onClick={(e) => { e.stopPropagation(); removeNotification(n.id); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-black/8 text-[#8b929c] transition-all"
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

          {/* Help / Raise a ticket - sits after the notification bell */}
          <button
            onClick={() => { setShowHelp(true); setShowNotifs(false); setShowProfile(false); setOpenDropdown(null); }}
            title="Help & Support"
            className="h-10 w-10 flex items-center justify-center rounded-full bg-white border border-[var(--hairline)] shadow-[0_1px_3px_rgba(16,24,40,0.06)] text-[#6b7280] hover:text-primary hover:bg-[var(--surface-2)] transition-colors"
          >
            <HelpCircle className="w-[19px] h-[19px]" />
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-black/8" />

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => { setShowProfile((v) => !v); setShowNotifs(false); setOpenDropdown(null); }}
              className="flex items-center gap-2 h-10 rounded-full bg-white border border-[var(--hairline)] shadow-[0_1px_3px_rgba(16,24,40,0.06)] pl-3.5 pr-2 hover:bg-[var(--surface-2)] transition-colors"
            >
              <div className="hidden sm:block text-right">
                <p className="text-[13px] font-semibold text-[#111318] leading-tight">{currentUser?.name ?? 'User'}</p>
                <p className="text-[11px] text-[#6b7280] leading-tight mt-0.5">{roleLabel}</p>
              </div>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12.5px] font-bold ring-2 ring-primary/20 hover:ring-primary/40 transition-all shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
              >
                {initials}
              </div>
            </button>

            {/* Profile dropdown */}
            {showProfile && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowProfile(false)} />
                <div className="absolute right-0 top-11 z-50 w-56 bg-white rounded-2xl border border-black/5 max-h-[70vh] overflow-y-auto thin-scroll"
                  style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.14)' }}>

                  {/* User info */}
                  <div className="px-4 py-3.5 border-b border-black/5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-bold shrink-0"
                        style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-[#111318] truncate">{currentUser?.name}</p>
                        <p className="text-[12px] text-[#6b7280] truncate">{currentUser?.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div className="py-1.5">
                    <Link to="/settings/company" onClick={() => setShowProfile(false)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] text-[#111318] hover:bg-[var(--app-bg)] transition-colors">
                      <User className="w-4 h-4 text-[#6b7280]" /> Profile
                    </Link>
                    <Link to="/settings" onClick={() => setShowProfile(false)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] text-[#111318] hover:bg-[var(--app-bg)] transition-colors">
                      <Settings className="w-4 h-4 text-[#6b7280]" /> Settings
                    </Link>
                  </div>

                  <div className="border-t border-black/5 py-1.5">
                    <button onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[14px] text-red-500 hover:bg-red-50 transition-colors font-medium">
                      <LogOut className="w-4 h-4" /> Log out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Help / Raise a ticket modal ── */}
      {showHelp && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => !helpSending && setShowHelp(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-[0_24px_70px_rgba(16,24,40,0.24)] overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-[var(--hairline)]">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <LifeBuoy className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-headline font-bold text-[16px] text-[#111318] leading-tight">Help &amp; Support</h3>
                <p className="text-[12.5px] text-[#6b7280] mt-0.5">Describe your issue and we'll get back to you by email.</p>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                disabled={helpSending}
                className="p-1.5 rounded-lg text-[#6b7280] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3.5">
              <div>
                <label className="block text-[12.5px] font-semibold text-[#111318] mb-1.5">Subject</label>
                <input
                  autoFocus
                  value={helpSubject}
                  onChange={(e) => setHelpSubject(e.target.value)}
                  maxLength={200}
                  placeholder="Brief summary of the issue"
                  className="w-full h-10 px-3 text-[14px] text-[#111318] bg-white border border-[var(--hairline)] rounded-lg outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15 placeholder:text-[#9ca3af] transition-all"
                />
              </div>
              <div>
                <label className="block text-[12.5px] font-semibold text-[#111318] mb-1.5">Describe your issue</label>
                <textarea
                  value={helpMessage}
                  onChange={(e) => setHelpMessage(e.target.value)}
                  maxLength={5000}
                  rows={5}
                  placeholder="Tell us what's happening, what you expected, and any steps to reproduce it."
                  className="w-full px-3 py-2.5 text-[14px] text-[#111318] bg-white border border-[var(--hairline)] rounded-lg outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15 placeholder:text-[#9ca3af] transition-all resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--hairline)] bg-[var(--surface-2)]/50">
              <button
                onClick={() => setShowHelp(false)}
                disabled={helpSending}
                className="px-4 h-10 rounded-lg text-[14px] font-semibold text-[#6b7280] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitTicket}
                disabled={helpSending || !helpSubject.trim() || !helpMessage.trim()}
                className="inline-flex items-center gap-2 px-4 h-10 rounded-lg text-[14px] font-bold text-white transition-all hover:-translate-y-px disabled:opacity-50 disabled:hover:translate-y-0"
                style={{ background: 'linear-gradient(90deg, var(--brand-dark), var(--brand))' }}
              >
                <Send className="w-4 h-4" />
                {helpSending ? 'Sending…' : 'Raise Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
