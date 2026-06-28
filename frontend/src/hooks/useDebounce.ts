import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms without
 * changes. Use it to drive filtering / API calls from a fast-changing input (the
 * input stays bound to the raw value for instant typing; the debounced value
 * drives the expensive work).
 *
 *   const [search, setSearch] = useState('');
 *   const debounced = useDebounce(search, 300);
 *   // filter / fetch with `debounced`, render the box with `search`
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
