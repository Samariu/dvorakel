import type { ModeSpec, SessionRecord } from '../types';

export function modeKey(m: ModeSpec): string {
  switch (m.kind) {
    case 'time':
      return `time ${m.seconds}`;
    case 'words':
      return `words ${m.count}`;
    case 'quote':
      return `quote ${m.length}`;
    case 'custom':
      return 'custom';
    case 'drill':
      return 'drill';
  }
}

export function modeLabel(m: ModeSpec): string {
  switch (m.kind) {
    case 'time':
      return `${m.seconds} s`;
    case 'words':
      return `${m.count} words`;
    case 'quote':
      return `quote (${m.length})`;
    case 'custom':
      return 'custom text';
    case 'drill':
      return `drill: ${m.label}`;
  }
}

/** Sessions comparable for personal bests: same language, mode and settings. */
export function pbKey(s: Pick<SessionRecord, 'lang' | 'mode' | 'punctuation' | 'numbers'>): string {
  return `${s.lang}|${modeKey(s.mode)}|${s.punctuation ? 'p' : ''}${s.numbers ? 'n' : ''}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60 ? `${s % 60} s` : ''}`.trim();
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const pct = (x: number) => `${Math.round(x * 100)} %`;
