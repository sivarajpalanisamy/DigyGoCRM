export const BASE = import.meta.env.VITE_API_URL ?? '';

export class SessionExpiredError extends Error {
  constructor() { super('Session expired'); this.name = 'SessionExpiredError'; }
}

// In-memory token — never written to localStorage
let _accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { _accessToken = t; };
export const getAccessToken = () => _accessToken;

// Deduplicates concurrent 401 → refresh attempts into one request
let _refreshPromise: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (r) => {
      if (!r.ok) return null;
      const { token } = await r.json();
      return token as string;
    })
    .catch(() => null)
    .finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}, _retry = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(_accessToken ? { Authorization: `Bearer ${_accessToken}` } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    },
  });

  if (res.status === 401 && _retry) {
    const newToken = await tryRefresh();
    if (newToken) {
      _accessToken = newToken;
      import('@/store/authStore').then(({ useAuthStore }) => {
        useAuthStore.getState().setToken(newToken);
      });
      return request<T>(path, options, false);
    }
    import('@/store/authStore').then(({ useAuthStore }) => {
      useAuthStore.getState().logout();
    });
    throw new SessionExpiredError();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data as T;
}

export const api = {
  get:    <T>(path: string)                  => request<T>(path),
  post:   <T>(path: string, body: unknown)   => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown)   => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)   => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                  => request<T>(path, { method: 'DELETE' }),
};

export async function downloadBlob(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: _accessToken ? { Authorization: `Bearer ${_accessToken}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error ?? 'Export failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
