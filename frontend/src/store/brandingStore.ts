import { create } from 'zustand';
import { api } from '@/lib/api';

// Convert hex color (#c2410c) to HSL string ("21 90% 48%") for CSS variables
function hexToHsl(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '21 90% 48%'; // fallback to DigyGo orange
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// Adjust a hex color's lightness by delta (-1..1). Used to derive brand-dark/brand-light shades.
function shade(hex: string, delta: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  let r = parseInt(clean.slice(0, 2), 16);
  let g = parseInt(clean.slice(2, 4), 16);
  let b = parseInt(clean.slice(4, 6), 16);
  const adj = (c: number) => {
    if (delta < 0) return Math.max(0, Math.round(c * (1 + delta)));       // darken
    return Math.min(255, Math.round(c + (255 - c) * delta));             // lighten
  };
  r = adj(r); g = adj(g); b = adj(b);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Mix a hex color with white. amount=0 → pure color, amount=1 → white.
function mixWhite(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return '#' + [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Derive a complete, harmonious palette from a single brand color.
export function derivePalette(hex: string) {
  return {
    brand:      hex,
    brandDark:  shade(hex, -0.14),    // gradients, hover, headings
    brandLight: shade(hex, 0.10),     // gradient end
    // Cool neutral surfaces (design system) - the brand color stays the accent,
    // but backgrounds/hovers are neutral grey, not brand-tinted, so the UI reads clean.
    accentTint: '#eef1f4',  // soft neutral hover / selected background
    appBg:      '#eceef1',  // neutral app background
  };
}

// Apply theme. Single source of truth: the brand color.
// Always derives + applies the full palette from the chosen color.
function applyTheme(brandColor?: string | null): void {
  const root = document.documentElement;
  const hex = (brandColor || '').toLowerCase();
  if (!hex || hex.length !== 7) { clearTheme(); return; }

  const p = derivePalette(hex);
  root.style.setProperty('--brand', p.brand);
  root.style.setProperty('--brand-dark', p.brandDark);
  root.style.setProperty('--brand-light', p.brandLight);
  root.style.setProperty('--app-bg', p.appBg);
  root.style.setProperty('--accent-tint', p.accentTint);
  // Tailwind HSL tokens (bg-primary / text-primary / opacity variants)
  root.style.setProperty('--primary', hexToHsl(p.brand));
  root.style.setProperty('--primary-dark', hexToHsl(p.brandDark));
  root.style.setProperty('--color-primary', p.brand);
}

function clearTheme(): void {
  const root = document.documentElement;
  ['--brand', '--brand-dark', '--brand-light', '--app-bg', '--accent-tint', '--primary', '--primary-dark', '--color-primary']
    .forEach((v) => root.style.removeProperty(v));
}

function applyFavicon(url: string | null): void {
  if (!url) return;
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
}

function applyTitle(title: string | null): void {
  if (title) document.title = title;
}

export interface BrandingData {
  name?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  bannerUrl?: string | null;
  brandColor?: string | null;
  loginBgColor?: string | null;
  tabTitle?: string | null;
  appBgColor?: string | null;
  accentColor?: string | null;
}

interface BrandingState {
  isCustomDomain: boolean;
  branded: boolean;          // true if any custom branding (logo/name) is active
  tenantName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  bannerUrl: string | null;
  brandColor: string;
  loginBgColor: string | null;
  tabTitle: string | null;
  appBgColor: string | null;
  accentColor: string | null;
  loaded: boolean;
  fetchBranding: () => Promise<void>;          // pre-login: by custom domain
  applyTenantBranding: (d: BrandingData) => void; // post-login: by authed tenant
  resetBranding: () => void;                   // on logout
}

const DEFAULT_COLOR = '#c2410c';

export const useBrandingStore = create<BrandingState>((set) => ({
  isCustomDomain: false,
  branded: false,
  tenantName: null,
  logoUrl: null,
  faviconUrl: null,
  bannerUrl: null,
  brandColor: DEFAULT_COLOR,
  loginBgColor: null,
  tabTitle: null,
  appBgColor: null,
  accentColor: null,
  loaded: false,

  // Pre-login: fetch branding for the current custom domain (login page)
  fetchBranding: async () => {
    const hostname = window.location.hostname;
    const isCustom = hostname !== 'app.hawcus.com' && hostname !== 'crm.digygo.in' && hostname !== 'localhost' && hostname !== '127.0.0.1';

    if (!isCustom) {
      set({ isCustomDomain: false, loaded: true });
      return;
    }

    try {
      const data = await api.get<BrandingData>(`/api/public/branding?domain=${hostname}`);
      const brandColor = data.brandColor ?? DEFAULT_COLOR;
      set({
        isCustomDomain: true,
        branded: true,
        tenantName: data.name ?? null,
        logoUrl: data.logoUrl ?? null,
        faviconUrl: data.faviconUrl ?? null,
        bannerUrl: data.bannerUrl ?? null,
        brandColor,
        loginBgColor: data.loginBgColor ?? null,
        tabTitle: data.tabTitle ?? null,
        appBgColor: data.appBgColor ?? null,
        accentColor: data.accentColor ?? null,
        loaded: true,
      });
      applyTheme(brandColor);
      applyFavicon(data.faviconUrl ?? null);
      applyTitle(data.tabTitle ?? null);
    } catch {
      set({ isCustomDomain: false, loaded: true });
    }
  },

  // Post-login: apply the authenticated tenant's branding (any domain)
  applyTenantBranding: (d: BrandingData) => {
    // Subscription gate: the tenant payload carries blocked + subscription fields.
    const anyD = d as any;
    import('./billingStore').then(({ useBillingStore }) => {
      if (anyD?.blocked) {
        useBillingStore.getState().setBlocked({
          status: anyD.subscription_status, business_name: anyD.name,
          billing_cycle: anyD.billing_cycle, expires_at: anyD.subscription_expires_at,
          amount_due: anyD.plan_price,
        });
      } else {
        useBillingStore.getState().clear();
      }
    });
    const brandColor = d.brandColor ?? DEFAULT_COLOR;
    const hasCustom = !!(d.logoUrl || d.tabTitle || (d.brandColor && d.brandColor !== DEFAULT_COLOR) || d.faviconUrl || d.appBgColor || d.accentColor);
    set({
      branded: hasCustom,
      tenantName: d.name ?? null,
      logoUrl: d.logoUrl ?? null,
      faviconUrl: d.faviconUrl ?? null,
      bannerUrl: d.bannerUrl ?? null,
      brandColor,
      loginBgColor: d.loginBgColor ?? null,
      tabTitle: d.tabTitle ?? null,
      appBgColor: d.appBgColor ?? null,
      accentColor: d.accentColor ?? null,
      loaded: true,
    });
    applyTheme(brandColor);
    applyFavicon(d.faviconUrl ?? null);
    applyTitle(d.tabTitle ?? null);
  },

  resetBranding: () => {
    clearTheme();
    set({
      isCustomDomain: false, branded: false, tenantName: null, logoUrl: null,
      faviconUrl: null, bannerUrl: null, brandColor: DEFAULT_COLOR,
      loginBgColor: null, tabTitle: null, appBgColor: null, accentColor: null,
    });
    // Restore default favicon and title
    document.title = 'Hawcus CRM';
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (link) link.href = '/favicon.png';
  },
}));
