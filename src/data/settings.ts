import type { Lang, ModeSpec } from '../types';
import { dateKey, type Goal } from '../streak/streak';

export type Theme = 'system' | 'dark' | 'light';

export interface Settings {
  lang: Lang;
  mode: ModeSpec;
  punctuation: boolean;
  numbers: boolean;
  noBackspace: boolean;
  poolSize: number;
  customText: string;
  drillLength: number;
  theme: Theme;
  liveWpm: boolean;
  streakEnabled: boolean;
  goals: Goal[];
  /** WPM targets drawn on charts. */
  targets: number[];
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  mode: { kind: 'time', seconds: 30 },
  punctuation: false,
  numbers: false,
  noBackspace: false,
  poolSize: 1000,
  customText: '',
  drillLength: 50,
  theme: 'system',
  liveWpm: true,
  streakEnabled: true,
  goals: [{ from: '2000-01-01', type: 'minutes', value: 10 }],
  targets: [60, 100],
};

const KEY = 'dvorakel.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore: settings just won't persist.
  }
}

/** Change the daily goal from today on, keeping past days' goals. */
export function withGoal(s: Settings, type: Goal['type'], value: number, today = dateKey(new Date())): Settings {
  const goals = s.goals.filter((g) => g.from < today);
  goals.push({ from: goals.length ? today : '2000-01-01', type, value });
  return { ...s, goals };
}
