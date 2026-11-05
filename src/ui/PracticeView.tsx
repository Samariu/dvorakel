import { useMemo } from 'react';
import type { ActiveDrill } from '../App';
import { candidatesFor, smartTargets, targetLabel, toTarget } from '../analysis/drills';
import { weaknessReport, type StatKind, type Weakness } from '../analysis/weakness';
import type { Settings } from '../data/settings';
import type { SessionRecord } from '../types';

interface Props {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  sessions: SessionRecord[] | null;
  onStart: (d: ActiveDrill) => void;
}

const SECTIONS: { kind: StatKind; title: string; sub: string; unit: string }[] = [
  { kind: 'bigrams', title: 'Letter pairs', sub: 'Time from the first to the second letter. Usually the biggest lever for speed.', unit: 'ms' },
  { kind: 'trigrams', title: 'Letter triples', sub: 'Time across three letters, e.g. “sch”, “the”, “ung”.', unit: 'ms' },
  { kind: 'chars', title: 'Characters', sub: 'Time to reach each character and how often it is missed.', unit: 'ms' },
  { kind: 'words', title: 'Words', sub: 'Average time per character within the word.', unit: 'ms/char' },
];

const SHOW = 10;
const MIN_KEYSTROKES = 400;

export function PracticeView({ settings, update, sessions, onStart }: Props) {
  const lang = settings.lang;
  const report = useMemo(() => {
    if (!sessions) return null;
    return weaknessReport(sessions.filter((s) => s.lang === lang));
  }, [sessions, lang]);

  if (!report) return <div className="empty">Loading…</div>;

  const langName = lang === 'de' ? 'German' : 'English';
  const smart = smartTargets(report);
  const enough = report.keystrokes >= MIN_KEYSTROKES;

  const start = (label: string, targets: ReturnType<typeof toTarget>[]) => {
    const usable = targets.filter((t) => candidatesFor(lang, t).length > 0);
    if (usable.length) onStart({ label, targets: usable });
  };

  return (
    <div>
      <h2 className="page-title">Practice · {langName}</h2>
      <p className="page-sub">
        Based on your last {report.sessions} {langName} session{report.sessions === 1 ? '' : 's'} ({report.keystrokes.toLocaleString()}{' '}
        keystrokes). Recent sessions count more. Weakness = how much slower than your typical item, plus a penalty for mistakes.
        Switch EN/DE in the header.
      </p>

      {!enough && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Not enough data yet</h3>
          <p className="sub" style={{ margin: 0 }}>
            Do a few normal tests first ({report.keystrokes} of ~{MIN_KEYSTROKES} keystrokes). The lists below fill in as data arrives,
            but they are noisy until then.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Smart drill</h3>
        <p className="sub">A mix of your weakest letter pairs, triples, words and characters, written as real words.</p>
        <div className="smart">
          <div className="targets">{smart.length ? smart.map(targetLabel).join('  ') : 'nothing yet'}</div>
          <div className="seg" role="group" aria-label="Drill length">
            {[25, 50, 100].map((n) => (
              <button key={n} className={settings.drillLength === n ? 'on' : ''} onClick={() => update({ drillLength: n })}>
                {n} words
              </button>
            ))}
          </div>
          <button className="btn primary" disabled={smart.length === 0} onClick={() => start('smart mix', smart)}>
            Start smart drill
          </button>
        </div>
      </div>

      <div className="grid">
        {SECTIONS.map((sec) => {
          const items = report[sec.kind].slice(0, SHOW);
          return (
            <div className="card" key={sec.kind}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                <div>
                  <h3>{sec.title}</h3>
                  <p className="sub">{sec.sub}</p>
                </div>
                <button
                  className="btn small"
                  disabled={items.length === 0}
                  onClick={() => start(`top ${sec.title.toLowerCase()}`, items.slice(0, 5).map(toTarget))}
                >
                  Drill top 5
                </button>
              </div>
              {items.length === 0 ? (
                <div className="empty">No item has enough samples yet.</div>
              ) : (
                <WeaknessTable items={items} unit={sec.unit} onDrill={(w) => start(targetLabel(toTarget(w)), [toTarget(w)])} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeaknessTable({ items, unit, onDrill }: { items: Weakness[]; unit: string; onDrill: (w: Weakness) => void }) {
  const maxSlow = Math.max(...items.map((w) => w.slowness), 1.01);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>item</th>
            <th className="num">{unit}</th>
            <th className="num">vs. typical</th>
            <th className="num">errors</th>
            <th className="num">seen</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((w) => {
            const rel = Math.round((w.slowness - 1) * 100);
            return (
              <tr key={w.key}>
                <td className="key">{w.key === ' ' ? '␣' : w.key}</td>
                <td className="num">{Math.round(w.ms)}</td>
                <td className="num">
                  <span className="bar-cell">
                    {rel > 0 ? `+${rel}` : rel} %
                    <span className="bar" style={{ width: Math.max(2, (Math.max(0, w.slowness - 1) / (maxSlow - 1)) * 40) }} />
                  </span>
                </td>
                <td className="num">{Math.round(w.errRate * 100)} %</td>
                <td className="num">{Math.round(w.samples)}</td>
                <td className="num">
                  <button className="btn small" onClick={() => onDrill(w)} aria-label={`Drill ${w.key}`}>
                    drill
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
