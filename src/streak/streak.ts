/**
 * Streaks are recomputed from the session history, so they never drift out of
 * sync with the data. Goal changes are stored with the date they take effect,
 * so raising the goal does not rewrite past days.
 */
export type GoalType = 'minutes' | 'tests';

export interface Goal {
  /** First local day (YYYY-MM-DD) this goal applies to. */
  from: string;
  type: GoalType;
  value: number;
}

export interface DayActivity {
  seconds: number;
  tests: number;
}

/** Earn one freeze per this many goal days in a row. */
export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;

export interface StreakState {
  current: number;
  best: number;
  freezes: number;
  todayMet: boolean;
  /** Progress towards today's goal, 0..1. */
  todayProgress: number;
  goal: Goal;
  /** Days kept alive by a freeze. */
  frozenDays: string[];
  /** Days the goal was met. */
  metDays: string[];
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n));
}

export function goalFor(day: string, goals: Goal[]): Goal {
  const sorted = [...goals].sort((a, b) => a.from.localeCompare(b.from));
  let g = sorted[0];
  for (const x of sorted) if (x.from <= day) g = x;
  return g;
}

export function progress(a: DayActivity | undefined, g: Goal): number {
  if (!a) return 0;
  const done = g.type === 'minutes' ? a.seconds / 60 : a.tests;
  return Math.min(1, done / Math.max(1e-9, g.value));
}

export function computeStreak(activity: Map<string, DayActivity>, goals: Goal[], today: string): StreakState {
  const goalToday = goalFor(today, goals);
  const days = [...activity.keys()].filter((d) => d <= today).sort();
  const base: StreakState = {
    current: 0,
    best: 0,
    freezes: 0,
    todayMet: false,
    todayProgress: progress(activity.get(today), goalToday),
    goal: goalToday,
    frozenDays: [],
    metDays: [],
  };
  if (days.length === 0) return base;

  let current = 0;
  let best = 0;
  let freezes = 0;
  let run = 0; // met days in the current run, for earning freezes
  const frozen: string[] = [];
  const met: string[] = [];
  for (let d = days[0]; d <= today; d = addDays(d, 1)) {
    const ok = progress(activity.get(d), goalFor(d, goals)) >= 1;
    if (ok) {
      met.push(d);
      current++;
      run++;
      if (run % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
    } else if (d === today) {
      // Today is still open: the streak is not broken yet.
    } else if (current > 0 && freezes > 0) {
      freezes--;
      frozen.push(d);
    } else {
      current = 0;
      run = 0;
    }
    best = Math.max(best, current);
  }
  return {
    ...base,
    current,
    best,
    freezes,
    todayMet: met[met.length - 1] === today,
    frozenDays: frozen,
    metDays: met,
  };
}
