import React from 'react';

/**
 * Shared Recharts tooltip used by every chart in the app.
 *
 * Fixes the two problems the inline `contentStyle` tooltips had:
 *  - color collision: Recharts' default content paints each row's TEXT in the
 *    series colour, so a dark series on a dark box (or a pale series on white)
 *    was unreadable. Here the text always wears ink tokens and the series colour
 *    lives only in a small key stroke beside the name.
 *  - inconsistency: one component => every chart's hover looks identical.
 *
 * Drop-in usage:
 *   <Tooltip content={<ChartTooltip />} />
 *   <Tooltip content={<ChartTooltip formatter={fn} labelFormatter={fn} />} />
 *
 * `formatter` / `labelFormatter` must be passed to THIS component (not to
 * <Tooltip>) because Recharts only feeds those to its default content.
 */

type TooltipItem = {
  name?: React.ReactNode;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
};

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: React.ReactNode;
  /** Recharts label formatter — receives (label, payload). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  labelFormatter?: (label: any, payload: any[]) => React.ReactNode;
  /** Recharts value formatter — receives (value, name, item, index, payload). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatter?: (value: any, name: any, item: any, index: number, payload: any) => React.ReactNode;
  /** Hide the header label row (e.g. pie charts where it would duplicate the name). */
  hideLabel?: boolean;
}

export default function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  hideLabel,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload.filter(
    (p) => p && p.value !== undefined && p.value !== null && p.name !== undefined && p.name !== null,
  );
  if (rows.length === 0) return null;

  const labelNode = hideLabel
    ? null
    : labelFormatter
      ? labelFormatter(label, payload as never[])
      : label;

  return (
    <div
      className="rounded-xl border border-black/[0.06] bg-white/95 px-3 py-2 shadow-[0_10px_30px_rgba(16,24,40,0.16)]"
      style={{ minWidth: 128, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
    >
      {labelNode !== null && labelNode !== undefined && labelNode !== '' && (
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#7a6b5c]">
          {labelNode}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {rows.map((item, i) => {
          const color = item.color || '#9ca3af';
          let display: React.ReactNode = item.value as React.ReactNode;
          let nameNode: React.ReactNode = item.name;
          if (formatter) {
            const out = formatter(item.value, item.name, item, i, item.payload);
            if (Array.isArray(out)) {
              display = out[0] as React.ReactNode;
              if (out[1] !== undefined && out[1] !== null) nameNode = out[1] as React.ReactNode;
            } else {
              display = out;
            }
          }
          return (
            <div key={i} className="flex items-center justify-between gap-4 text-[12px] leading-tight">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="inline-block shrink-0 rounded-full"
                  style={{ width: 9, height: 3, borderRadius: 2, background: color }}
                />
                <span className="truncate text-[#7a6b5c]">{nameNode}</span>
              </span>
              <span className="whitespace-nowrap font-semibold tabular-nums text-[#1c1410]">
                {display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
