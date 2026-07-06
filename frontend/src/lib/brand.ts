// Resolve themeable CSS variables to concrete hex values for contexts where
// CSS var() does NOT work - chiefly SVG presentation attributes used by recharts
// (stroke="...", fill="..."). In CSS/className/inline-style, use var(--brand) directly.

export function brandHex(): string {
  if (typeof document === 'undefined') return '#ea580c';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
  return v || '#ea580c';
}
