import { useMemo, useState } from 'react';
import { activityByDay } from '../App';
import { deleteSession } from '../data/db';
import type { ChartLayers, Settings, StatsLayers } from '../data/settings';
import { addDays, dateKey, type StreakState } from '../streak/streak';
import type { SessionRecord } from '../types';
import { Calendar, LineChart, type CalendarDay, type Series } from './charts';
import { fmtDate, fmtDuration, modeKey, modeLabel } from './format';

interface Props {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  sessions: SessionRecord[];
  streak: StreakState;
  onChanged: () => void;
}

type LangFilter = 'all' | 'en' | 'de';
type KindFilter = 'tests' | 'drills' | 'all';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function rolling(values: number[], n: number): (number | null)[] {
  return values.map((_, i) => (i + 1 < Math.min(n, 3) ? null : Math.round(mean(values.slice(Math.max(0, i - n + 1), i + 1)) * 10) / 10));
}

const LAYER_BY_NAME: Record<string, keyof ChartLayers> = { 'average of 10': 'avg10', 'average of 100': 'avg100' };

/** Shade of `base` mixed toward the card background; level 0 is full colour. */
function fade(base: string, level: number): string {
  const pct = [100, 45, 25][level];
  return pct === 100 ? base : `color-mix(in srgb, ${base} ${pct}%, var(--surface))`;
}

/**
 * Sessions as dots plus running averages as lines, all in one hue. As on
 * Monkeytype, the most aggregated visible layer gets the full colour and each
 * finer layer is drawn paler, so the long-term trend stays on top visually.
 */
function layeredSeries(name: string, values: number[], l: ChartLayers, format: (v: number) => string): Series[] {
  const base = 'var(--series-1)';
  const avg10Level = l.avg100 ? 1 : 0;
  const dotLevel = (l.avg100 ? 1 : 0) + (l.avg10 ? 1 : 0);
  return [
    { name, color: fade(base, dotLevel), values, dots: true, dotRadius: 3, hidden: !l.sessions, format },
    { name: 'average of 10', color: fade(base, avg10Level), values: rolling(values, 10), hidden: !l.avg10, format },
    { name: 'average of 100', color: base, values: rolling(values, 100), hidden: !l.avg100, format },
  ];
}

const PB_MODES = ['time 15', 'time 30', 'time 60', 'time 120', 'words 10', 'words 25', 'words 50', 'words 100'];

