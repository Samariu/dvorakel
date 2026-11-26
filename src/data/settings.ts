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
  /** Font size of the text you type, in rem. */
  typingSize: number;
  liveWpm: boolean;
  streakEnabled: boolean;
  goals: Goal[];
  /** WPM targets drawn on charts. */
  targets: number[];
  /** Which layers the stats charts show. */
  statsLayers: StatsLayers;
}

export interface ChartLayers {
  sessions: boolean;
  avg10: boolean;
  avg100: boolean;
}

export interface StatsLayers {
  speed: ChartLayers & { targets: boolean };
  accuracy: ChartLayers;
}

/** Typing text sizes in rem (Monkeytype's default is about 2). */
export const TYPING_SIZES = [1.25, 1.6, 2, 2.5, 3, 4];

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
  typingSize: 2,
  liveWpm: true,
  streakEnabled: true,
  goals: [{ from: '2000-01-01', type: 'minutes', value: 10 }],
  targets: [60, 100],
  statsLayers: {
    speed: { sessions: true, avg10: true, avg100: true, targets: true },
    accuracy: { sessions: true, avg10: true, avg100: true },
  },
};

const KEY = 'dvorakel.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      const d = DEFAULT_SETTINGS.statsLayers;
      // Merge nested layer flags so keys added later get their defaults.
      const statsLayers = {
        speed: { ...d.speed, ...saved.statsLayers?.speed },
        accuracy: { ...d.accuracy, ...saved.statsLayers?.accuracy },
      };
      return { ...DEFAULT_SETTINGS, ...saved, statsLayers };
    }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

const TS_KEY = 'dvorakel.settingsUpdatedAt';

/** When the settings were last changed in this browser (ms); 0 = never. Used for sync. */
export function settingsUpdatedAt(): number {
  try {
    return Number(localStorage.getItem(TS_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function touchSettings(at = Date.now()): void {
  try {
    localStorage.setItem(TS_KEY, String(at));
  } catch {
    // Ignore.
  }
}

/** Settings from another browser: replace ours, keep their timestamp. */
export function applyRemoteSettings(value: Partial<Settings>, updatedAt: number): Settings {
  saveSettings({ ...DEFAULT_SETTINGS, ...value } as Settings);
  touchSettings(updatedAt);
  return loadSettings();
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
