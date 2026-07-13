import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Inbox, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const bottomItems = [
  { label: 'Dashboard',  icon: LayoutDashboard,   path: '/dashboard' },
  { label: 'Leads',      icon: Users,              path: '/lead-management' },
  { label: 'Inbox',      icon: Inbox,              path: '/inbox' },
  { label: 'Settings',   icon: Settings,           path: '/settings' },
];

export function MobileBottomNav() {
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--hairline)] safe-area-pb"
      style={{ boxShadow: '0 -1px 0 rgba(16,24,40,0.03), 0 -4px 16px rgba(16,24,40,0.05)' }}>
      <div className="flex items-stretch h-16 px-1.5">
        {bottomItems.map((item) => {
          const active = isActive(item.path);
          return (
            <Link key={item.path} to={item.path}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 my-2 mx-0.5 rounded-2xl transition-all relative',
                active ? 'text-primary bg-primary/[0.08]' : 'text-[#6b7280] active:bg-[var(--surface-2)]'
              )}>
              <item.icon className={cn('w-5 h-5 transition-all', active && 'scale-110')} />
              <span className={cn('text-[11px] leading-none font-medium', active && 'font-semibold')}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
