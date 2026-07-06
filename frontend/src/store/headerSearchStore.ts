import { useEffect, useRef } from 'react';
import { create } from 'zustand';

// Context-aware navbar search. Each page registers what its search does; the navbar
// renders one shared input bound to the current page's query. When no page has
// registered (e.g. Dashboard, Settings), the navbar hides the search box.

interface HeaderSearchConfig {
  placeholder: string;
  /** Optional action when the user presses Enter (e.g. a global search jumps to a page). */
  onSubmit?: (q: string) => void;
}

interface HeaderSearchState {
  query: string;
  config: HeaderSearchConfig | null;
  setQuery: (q: string) => void;
  register: (config: HeaderSearchConfig) => void;
  unregister: () => void;
}

export const useHeaderSearchStore = create<HeaderSearchState>((set) => ({
  query: '',
  config: null,
  setQuery: (query) => set({ query }),
  // Registering resets the query so each page starts with an empty box.
  register: (config) => set({ config, query: '' }),
  unregister: () => set({ config: null, query: '' }),
}));

/**
 * Page hook: registers a contextual search in the navbar for as long as this page is
 * mounted, and returns [query, setQuery] so the page can filter/fetch with it.
 * Drop-in replacement for a local `const [search, setSearch] = useState('')`.
 */
export function useHeaderSearch(
  placeholder: string,
  opts?: { onSubmit?: (q: string) => void },
): [string, (q: string) => void] {
  const query = useHeaderSearchStore((s) => s.query);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);
  const register = useHeaderSearchStore((s) => s.register);
  const unregister = useHeaderSearchStore((s) => s.unregister);
  // Keep the latest onSubmit in a ref so re-renders don't re-register (which would
  // reset the query mid-typing); only `placeholder` drives registration.
  const onSubmitRef = useRef(opts?.onSubmit);
  onSubmitRef.current = opts?.onSubmit;
  useEffect(() => {
    register({ placeholder, onSubmit: (q) => onSubmitRef.current?.(q) });
    return () => unregister();
  }, [placeholder, register, unregister]);
  return [query, setQuery];
}
