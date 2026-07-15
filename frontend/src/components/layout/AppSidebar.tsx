import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Gauge, UsersRound, Megaphone, Workflow, Inbox, Settings,
  UserCog, SlidersHorizontal, X, Building2, CalendarDays, ChartNoAxesCombined,
  Phone, PhoneCall, IndianRupee, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useBrandingStore } from '@/store/brandingStore';
import { useCompanyStore } from '@/store/companyStore';

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Single key - item visible if this permission is true */
  permKey?: string;
  /** Any-of keys - item visible if at least one of these is true */
  anyOf?: string[];
  /** Only owner/super_admin can see this */
  ownerOnly?: boolean;
  /** Gated behind a per-tenant feature flag (hidden when the flag is off, even for owner) */
  feature?: 'superfone';
}

const navItems: NavItem[] = [
  { label: 'Dashboard',       icon: Gauge,             path: '/dashboard' },
  { label: 'Lead Management', icon: UsersRound,        path: '/leads',           anyOf: ['leads:view_all', 'leads:view_own', 'contacts:read'] },
  { label: 'Lead Generation', icon: Megaphone,         path: '/lead-generation', anyOf: ['meta_forms:read', 'custom_forms:read', 'landing_pages:read', 'whatsapp_setup:read'] },
  { label: 'Automation',      icon: Workflow,          path: '/automation',      permKey: 'automation:view' },
  { label: 'Reports',         icon: ChartNoAxesCombined, path: '/reports' },
  { label: 'Calendar',        icon: CalendarDays,      path: '/calendar',        permKey: 'calendar:view' },
  { label: 'Inbox',           icon: Inbox,             path: '/inbox',           permKey: 'inbox:view_all' },
  { label: 'Calls',           icon: Phone,             path: '/calls',           anyOf: ['calls:view_all', 'calls:view_own'] },
  { label: 'Superfone',       icon: PhoneCall,         path: '/superfone-calls', anyOf: ['calls:view_all', 'calls:view_own'], feature: 'superfone' },
  { label: 'Payments',        icon: IndianRupee,       path: '/payments',        permKey: 'integrations:view' },
  { label: 'Fields',          icon: SlidersHorizontal, path: '/fields',          permKey: 'fields:view' },
  { label: 'Staff',           icon: UserCog,           path: '/staff',           permKey: 'staff:view' },
  { label: 'Settings',        icon: Settings,          path: '/settings',        permKey: 'settings:manage' },
];

const superAdminItems: { label: string; icon: React.ElementType; path: string; match: (p: string) => boolean }[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/admin/dashboard', match: (p) => p === '/admin/dashboard' },
  { label: 'Business',  icon: Building2,       path: '/admin',           match: (p) => (p === '/admin' || p === '/admin/create') && !p.includes('/dashboard') && !p.includes('/team') },
  { label: 'Team',      icon: UsersRound,      path: '/admin/team',      match: (p) => p === '/admin/team' },
];

const COLLAPSE_KEY = 'dg_sidebar_collapsed';

