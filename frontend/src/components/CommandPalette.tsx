import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserSquare, MessageSquare, Calendar, BarChart3,
  Settings, Zap, Phone, UserCog, Megaphone, ListChecks, User,
} from 'lucide-react';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command';
import { api } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';

interface LeadHit { id: string; name?: string | null; phone?: string | null; email?: string | null }

const NAV: { label: string; path: string; icon: typeof Users }[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Leads (Pipeline)', path: '/leads', icon: Users },
  { label: 'Follow-ups', path: '/lead-management/followups', icon: ListChecks },
  { label: 'Contacts', path: '/lead-management/contacts', icon: UserSquare },
  { label: 'Inbox', path: '/inbox', icon: MessageSquare },
  { label: 'Calendar', path: '/calendar', icon: Calendar },
  { label: 'Calls', path: '/calls', icon: Phone },
  { label: 'Reports', path: '/reports', icon: BarChart3 },
  { label: 'Automation', path: '/automation/workflows', icon: Zap },
  { label: 'Broadcast', path: '/automation/waba-broadcast', icon: Megaphone },
  { label: 'Staff', path: '/staff', icon: UserCog },
  { label: 'Settings', path: '/settings', icon: Settings },
];

/**
 * App-wide command palette (Cmd/Ctrl+K). Jump to any page or search leads by
 * name/phone/email (server-side) and deep-link to them. Mounted once in
 * AppLayout so it's available on every authenticated page.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<LeadHit[]>([]);
  const debounced = useDebounce(query, 250);
  const navigate = useNavigate();

  // Global toggle. Capture phase so page-level Cmd/Ctrl+K handlers don't pre-empt it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => { if (!open) { setQuery(''); setLeads([]); } }, [open]);

  useEffect(() => {
    if (debounced.trim().length < 2) { setLeads([]); return; }
    let cancelled = false;
    api.get<any>(`/api/leads?search=${encodeURIComponent(debounced.trim())}&limit=6`)
      .then((rows) => {
        if (cancelled) return;
        const list: LeadHit[] = Array.isArray(rows) ? rows : (rows?.leads ?? []);
        setLeads(list);
      })
      .catch(() => { if (!cancelled) setLeads([]); });
    return () => { cancelled = true; };
  }, [debounced]);

  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search leads or jump to a page..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Go to">
          {NAV.map((n) => (
            <CommandItem key={n.path} value={`nav ${n.label}`} onSelect={() => go(n.path)}>
              <n.icon className="mr-2 h-4 w-4 text-[#7a6b5c]" />
              <span>{n.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {leads.length > 0 && (
          <CommandGroup heading="Leads">
            {leads.map((l) => (
              <CommandItem
                key={l.id}
                value={`lead ${l.name ?? ''} ${l.phone ?? ''} ${l.email ?? ''} ${l.id}`}
                onSelect={() => go(`/leads?highlight=${l.id}`)}
              >
                <User className="mr-2 h-4 w-4 text-[#7a6b5c]" />
                <span className="truncate">{l.name || 'Unnamed lead'}</span>
                {l.phone && <span className="ml-2 text-xs text-muted-foreground truncate">{l.phone}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
