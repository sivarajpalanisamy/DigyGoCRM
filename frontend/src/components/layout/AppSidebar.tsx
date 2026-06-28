import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, MessageSquare, Zap, Inbox, Settings,
  UserCog, SlidersHorizontal, ChevronDown, ChevronRight, X, Database, ShieldCheck, CalendarDays, BarChart2, Phone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useBrandingStore } from '@/store/brandingStore';
import { useCompanyStore } from '@/store/companyStore';

interface NavItem {
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: { label: string; path: string }[];
  /** Single key — item visible if this permission is true */
  permKey?: string;
  /** Any-of keys — item visible if at least one of these is true */
  anyOf?: string[];
  /** Only owner/super_admin can see this */
  ownerOnly?: boolean;
  /** Gated behind a per-tenant feature flag (hidden when the flag is off, even for owner) */
  feature?: 'superfone';
}

const navItems: NavItem[] = [
  { label: 'Dashboard',       icon: LayoutDashboard,   path: '/dashboard' },
  {
    label: 'Lead Management', icon: Users,              path: '/leads',
    anyOf: ['leads:view_all', 'leads:view_own', 'contacts:read'],
  },
  {
    label: 'Lead Generation', icon: Database,           path: '/lead-generation',
    anyOf: ['meta_forms:read', 'custom_forms:read', 'landing_pages:read', 'whatsapp_setup:read'],
  },
  { label: 'Automation',      icon: Zap,               path: '/automation',      permKey: 'automation:view' },
  { label: 'Reports',         icon: BarChart2,          path: '/reports' },
  { label: 'Calendar',        icon: CalendarDays,       path: '/calendar',        permKey: 'calendar:view' },
  { label: 'Inbox',           icon: Inbox,              path: '/inbox',           permKey: 'inbox:view_all' },
  { label: 'Calls',           icon: Phone,              path: '/calls',           anyOf: ['calls:view_all', 'calls:view_own'] },
  { label: 'Superfone',       icon: Phone,              path: '/superfone-calls', anyOf: ['calls:view_all', 'calls:view_own'], feature: 'superfone' },
  { label: 'Fields',          icon: SlidersHorizontal,  path: '/fields',          permKey: 'fields:view' },
  { label: 'Staff',           icon: UserCog,            path: '/staff',           permKey: 'staff:view' },
  { label: 'Settings',        icon: Settings,           path: '/settings',        permKey: 'settings:manage' },
];

