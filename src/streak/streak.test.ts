import { describe, expect, it } from 'vitest';
import { addDays, computeStreak, type DayActivity, type Goal } from './streak';

const goal: Goal[] = [{ from: '2000-01-01', type: 'tests', value: 1 }];

function act(days: string[]): Map<string, DayActivity> {
  return new Map(days.map((d) => [d, { seconds: 120, tests: 1 }]));
}

function range(start: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

describe('streak', () => {
  it('counts consecutive goal days and keeps the streak while today is open', () => {
    const s = computeStreak(act(['2026-03-01', '2026-03-02', '2026-03-03']), goal, '2026-03-04');
    expect(s.current).toBe(3);
    expect(s.todayMet).toBe(false);
  });

  it('resets after a missed day without freezes', () => {
    const s = computeStreak(act(['2026-03-01', '2026-03-03']), goal, '2026-03-03');
    expect(s.current).toBe(1);
    expect(s.best).toBe(1);
  });

  it('earns a freeze every 7 days and uses it for a missed day', () => {
    const days = range('2026-03-01', 7); // 1..7
    days.push('2026-03-09', '2026-03-10'); // 8th missed
    const s = computeStreak(act(days), goal, '2026-03-10');
    expect(s.frozenDays).toEqual(['2026-03-08']);
    expect(s.current).toBe(9);
    expect(s.freezes).toBe(0);
  });

  it('caps freezes', () => {
    const s = computeStreak(act(range('2026-01-01', 40)), goal, '2026-02-09');
    expect(s.freezes).toBe(2);
  });

  it('applies goal changes only from their start date', () => {
    const goals: Goal[] = [
      { from: '2000-01-01', type: 'minutes', value: 1 },
      { from: '2026-03-03', type: 'minutes', value: 10 },
    ];
    const s = computeStreak(act(['2026-03-01', '2026-03-02', '2026-03-03']), goals, '2026-03-03');
    // 2 minutes met the 1-minute goal, but not the new 10-minute goal today.
    expect(s.current).toBe(2);
    expect(s.todayProgress).toBeCloseTo(0.2);
  });

  it('handles month and DST boundaries via local dates', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });
});
