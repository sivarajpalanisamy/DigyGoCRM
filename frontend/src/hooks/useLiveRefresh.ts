import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/socket';

/**
 * Live-refresh a page's own data on tenant data changes - so a create/edit/delete
 * made anywhere (this tab, another tab, another user) shows up without a manual
 * page reload.
 *
 * The backend emits `data:changed` ({ resource }) after every successful mutating
 * API call. Pass the API segment(s) this page cares about (e.g. ['contacts']) to
 * react only to those; omit `resources` to react to any change.
 *
 * `refetch` is the page's existing loader. Calls are debounced to coalesce bursts.
 */
export function useLiveRefresh(refetch: () => void, resources?: string[]) {
  const cb = useRef(refetch);
  cb.current = refetch;
  const res = useRef(resources);
  res.current = resources;

  useEffect(() => {
    const socket = getSocket();
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChange = (payload?: { resource?: string }) => {
      const want = res.current;
      if (want && want.length && (!payload?.resource || !want.includes(payload.resource))) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => cb.current(), 700);
    };
    socket.on('data:changed', onChange);
    return () => {
      if (t) clearTimeout(t);
      socket.off('data:changed', onChange);
    };
  }, []);
}
