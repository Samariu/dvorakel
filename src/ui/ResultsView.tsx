import { useMemo } from 'react';
import type { ActiveDrill } from '../App';
import { wordCore } from '../analysis/extract';
import { isTyping } from '../engine/metrics';
import { K_CHAR, K_MISSED_SPACE } from '../types';
import type { SessionRecord } from '../types';
import { LineChart } from './charts';
import { fmtDuration, modeLabel, pbKey } from './format';

interface Props {
  result: SessionRecord;
  sessions: SessionRecord[];
  drill: ActiveDrill | null;
  onNext: () => void;
  onExitDrill: () => void;
}

export function ResultsView({ result: r, sessions, drill, onNext, onExitDrill }: Props) {
  const saved = r.durationMs >= 2000 && r.ks.filter(isTyping).length >= 5;
  const previousBest = useMemo(() => {
    if (r.mode.kind === 'drill') return null;
    const key = pbKey(r);
    const prev = sessions.filter((s) => s.startedAt !== r.startedAt && pbKey(s) === key);
    return prev.length ? Math.max(...prev.map((s) => s.wpm)) : null;
  }, [r, sessions]);
  const isPb = saved && r.mode.kind !== 'drill' && (previousBest === null ? false : r.wpm > previousBest);

  const missed = useMemo(() => {
    const out = new Map<string, number>();
    r.typed.forEach((t, i) => {
      const w = r.words[i];
      if (w !== undefined && t !== w && i < r.typed.length - 1) {
        const k = wordCore(w) || w;
        out.set(k, (out.get(k) ?? 0) + 1);
      }
    });
    // Words that were corrected also count as mistakes.
    for (const k of r.ks) {
      const [, wi, ci, kind, ch] = k;
      const w = r.words[wi];
      const wrongChar = kind === K_CHAR && w !== undefined && (ci >= w.length || w[ci] !== ch);
      if (w !== undefined && (wrongChar || kind === K_MISSED_SPACE)) {
        const key = wordCore(w) || w;
        if (!out.has(key)) out.set(key, 1);
      }
    }
    return [...out.keys()];
  }, [r]);

  const xLabels = r.wpmSeries.map((_, i) => `${i + 1} s`);
  const { chars } = r;

  return (
    <div>
      <div className="results">
        <div>
          <div className="big-stat">
            <div className="label">wpm{isPb && <span className="pb-badge">new best</span>}</div>
            <div className="value" data-testid="result-wpm">
              {Math.round(r.wpm)}
            </div>
          </div>
          <div className="big-stat" style={{ marginTop: 12 }}>
            <div className="label">accuracy</div>
            <div className="value">{Math.round(r.acc)}%</div>
          </div>
        </div>
        <div className="card">
          <LineChart
            ariaLabel="Speed over the test"
            height={200}
            xLabels={xLabels}
            xTicks={(i) => String(i + 1)}
            series={[
              { name: 'wpm', color: 'var(--series-1)', values: r.wpmSeries, format: (v) => String(Math.round(v)) },
              { name: 'raw', color: 'var(--muted)', values: r.rawSeries, format: (v) => String(Math.round(v)) },
              {
                name: 'errors',
                color: 'var(--error)',
                dots: true,
                values: r.errSeries.map((e, i) => (e > 0 ? Math.max(4, r.rawSeries[i] ?? 0) : null)),
                format: () => '',
              },
            ]}
          />
          <div className="notice" style={{ marginTop: 4 }}>
            Red dots mark seconds with mistakes (
            {r.errSeries.reduce((a, b) => a + b, 0)} wrong keystrokes in total).
          </div>
        </div>
        <div className="small-stats">
          <Stat label="test" value={`${r.lang.toUpperCase()} · ${modeLabel(r.mode)}`} />
          <Stat label="raw" value={String(Math.round(r.raw))} />
          <Stat label="consistency" value={`${Math.round(r.consistency)}%`} />
          <Stat
            label="characters"
            value={`${chars.correct}/${chars.incorrect}/${chars.extra}/${chars.missed}`}
            title="correct / incorrect / extra / missed"
          />
          <Stat label="time" value={fmtDuration(r.durationMs)} />
          {previousBest !== null && <Stat label="previous best" value={String(Math.round(previousBest))} />}
          {r.noBackspace && <Stat label="mode" value="no backspace" />}
        </div>
        {r.source && (
          <div className="missed-words" style={{ color: 'var(--muted)' }}>
            — {r.source}
          </div>
        )}
        {missed.length > 0 && (
          <div className="missed-words">
            <div className="label" style={{ color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-sans)', marginBottom: 4 }}>
              words with mistakes (they feed into the Practice tab)
            </div>
            {missed.slice(0, 30).map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
        )}
        {!saved && <div className="notice">This test was too short to be saved.</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 32 }}>
        <button className="btn primary" onClick={onNext} autoFocus>
          {drill ? 'Repeat drill' : 'Next test'} <kbd>tab</kbd>
        </button>
        {drill && (
          <button className="btn" onClick={onExitDrill}>
            Exit drill
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