export function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    // Default to the icon-only rail (Finexy style) unless the user explicitly expanded it.
    try { return localStorage.getItem(COLLAPSE_KEY) !== '0'; } catch { return true; }
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });

  // As a mobile drawer (open=true) always show full labels; the icon-only rail is a
  // desktop-only affordance (hover tooltips don't work on touch).
  const isCollapsed = collapsed && !open;

  // Tooltip shown next to an icon when the sidebar is collapsed. Rendered via a
  // portal so it is never clipped by the nav's scroll overflow. Positioned from the
  // hovered row's on-screen rect.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);

  const currentUser = useAuthStore((s) => s.currentUser);
  const { branded, tenantName, logoUrl, faviconUrl } = useBrandingStore();
  const permissions = useAuthStore((s) => s.permissions);
  const permAll = useAuthStore((s) => s.permAll);
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const visibleNavItems = navItems.filter((item) => {
    if (item.feature === 'superfone' && !superfoneEnabled) return false;
    if (item.ownerOnly) return isSuperAdmin || permAll;
    if (isSuperAdmin || permAll) return true;
    if (item.anyOf) return item.anyOf.some((k) => permissions[k] === true);
    if (item.permKey) return permissions[item.permKey] === true;
    return true;
  });

  const isActive = (path: string) => {
    const [p, q] = path.split('?');
    if (q) return location.pathname === p && location.search === `?${q}`;
    // Lead Management sidebar item lives at /leads but also covers /lead-management/*
    if (p === '/leads') {
      return location.pathname === '/leads'
        || location.pathname === '/lead-management'
        || location.pathname.startsWith('/lead-management/');
    }
    return location.pathname === p || location.pathname.startsWith(p + '/');
  };

  // One consistent row style for BOTH super-admin and tenant nav.
  const row = (key: string, Icon: React.ElementType, label: string, to: string, active: boolean) => (
    <Link
      key={key}
      to={to}
      onClick={() => { setTip(null); onClose(); }}
      onMouseEnter={isCollapsed ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ label, top: r.top + r.height / 2, left: r.right + 10 });
      } : undefined}
      onMouseLeave={isCollapsed ? () => setTip(null) : undefined}
      className={cn(
        'relative flex items-center text-[13.5px] transition-all duration-200',
        isCollapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-3 px-3 py-2 rounded-xl',
        active
          ? isCollapsed
            ? 'rounded-full bg-primary text-white ring-4 ring-white shadow-[0_2px_10px_rgba(234,88,12,0.40)] font-semibold'
            : 'bg-[var(--accent-tint)] text-primary font-semibold'
          : 'rounded-xl text-[#4a4f57] font-medium hover:bg-[var(--surface-2)] hover:text-[#111318]'
      )}
    >
      {active && !isCollapsed && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary" />}
      <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
      {!isCollapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onClose} />}

      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full flex flex-col transition-[width,transform] duration-300',
          'bg-white border-r border-[var(--hairline)] shadow-[2px_0_8px_-4px_rgba(16,24,40,0.06)]',
          'md:translate-x-0 md:static md:z-auto md:h-full md:bg-transparent md:border-0 md:shadow-none md:gap-2',
          isCollapsed ? 'w-[62px]' : (open ? 'w-[260px]' : 'w-[192px]'),
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo - its own panel on desktop, sitting above (and wider than) the rail */}
        <div
          className="relative flex justify-center items-center shrink-0 overflow-hidden border-b border-[var(--hairline)] md:border-b-0"
          style={{ height: '52px' }}
        >
          {isCollapsed ? (
            faviconUrl ? (
              <img src={faviconUrl} alt={tenantName ?? ''} className="w-9 h-9 object-contain rounded-full ring-[3px] ring-white shadow-[0_2px_8px_rgba(16,24,40,0.12)]" />
            ) : tenantName ? (
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-[16px] text-white leading-none ring-[3px] ring-white shadow-[0_2px_8px_rgba(16,24,40,0.12)]"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark), var(--brand-light))' }}
              >
                {tenantName.trim().charAt(0).toUpperCase()}
              </div>
            ) : (
              <img src="/favicon.png" alt="Hawcus" className="w-9 h-9 object-contain" />
            )
          ) : branded && logoUrl ? (
            <img src={logoUrl} alt={tenantName ?? ''} className="max-h-14 max-w-[172px] object-contain" />
          ) : branded && tenantName ? (
            <span className="font-bold text-[18px] text-[#111318] px-3 text-center truncate">{tenantName}</span>
          ) : (
            <img src="/hawcus-logo.png" alt="Hawcus" className="max-h-11 max-w-[164px] object-contain" />
          )}
          <button
            onClick={onClose}
            className="absolute right-2 top-1/2 -translate-y-1/2 md:hidden p-1.5 rounded-lg text-[#6b7280] hover:bg-[var(--accent-tint)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Rail panel - separate card; slightly narrower than the logo when collapsed */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Nav */}
        <nav className={cn('flex-1 overflow-y-auto scrollbar-hide py-3', isCollapsed ? 'px-2 space-y-1' : 'px-2.5 space-y-1')}>
          {!isCollapsed && (
            <p className="px-3 pb-1.5 pt-0.5 text-[11px] font-bold uppercase tracking-wider text-[#9ca3af]">Menu</p>
          )}
          {isSuperAdmin
            ? superAdminItems.map((it) => row(it.path, it.icon, it.label, it.path, it.match(location.pathname)))
            : visibleNavItems.map((item) => row(item.label, item.icon, item.label, item.path, isActive(item.path)))}
        </nav>

        {/* Collapse / expand toggle - desktop only */}
        <div className="hidden md:block border-t border-[var(--hairline)] p-2">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'w-full flex items-center rounded-xl text-[13.5px] font-medium text-[#6b7280] hover:bg-[var(--surface-2)] hover:text-[#111318] transition-colors',
              collapsed ? 'justify-center py-2.5' : 'gap-2.5 px-3 py-2.5'
            )}
          >
            {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
        </div>
      </aside>

      {/* Collapsed-mode hover label - portaled to body so scroll overflow never clips it */}
      {isCollapsed && tip && createPortal(
        <div
          className="pointer-events-none fixed z-[60] -translate-y-1/2 rounded-lg bg-[#111318] px-2.5 py-1.5 text-[13px] font-semibold text-white shadow-lg whitespace-nowrap"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </div>,
        document.body
      )}
    </>
  );
}
