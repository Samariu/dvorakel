import type { StreakState } from '../streak/streak';

export function Flame() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c.6 3.2-1 5.2-2.6 7C7.8 10.8 6 12.7 6 15.5 6 19 8.7 22 12 22s6-3 6-6.5c0-2.4-1.1-4.2-2.3-5.6-.3 1.6-1.1 2.7-2.3 3.2.6-3.8-.3-8.2-1.4-11.1z" />
    </svg>
  );
}

function Snow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2v20M4 7l16 10M20 7L4 17M9 3.5l3 2 3-2M9 20.5l3-2 3 2" />
    </svg>
  );
}

export function StreakChip({ streak }: { streak: StreakState }) {
  const { goal } = streak;
  const goalText = goal.type === 'minutes' ? `${goal.value} min` : `${goal.value} test${goal.value === 1 ? '' : 's'}`;
  const title =
    `Streak: ${streak.current} day${streak.current === 1 ? '' : 's'} (best ${streak.best}). ` +
    `Today: ${Math.round(streak.todayProgress * 100)} % of ${goalText}. ` +
    `Freezes: ${streak.freezes}.`;
  return (
    <div className={`streak-chip ${streak.todayMet ? 'met' : ''}`} title={title} aria-label={title}>
      <span className="streak-ring" style={{ ['--p' as string]: streak.todayProgress }}>
        <span>
          <Flame />
        </span>
      </span>
      {streak.current}
      {streak.freezes > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--series-1)' }}>
          <Snow />
          {streak.freezes}
        </span>
      )}
    </div>
  );
}
