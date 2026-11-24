import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { dateEntryRangeError, formatDateEntry, parseDateEntry } from '../utils/dateEntry';

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  ariaLabel: string;
  className?: string;
  containerClassName?: string;
  disabled?: boolean;
}

export const DateInput: React.FC<DateInputProps> = ({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  className,
  containerClassName = '',
  disabled = false,
}) => {
  const [draft, setDraft] = useState(() => formatDateEntry(value));
  const [error, setError] = useState('');
  const lastSyncedValue = useRef(value);

  useEffect(() => {
    if (lastSyncedValue.current === value) return;
    lastSyncedValue.current = value;
    setDraft(formatDateEntry(value));
    setError('');
  }, [value]);

  const emitChange = (nextValue: string) => {
    lastSyncedValue.current = nextValue;
    onChange(nextValue);
  };

  const validateDraft = (draftValue: string): string => {
    if (!draftValue.trim()) return '';
    const parsed = parseDateEntry(draftValue);
    if (!parsed) return 'Escribe una fecha válida como dd/mm/aaaa.';
    return dateEntryRangeError(parsed, min, max);
  };

  const handleBlur = () => {
    const rangeError = validateDraft(draft);
    setError(rangeError);
    if (rangeError) {
      if (value) emitChange('');
      return;
    }
    if (!draft.trim()) {
      if (value) emitChange('');
      return;
    }

    const parsed = parseDateEntry(draft);
    if (!parsed) {
      if (value) emitChange('');
      return;
    }
    setDraft(formatDateEntry(parsed));
    if (parsed !== value) emitChange(parsed);
  };

  const handleCalendarChange = (dateKey: string) => {
    setError('');
    setDraft(formatDateEntry(dateKey));
    emitChange(dateKey);
  };

  return (
    <div className="min-w-0 space-y-1">
      <div className={`flex min-w-0 items-stretch gap-2 ${containerClassName}`}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={10}
          value={draft}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDraft(nextValue);
            setError('');
            const parsed = parseDateEntry(nextValue);
            if (parsed) {
              const rangeError = dateEntryRangeError(parsed, min, max);
              setError(rangeError);
              if (!rangeError && parsed !== value) emitChange(parsed);
            } else if (!nextValue.trim() && value) {
              emitChange('');
            }
          }}
          onBlur={handleBlur}
          aria-label={ariaLabel}
          aria-invalid={Boolean(error)}
          placeholder="dd/mm/aaaa"
          disabled={disabled}
          className={className || 'min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:border-blue-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'}
        />
        <div className={`relative flex w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 ${disabled ? 'opacity-50' : 'hover:border-blue-500 hover:text-blue-200'}`}>
          <CalendarDays aria-hidden="true" className="h-4 w-4" />
          <input
            type="date"
            value={value}
            min={min}
            max={max}
            onChange={(event) => handleCalendarChange(event.target.value)}
            aria-label={`${ariaLabel}: abrir calendario`}
            disabled={disabled}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed"
          />
        </div>
      </div>
      {error && <p role="alert" className="text-[10px] text-rose-300">{error}</p>}
    </div>
  );
};