export function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const [expanded, setExpanded] = useState<string[]>(['Lead Generation', 'Automation']);
  const currentUser = useAuthStore((s) => s.currentUser);
  const { branded, tenantName, logoUrl } = useBrandingStore();
  const permissions = useAuthStore((s) => s.permissions);
  const permAll = useAuthStore((s) => s.permAll);
  const superfoneEnabled = useCompanyStore((s) => s.superfoneEnabled);
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const visibleNavItems = navItems.filter((item) => {
    // Feature flag wins over everything (even owner) — Calls hidden if Superfone is off.
    if (item.feature === 'superfone' && !superfoneEnabled) return false;
    if (item.ownerOnly) return isSuperAdmin || permAll;
    if (isSuperAdmin || permAll) return true;
    if (item.anyOf) return item.anyOf.some((k) => permissions[k] === true);
    if (item.permKey) return permissions[item.permKey] === true;
    return true;
  });

  const toggleExpand = (label: string) =>
    setExpanded((prev) => prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]);

  const isActive = (path?: string) => {
    if (!path) return false;
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

  const isChildActive = (item: NavItem) => item.children?.some((c) => {
    const [p] = c.path.split('?');
    return location.pathname.startsWith(p);
  });

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside className={cn(
        'fixed top-0 left-0 z-50 h-full w-[218px] bg-[var(--app-bg)] border-r border-black/5 flex flex-col transition-transform duration-300',
        'md:translate-x-0 md:static md:z-auto',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>

        {/* Logo — show tenant brand on custom domain, DigyGo logo otherwise */}
        <div
          className="relative flex justify-center items-center border-b border-black/5 shrink-0 overflow-hidden"
          style={{ height: '80px' }}
        >
          {branded && logoUrl ? (
            <img src={logoUrl} alt={tenantName ?? ''} className="max-h-12 max-w-[160px] object-contain" />
          ) : branded && tenantName ? (
            <span className="font-bold text-[15px] text-[#1c1410] px-3 text-center">{tenantName}</span>
          ) : (
            <img
              src="/hawcus-logo.png"
              alt="Hawcus"
              style={{ width: '160px', height: '160px', marginTop: '-36px', flexShrink: 0 }}
            />
          )}
          <button
            onClick={onClose}
            className="absolute right-2 top-1/2 -translate-y-1/2 md:hidden p-1.5 rounded-lg text-[#7a6b5c] hover:bg-[var(--accent-tint)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2.5 space-y-0.5">
          {/* Super admin: Dashboard + Business */}
          {isSuperAdmin && (
            <>
              <Link
                to="/admin/dashboard"
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200',
                  location.pathname === '/admin/dashboard'
                    ? 'bg-primary text-white font-semibold'
                    : 'text-primary bg-primary/10 hover:bg-primary/20'
                )}
              >
                <LayoutDashboard className="w-[18px] h-[18px] shrink-0" />
                Dashboard
              </Link>
              <Link
                to="/admin"
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200',
                  (location.pathname === '/admin' || location.pathname === '/admin/create') && !location.pathname.includes('/dashboard') && !location.pathname.includes('/team')
                    ? 'bg-primary text-white font-semibold'
                    : 'text-primary bg-primary/10 hover:bg-primary/20'
                )}
              >
                <ShieldCheck className="w-[18px] h-[18px] shrink-0" />
                Business
              </Link>
              <Link
                to="/admin/team"
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200',
                  location.pathname === '/admin/team'
                    ? 'bg-primary text-white font-semibold'
                    : 'text-primary bg-primary/10 hover:bg-primary/20'
                )}
              >
                <Users className="w-[18px] h-[18px] shrink-0" />
                Team
              </Link>
            </>
          )}
          {!isSuperAdmin && visibleNavItems.map((item) => (
            <div key={item.label}>
              {item.children ? (
                <>
                  <button
                    onClick={() => toggleExpand(item.label)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200',
                      isChildActive(item)
                        ? 'bg-[var(--accent-tint)] text-primary font-semibold'
                        : 'text-[#6b4f30] hover:bg-[var(--accent-tint)] hover:text-primary'
                    )}
                  >
                    <item.icon className="w-[18px] h-[18px] shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {expanded.includes(item.label) || isChildActive(item)
                      ? <ChevronDown className="w-4 h-4 opacity-60" />
                      : <ChevronRight className="w-4 h-4 opacity-40" />}
                  </button>
                  {(expanded.includes(item.label) || isChildActive(item)) && (
                    <div className="ml-7 mt-0.5 mb-1 space-y-0.5">
                      {item.children.map((child) => (
                        <Link
                          key={child.path}
                          to={child.path}
                          onClick={onClose}
                          className={cn(
                            'block px-3 py-2 rounded-xl text-[13px] transition-all duration-200',
                            isActive(child.path)
                              ? 'bg-[var(--accent-tint)] text-primary font-semibold'
                              : 'text-[#7a6b5c] hover:bg-[var(--accent-tint)] hover:text-primary'
                          )}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Link
                  to={item.path!}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200',
                    isActive(item.path)
                      ? 'bg-[var(--accent-tint)] text-primary font-semibold'
                      : 'text-[#6b4f30] hover:bg-[var(--accent-tint)] hover:text-primary'
                  )}
                >
                  <item.icon className="w-[18px] h-[18px] shrink-0" />
                  {item.label}
                </Link>
              )}
            </div>
          ))}
        </nav>

        <div className="pb-2" />
      </aside>
    </>
  );
}
