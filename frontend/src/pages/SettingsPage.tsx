import { Building2, Plug, Bell, ChevronRight, Palette, ShieldCheck, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

const settingsCards = [
  { title: 'Branding', description: 'Customize logo, favicon, colors, and login page', icon: Palette, iconBg: 'bg-primary/10 text-primary', path: '/settings/branding' },
  { title: 'Company Details', description: 'Manage legal info and workspace identity', icon: Building2, iconBg: 'bg-primary/10 text-primary', path: '/settings/company' },
  { title: 'Security', description: 'Two-factor authentication for your team', icon: ShieldCheck, iconBg: 'bg-primary/10 text-primary', path: '/settings/security' },
  { title: 'Dialer Device Pair', description: 'Verify a mobile number (OTP) and manage Hawcus Dialer phones', icon: Smartphone, iconBg: 'bg-primary/10 text-primary', path: '/settings/devices' },
  { title: 'Integrations', description: 'Connect Meta, WhatsApp, email providers, and more', icon: Plug, iconBg: 'bg-primary/10 text-primary', path: '/settings/integrations' },
  { title: 'Notifications', description: 'Configure in-app and email notification preferences', icon: Bell, iconBg: 'bg-primary/10 text-primary', path: '/settings/notifications' },
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
            className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow card-hover p-6 text-left flex items-center gap-4 w-full active:scale-[0.99] transition group"
          >
            <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', card.iconBg)}>
              <card.icon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-headline font-bold text-[#111318]">{card.title}</h3>
              <p className="text-[15px] text-[#6b7280] mt-0.5">{card.description}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-[#9ca3af] shrink-0 group-hover:text-primary transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
