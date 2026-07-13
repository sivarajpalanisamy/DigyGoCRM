import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** Parse a `yyyy-MM-dd` string to a LOCAL Date (avoids the UTC shift of `new Date(str)`). */
function toDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
/** Format a Date back to a `yyyy-MM-dd` string using local parts. */
function toStr(d?: Date): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DatePickerProps {
  /** Controlled value as a `yyyy-MM-dd` string (empty = unset). */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Earliest selectable date, `yyyy-MM-dd`. */
  min?: string;
  /** Latest selectable date, `yyyy-MM-dd`. */
  max?: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
  /** Show the Clear / Today footer (default true). */
  clearable?: boolean;
  disabled?: boolean;
}

/**
 * Modern themed single-date picker - a drop-in replacement for `<input type="date">`.
 * Same value contract (`yyyy-MM-dd` string) so swaps are mechanical.
 */
export function DatePicker({
  value, onChange, placeholder = 'Select date', min, max,
  className, align = 'start', clearable = true, disabled = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  const minDate = toDate(min);
  const maxDate = toDate(max);

  const disabledMatchers: { before?: Date; after?: Date }[] = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-[var(--hairline)] bg-white text-[14px] text-left outline-none transition-colors',
            'hover:border-primary/40 focus:border-primary/40 data-[state=open]:border-primary/50 data-[state=open]:ring-2 data-[state=open]:ring-primary/15',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            selected ? 'text-[#111318] font-medium' : 'text-[#9ca3af]',
            className,
          )}
        >
          <CalendarDays className="w-4 h-4 text-[#9ca3af] shrink-0" />
          <span className="truncate">{selected ? format(selected, 'dd MMM yyyy') : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-auto p-0 rounded-2xl border border-[var(--hairline)] shadow-[0_20px_60px_rgba(16,24,40,0.16)]"
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => { onChange(toStr(d)); setOpen(false); }}
          disabled={disabledMatchers.length ? disabledMatchers : undefined}
          initialFocus
        />
        {clearable && (
          <div className="flex items-center justify-between border-t border-[var(--hairline)] px-3 py-2">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="text-[13px] font-semibold text-[#6b7280] hover:text-[#111318] transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => { onChange(toStr(new Date())); setOpen(false); }}
              className="text-[13px] font-semibold text-primary hover:underline"
            >
              Today
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
