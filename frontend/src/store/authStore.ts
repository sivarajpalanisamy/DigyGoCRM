import { create } from 'zustand';
import { api, setAccessToken } from '@/lib/api';
import { useCompanyStore } from '@/store/companyStore';
import { useBrandingStore } from '@/store/brandingStore';
import { getSocket } from '@/lib/socket';

const BASE = import.meta.env.VITE_API_URL ?? '';

const TOKEN_KEY  = 'dg_tok';
const USER_KEY   = 'dg_usr';
const TENANT_KEY = 'dg_ten';
// Marks that the current session is an impersonation, so the "Back to Admin"
// button survives a page refresh. Only a boolean flag - no tokens stored.
const IMP_KEY    = 'dg_imp';

// CEO credentials are kept IN MEMORY ONLY during impersonation (#42).
// Never stored in localStorage - a page refresh ends the impersonation session,
// which is the correct and secure behavior.
let _ceoToken: string | null = null;
let _ceoUser: User | null    = null;

interface User {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

interface AuthState {
  currentUser: User | null;
  isAuthenticated: boolean;
  isImpersonating: boolean;
  permissions: Record<string, boolean>;
  permAll: boolean;
  setToken: (token: string) => void;
  login: (email: string, password: string) => Promise<{ ok: boolean }>;
  requestOtp: (email: string) => Promise<{ ok: boolean }>;
  logout: () => void;
  bootstrapFromRefresh: () => Promise<boolean>;
  impersonateTenant: (tenantId: string) => Promise<boolean>;
  exitImpersonation: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  listenForPermissionUpdates: () => void;
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function saveSession(token: string, user: User, tenant?: any) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (tenant) {
      // Strip the heavy banner image (only used on login page, not in-app) to stay under localStorage quota
      const { bannerUrl, ...lightTenant } = tenant;
      localStorage.setItem(TENANT_KEY, JSON.stringify(lightTenant));
    }
  } catch {}
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(IMP_KEY);
  } catch {}
}

function decodeJwtPayload(token: string): any {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = part.padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function getStoredSession(): { token: string; user: User; tenant?: { name: string; logoUrl: string | null } } | null {
  try {
    const token   = localStorage.getItem(TOKEN_KEY);
    const userStr = localStorage.getItem(USER_KEY);
    if (!token || !userStr) return null;

    const payload = decodeJwtPayload(token);
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearSession();
      return null;
    }

    const user   = JSON.parse(userStr) as User;
    const tenStr = localStorage.getItem(TENANT_KEY);
    const tenant = tenStr ? JSON.parse(tenStr) : undefined;
    return { token, user, tenant };
  } catch {
    return null;
  }
}