export function StatsView({ settings, update, sessions, streak, onChanged }: Props) {
  const [lang, setLang] = useState<LangFilter>('all');
  const [kind, setKind] = useState<KindFilter>('tests');
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(
    () =>
      sessions
        .filter((s) => lang === 'all' || s.lang === lang)
        .filter((s) => kind === 'all' || (kind === 'drills') === (s.mode.kind === 'drill'))
        .sort((a, b) => a.startedAt - b.startedAt),
    [sessions, lang, kind],
  );

  const wpms = filtered.map((s) => s.wpm);
  const accs = filtered.map((s) => s.acc);
  const last10 = filtered.slice(-10);
  const prev10 = filtered.slice(-20, -10);
  const avg10 = mean(last10.map((s) => s.wpm));
  const avgPrev = mean(prev10.map((s) => s.wpm));
  const totalMs = filtered.reduce((a, s) => a + s.durationMs, 0);
  const best = filtered.reduce<SessionRecord | null>((b, s) => (!b || s.wpm > b.wpm ? s : b), null);

  const calendar = useMemo(() => buildCalendar(sessions, streak), [sessions, streak]);

  const pbs = useMemo(() => {
    const rows: { mode: string; en?: SessionRecord; de?: SessionRecord }[] = [];
    for (const m of PB_MODES) {
      const row: { mode: string; en?: SessionRecord; de?: SessionRecord } = { mode: m };
      for (const l of ['en', 'de'] as const) {
        for (const s of sessions) {
          if (s.lang === l && modeKey(s.mode) === m && !s.punctuation && !s.numbers && (!row[l] || s.wpm > row[l]!.wpm)) row[l] = s;
        }
      }
      if (row.en || row.de) rows.push(row);
    }
    return rows;
  }, [sessions]);

  const history = [...filtered].reverse().slice(0, showAll ? undefined : 25);

  const layers = settings.statsLayers;
  const toggle =
    <C extends keyof StatsLayers>(chart: C) =>
    (name: string) => {
      const key = (name === 'targets' ? 'targets' : LAYER_BY_NAME[name] ?? 'sessions') as keyof StatsLayers[C];
      const cur = layers[chart];
      update({ statsLayers: { ...layers, [chart]: { ...cur, [key]: !cur[key] } } });
    };

  const remove = async (id?: number) => {
    if (id === undefined || !confirm('Delete this session from your history?')) return;
    await deleteSession(id);
    onChanged();
  };

  return (
    <div>
      <h2 className="page-title">Statistics</h2>
      <p className="page-sub">Every completed test and drill is stored in this browser. Export a backup in Settings.</p>

      <div className="filters">
        <div className="seg" role="group" aria-label="Language filter">
          {(['all', 'en', 'de'] as LangFilter[]).map((l) => (
            <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>
              {l === 'all' ? 'both languages' : l.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Session type filter">
          {(['tests', 'drills', 'all'] as KindFilter[]).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="tiles">
        <Tile label="sessions" value={filtered.length.toLocaleString()} />
        <Tile label="time typed" value={fmtDuration(totalMs)} />
        <Tile
          label="avg wpm, last 10"
          value={filtered.length ? String(Math.round(avg10)) : '–'}
          delta={prev10.length ? `${avg10 - avgPrev >= 0 ? '+' : ''}${Math.round(avg10 - avgPrev)} vs previous 10` : undefined}
        />
        <Tile label="best wpm" value={best ? String(Math.round(best.wpm)) : '–'} delta={best ? modeLabel(best.mode) : undefined} />
        <Tile label="avg accuracy, last 10" value={filtered.length ? `${Math.round(mean(last10.map((s) => s.acc)))}%` : '–'} />
        {settings.streakEnabled && (
          <Tile label="streak" value={`${streak.current} d`} delta={`best ${streak.best} d · ${streak.freezes} freeze${streak.freezes === 1 ? '' : 's'}`} />
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Speed per session</h3>
        <p className="sub">Horizontal lines are your targets ({settings.targets.join(' and ')} wpm).</p>
        <LineChart
          ariaLabel="WPM per session"
          height={240}
          xLabels={filtered.map((s) => `${fmtDate(s.startedAt)} · ${s.lang.toUpperCase()} · ${modeLabel(s.mode)}`)}
          xTicks={(i) =>
            sameDay(filtered) ? `#${i + 1}` : new Date(filtered[i].startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })
          }
          refLines={settings.targets.map((t) => ({ value: t, label: `${t} wpm` }))}
          refLinesHidden={!layers.speed.targets}
          onToggle={toggle('speed')}
          series={layeredSeries('wpm', wpms, layers.speed, (v) => String(Math.round(v)))}
        />
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Accuracy per session</h3>
          <p className="sub">Share of keystrokes that were right the first time.</p>
          <LineChart
            ariaLabel="Accuracy per session"
            height={180}
            // Accuracy lives near the top; start at 80% so differences are visible,
            // but extend downward if a session dips below that so it isn't clipped.
            yMin={Math.min(80, ...accs)}
            yMax={100}
            xLabels={filtered.map((s) => `${fmtDate(s.startedAt)} · ${modeLabel(s.mode)}`)}
            onToggle={toggle('accuracy')}
            series={layeredSeries('accuracy', accs, layers.accuracy, (v) => `${v}%`)}
          />
        </div>
        <div className="card">
          <h3>Practice calendar</h3>
          <p className="sub">Minutes typed per day, last 26 weeks (both languages).</p>
          <Calendar
            weeks={calendar}
            label={(d) => `${d.key}: ${Math.round(d.minutes * 10) / 10} min${d.frozen ? ' (freeze used)' : ''}`}
          />
        </div>
      </div>

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Personal bests</h3>
          <p className="sub">Plain words without punctuation or numbers.</p>
          {pbs.length === 0 ? (
            <div className="empty">No time or word tests yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>mode</th>
                  <th className="num">EN</th>
                  <th className="num">DE</th>
                </tr>
              </thead>
              <tbody>
                {pbs.map((r) => (
                  <tr key={r.mode}>
                    <td>{r.mode.startsWith('time') ? `${r.mode.slice(5)} s` : `${r.mode.slice(6)} words`}</td>
                    <td className="num" title={r.en ? `${Math.round(r.en.acc)}% · ${fmtDate(r.en.startedAt)}` : undefined}>
                      {r.en ? Math.round(r.en.wpm) : '–'}
                    </td>
                    <td className="num" title={r.de ? `${Math.round(r.de.acc)}% · ${fmtDate(r.de.startedAt)}` : undefined}>
                      {r.de ? Math.round(r.de.wpm) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h3>History</h3>
        {history.length === 0 ? (
          <div className="empty">No sessions yet. Go type something!</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>when</th>
                  <th>lang</th>
                  <th>mode</th>
                  <th className="num">wpm</th>
                  <th className="num">raw</th>
                  <th className="num">acc</th>
                  <th className="num">time</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id ?? s.startedAt}>
                    <td>{fmtDate(s.startedAt)}</td>
                    <td>{s.lang.toUpperCase()}</td>
                    <td>
                      {modeLabel(s.mode)}
                      {s.punctuation ? ' · punct.' : ''}
                      {s.numbers ? ' · num.' : ''}
                      {s.noBackspace ? ' · no ⌫' : ''}
                    </td>
                    <td className="num">{Math.round(s.wpm)}</td>
                    <td className="num">{Math.round(s.raw)}</td>
                    <td className="num">{Math.round(s.acc)}%</td>
                    <td className="num">{fmtDuration(s.durationMs)}</td>
                    <td className="num">
                      <button className="btn small danger" onClick={() => remove(s.id)} aria-label="Delete session">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 25 && (
          <button className="btn small" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'show fewer' : `show all ${filtered.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

function sameDay(s: SessionRecord[]): boolean {
  return s.length > 0 && s[0].dateKey === s[s.length - 1].dateKey;
}

function Tile({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className="delta">{delta}</div>}
    </div>
  );
}

function buildCalendar(sessions: SessionRecord[], streak: StreakState): CalendarDay[][] {
  const act = activityByDay(sessions);
  const frozen = new Set(streak.frozenDays);
  const today = dateKey(new Date());
  const dow = (new Date().getDay() + 6) % 7; // Monday = 0
  const start = addDays(today, -(dow + 25 * 7));
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 26; w++) {
    const col: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(start, w * 7 + d);
      col.push({ key, minutes: (act.get(key)?.seconds ?? 0) / 60, frozen: frozen.has(key), inRange: key <= today });
    }
    weeks.push(col);
  }
  return weeks;
}
