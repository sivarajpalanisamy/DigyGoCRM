import { Building2, Plug, Bell, ChevronRight, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

const settingsCards = [
  { title: 'Branding', description: 'Customize logo, favicon, colors, and login page', icon: Palette, iconBg: 'bg-pink-100 text-pink-600', path: '/settings/branding' },
  { title: 'Company Details', description: 'Manage legal info and workspace identity', icon: Building2, iconBg: 'bg-purple-100 text-purple-600', path: '/settings/company' },
  { title: 'Integrations', description: 'Connect Meta, WhatsApp, email providers, and more', icon: Plug, iconBg: 'bg-primary/10 text-primary', path: '/settings/integrations' },
  { title: 'Notifications', description: 'Configure in-app and email notification preferences', icon: Bell, iconBg: 'bg-yellow-100 text-yellow-600', path: '/settings/notifications' },
];

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {settingsCards.map((card) => (
          <button
            key={card.title}
            onClick={() => card.path && navigate(card.path)}
            className="bg-white rounded-2xl border border-black/5 card-shadow p-6 text-left flex items-center gap-4 w-full hover:-translate-y-0.5 transition-all duration-200 group"
          >
            <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center shrink-0', card.iconBg)}>
              <card.icon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-headline font-bold text-[#1c1410]">{card.title}</h3>
              <p className="text-[13px] text-[#7a6b5c] mt-0.5">{card.description}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-[#b09e8d] shrink-0 group-hover:text-primary transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