// Apply a successful auth response (login or OTP verify): set token, state, branding.
function applySession(data: any, set: any, _get: any) {
  setAccessToken(data.token);
  const role = data.user.role;
  set({ currentUser: data.user, isAuthenticated: true, permAll: role === 'super_admin' || role === 'owner' });
  saveSession(data.token, data.user, data.tenant);
  if (data.tenant) {
    useCompanyStore.getState().setCompanyName(data.tenant.name ?? 'Hawcus CRM');
    useCompanyStore.getState().setLogo(data.tenant.logoUrl ?? null);
    useCompanyStore.getState().setSuperfoneEnabled(role === 'super_admin' ? true : !!data.tenant.superfone_enabled);
    if (role !== 'super_admin') useBrandingStore.getState().applyTenantBranding(data.tenant);
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  isAuthenticated: false,
  isImpersonating: false, // page refresh always ends impersonation (by design - CEO token is in-memory only)
  permissions: {},
  permAll: false,

  setToken: (token) => { setAccessToken(token); },

  refreshPermissions: async () => {
    try {
      const data = await api.get<{ role: string; all: boolean; permissions: Record<string, boolean> }>('/api/auth/me/permissions');
      set({ permissions: data.permissions ?? {}, permAll: !!data.all });
    } catch {}
  },

  listenForPermissionUpdates: () => {
    try {
      const socket = getSocket();
      socket.off('permissions_updated');
      socket.on('permissions_updated', () => {
        get().refreshPermissions();
      });
    } catch {}
  },

  login: async (email, password) => {
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return { ok: false };
      const data = await res.json();
      applySession(data, set, get);
      await get().refreshPermissions();
      get().listenForPermissionUpdates();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  // Email-only: ask the server to send a one-time PIN the user can type into the login
  // field (in place of a password). Always resolves ok - server response is neutral.
  requestOtp: async (email) => {
    try {
      await fetch(`${BASE}/api/auth/request-otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  logout: () => {
    api.post('/api/auth/logout', {}).catch(() => {});
    try { getSocket().off('permissions_updated'); } catch {}
    setAccessToken(null);
    clearSession();
    // Clear in-memory CEO state if a logout happens mid-impersonation
    _ceoToken = null;
    _ceoUser  = null;
    useCompanyStore.getState().setCompanyName('Hawcus CRM');
    useCompanyStore.getState().setLogo(null);
    useBrandingStore.getState().resetBranding();
    set({ currentUser: null, isAuthenticated: false, isImpersonating: false, permissions: {}, permAll: false });
  },

  impersonateTenant: async (tenantId: string) => {
    try {
      const stored = getStoredSession();
      if (!stored) return false;

      // Store CEO credentials in MEMORY ONLY - never localStorage (#42)
      _ceoToken = stored.token;
      _ceoUser  = stored.user;

      const res = await fetch(`${BASE}/api/auth/tenants/${tenantId}/impersonate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stored.token}` },
      });
      if (!res.ok) {
        _ceoToken = null;
        _ceoUser  = null;
        return false;
      }
      const data = await res.json();
      setAccessToken(data.token);
      saveSession(data.token, { ...data.user, tenantId: data.user.tenantId });
      try { localStorage.setItem(IMP_KEY, '1'); } catch {}
      set({ currentUser: { ...data.user, tenantId: data.user.tenantId }, isAuthenticated: true, isImpersonating: true });
      // Update company header to reflect the impersonated tenant's branding
      if (data.tenant) {
        useCompanyStore.getState().setCompanyName(data.tenant.name ?? 'Hawcus CRM');
        useCompanyStore.getState().setLogo(data.tenant.logoUrl ?? null);
        useCompanyStore.getState().setSuperfoneEnabled(!!data.tenant.superfone_enabled);
        useBrandingStore.getState().applyTenantBranding(data.tenant);
      }
      get().refreshPermissions();
      get().listenForPermissionUpdates();
      // Clear the previous tenant's cached data and force-load this tenant's data
      // BEFORE the caller navigates. Without this the dashboard showed the prior
      // white-label's data because the navigation-triggered refetch is throttled.
      try {
        const { useCrmStore } = await import('./crmStore');
        useCrmStore.getState().resetCrm();
        await useCrmStore.getState().initFromApi(true);
      } catch {}
      return true;
    } catch {
      _ceoToken = null;
      _ceoUser  = null;
      return false;
    }
  },

  exitImpersonation: async () => {
    try { localStorage.removeItem(IMP_KEY); } catch {}

    // Fast path: CEO token still in memory (same page session, no refresh yet).
    if (_ceoToken && _ceoUser) {
      const ceoUser = _ceoUser;
      setAccessToken(_ceoToken);
      saveSession(_ceoToken, ceoUser);
      _ceoToken = null;
      _ceoUser  = null;
      const ceoPermAll = ceoUser.role === 'super_admin' || ceoUser.role === 'owner';
      set({ currentUser: ceoUser, isAuthenticated: true, isImpersonating: false, permAll: ceoPermAll, permissions: {} });
      useCompanyStore.getState().setCompanyName('Hawcus CRM');
      useCompanyStore.getState().setLogo(null);
      useBrandingStore.getState().resetBranding();
      // Drop the impersonated tenant's data so it can't leak into the next session.
      try { const { useCrmStore } = await import('./crmStore'); useCrmStore.getState().resetCrm(); } catch {}
      get().refreshPermissions();
      return;
    }

    // After a refresh the in-memory CEO token is gone - recover the super-admin
    // session from the still-valid super-admin refresh cookie (impersonation never
    // replaced it on the server).
    try {
      const r = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!r.ok) { get().logout(); return; }
      const { token } = await r.json();
      setAccessToken(token);
      const me = await api.get<User>('/api/auth/me');
      saveSession(token, me);
      const permAll = me.role === 'super_admin' || me.role === 'owner';
      set({ currentUser: me, isAuthenticated: true, isImpersonating: false, permAll, permissions: {} });
      useCompanyStore.getState().setCompanyName('Hawcus CRM');
      useCompanyStore.getState().setLogo(null);
      useBrandingStore.getState().resetBranding();
      try { const { useCrmStore } = await import('./crmStore'); useCrmStore.getState().resetCrm(); } catch {}
      get().refreshPermissions();
    } catch {
      get().logout();
    }
  },

  bootstrapFromRefresh: async () => {
    // ── Fast path: restore from localStorage (no network needed) ──────────────
    const stored = getStoredSession();
    if (stored) {
      setAccessToken(stored.token);
      // Set permAll from role synchronously - both super_admin and owner are known from JWT.
      const role = stored.user.role;
      // Restore impersonation flag so "Back to Admin" survives a page refresh.
      let impersonating = false;
      try { impersonating = localStorage.getItem(IMP_KEY) === '1'; } catch {}
      set({
        currentUser: stored.user,
        isAuthenticated: true,
        isImpersonating: impersonating,
        permAll: role === 'super_admin' || role === 'owner',
      });
      useCompanyStore.getState().setSuperfoneEnabled(role === 'super_admin' ? true : !!stored.tenant?.superfone_enabled);
      if (stored.tenant) {
        useCompanyStore.getState().setCompanyName(stored.tenant.name ?? 'Hawcus CRM');
        useCompanyStore.getState().setLogo(stored.tenant.logoUrl ?? null);
        if (role !== 'super_admin') useBrandingStore.getState().applyTenantBranding(stored.tenant);
      }
      // Always refresh branding from server in the background - cached localStorage tenant
      // may be stale (missing brandColor/appBgColor) and show wrong/old theme.
      if (role !== 'super_admin') {
        api.get<{ tenant?: any }>('/api/auth/me')
          .then((me) => { if (me?.tenant) {
            useBrandingStore.getState().applyTenantBranding(me.tenant);
            useCompanyStore.getState().setSuperfoneEnabled(!!me.tenant.superfone_enabled);
            saveSession(stored.token, stored.user, me.tenant);
          }})
          .catch(() => {});
      }

      // Fetch permissions and wait - sidebar must not render with empty permissions
      await get().refreshPermissions();
      get().listenForPermissionUpdates();

      // Silently refresh in background if token expires in < 2 hours
      try {
        const payload = decodeJwtPayload(stored.token);
        const expiresIn = payload.exp * 1000 - Date.now();
        if (expiresIn < 2 * 60 * 60 * 1000) {
          fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d?.token) { setAccessToken(d.token); saveSession(d.token, stored.user, stored.tenant); } })
            .catch(() => {});
        }
      } catch {}

      return true;
    }

    // ── Slow path: try refresh cookie (first login after clearing storage) ────
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (res.status === 401 || res.status === 403) return false;
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        const { token } = await res.json();
        setAccessToken(token);

        // Fetch user profile
        for (let me = 0; me < 3; me++) {
          try {
            const meRes = await fetch(`${BASE}/api/auth/me`, {
              credentials: 'include',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!meRes.ok) { await new Promise((r) => setTimeout(r, 500)); continue; }
            const user = await meRes.json();
            const tenant = user.tenant;
            saveSession(token, user, tenant);
            set({ currentUser: user, isAuthenticated: true });
            if (tenant) {
              useCompanyStore.getState().setCompanyName(tenant.name ?? 'Hawcus CRM');
              useCompanyStore.getState().setLogo(tenant.logoUrl ?? null);
              if (user.role !== 'super_admin') useBrandingStore.getState().applyTenantBranding(tenant);
            }
            get().refreshPermissions();
            return true;
          } catch { await new Promise((r) => setTimeout(r, 500)); }
        }
        set({ isAuthenticated: true });
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    return false;
  },
}));
