import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, UsersRound, Megaphone, Zap, Inbox, Settings,
  UserCog, SlidersHorizontal, X, Building2, CalendarDays, BarChart3,
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
  { label: 'Dashboard',       icon: LayoutDashboard,   path: '/dashboard' },
  { label: 'Lead Management', icon: UsersRound,        path: '/leads',           anyOf: ['leads:view_all', 'leads:view_own', 'contacts:read'] },
  { label: 'Lead Generation', icon: Megaphone,         path: '/lead-generation', anyOf: ['meta_forms:read', 'custom_forms:read', 'landing_pages:read', 'whatsapp_setup:read'] },
  { label: 'Automation',      icon: Zap,               path: '/automation',      permKey: 'automation:view' },
  { label: 'Reports',         icon: BarChart3,         path: '/reports' },
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
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });

  // Tooltip shown next to an icon when the sidebar is collapsed. Rendered via a
  // portal so it is never clipped by the nav's scroll overflow. Positioned from the
  // hovered row's on-screen rect.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);

  const currentUser = useAuthStore((s) => s.currentUser);
  const { branded, tenantName, logoUrl } = useBrandingStore();
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
      onMouseEnter={collapsed ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ label, top: r.top + r.height / 2, left: r.right + 10 });
      } : undefined}
      onMouseLeave={collapsed ? () => setTip(null) : undefined}
      className={cn(
        'relative flex items-center rounded-xl text-[13px] transition-all duration-200',
        collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
        active
          ? 'bg-[var(--accent-tint)] text-primary font-semibold'
          : 'text-[#5c4a3a] font-medium hover:bg-black/[0.035] hover:text-[#1c1410]'
      )}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary" />}
      <Icon className="w-[19px] h-[19px] shrink-0" strokeWidth={2} />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onClose} />}

      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full bg-white border-r-2 border-black/10 shadow-[2px_0_8px_-4px_rgba(20,15,10,0.06)] flex flex-col transition-[width,transform] duration-300',
          'md:translate-x-0 md:static md:z-auto',
          collapsed ? 'w-[72px]' : 'w-[204px]',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo - tenant brand on custom domain, Hawcus otherwise; mark only when collapsed */}
        <div
          className="relative flex justify-center items-center border-b-2 border-black/10 shrink-0 overflow-hidden"
          style={{ height: '64px' }}
        >
          {collapsed ? (
            <img src="/favicon.png" alt="Hawcus" className="w-8 h-8 object-contain" />
          ) : branded && logoUrl ? (
            <img src={logoUrl} alt={tenantName ?? ''} className="max-h-11 max-w-[160px] object-contain" />
          ) : branded && tenantName ? (
            <span className="font-bold text-[15px] text-[#1c1410] px-3 text-center truncate">{tenantName}</span>
          ) : (
            <img src="/hawcus-logo.png" alt="Hawcus" className="max-h-9 max-w-[150px] object-contain" />
          )}
          <button
            onClick={onClose}
            className="absolute right-2 top-1/2 -translate-y-1/2 md:hidden p-1.5 rounded-lg text-[#7a6b5c] hover:bg-[var(--accent-tint)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-1">
          {!collapsed && (
            <p className="px-3 pb-1.5 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-[#b3a290]">Menu</p>
          )}
          {isSuperAdmin
            ? superAdminItems.map((it) => row(it.path, it.icon, it.label, it.path, it.match(location.pathname)))
            : visibleNavItems.map((item) => row(item.label, item.icon, item.label, item.path, isActive(item.path)))}
        </nav>

        {/* Collapse / expand toggle - desktop only */}
        <div className="hidden md:block border-t-2 border-black/10 p-2.5">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'w-full flex items-center rounded-xl text-[12.5px] font-medium text-[#7a6b5c] hover:bg-black/[0.035] hover:text-[#1c1410] transition-colors',
              collapsed ? 'justify-center py-2.5' : 'gap-2.5 px-3 py-2.5'
            )}
          >
            {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Collapsed-mode hover label - portaled to body so scroll overflow never clips it */}
      {collapsed && tip && createPortal(
        <div
          className="pointer-events-none fixed z-[60] -translate-y-1/2 rounded-lg bg-[#1c1410] px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-lg whitespace-nowrap"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </div>,
        document.body
      )}
    </>
  );
}
