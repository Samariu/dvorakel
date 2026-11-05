import { useCallback, useEffect, useMemo, useState } from 'react';
import { allSessions, saveSession } from './data/db';
import { loadSettings, saveSettings, type Settings } from './data/settings';
import { computeStreak, dateKey, type DayActivity } from './streak/streak';
import type { DrillTarget, Lang, SessionRecord } from './types';
import { TestView } from './ui/TestView';
import { PracticeView } from './ui/PracticeView';
import { StatsView } from './ui/StatsView';
import { SettingsView } from './ui/SettingsView';
import { StreakChip } from './ui/StreakChip';

type Tab = 'test' | 'practice' | 'stats' | 'settings';

export interface ActiveDrill {
  label: string;
  targets: DrillTarget[];
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'test', label: 'Test' },
  { id: 'practice', label: 'Practice' },
  { id: 'stats', label: 'Stats' },
  { id: 'settings', label: 'Settings' },
];

export function activityByDay(sessions: SessionRecord[]): Map<string, DayActivity> {
  const m = new Map<string, DayActivity>();
  for (const s of sessions) {
    const a = m.get(s.dateKey) ?? { seconds: 0, tests: 0 };
    a.seconds += s.durationMs / 1000;
    a.tests += 1;
    m.set(s.dateKey, a);
  }
  return m;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('test');
  const [drill, setDrill] = useState<ActiveDrill | null>(null);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const reload = useCallback(() => {
    allSessions()
      .then(setSessions)
      .catch((e: unknown) => {
        setLoadError(String(e));
        setSessions([]);
      });
  }, []);

  useEffect(reload, [reload]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings.theme]);

  const onSaved = useCallback(async (rec: SessionRecord) => {
    try {
      const id = await saveSession(rec);
      setSessions((s) => [...(s ?? []), { ...rec, id }]);
    } catch (e) {
      setLoadError(`Could not save the session: ${String(e)}`);
      setSessions((s) => [...(s ?? []), rec]);
    }
  }, []);

  const today = dateKey(new Date());
  const streak = useMemo(
    () => computeStreak(activityByDay(sessions ?? []), settings.goals, today),
    [sessions, settings.goals, today],
  );

  const setLang = (lang: Lang) => {
    if (lang === settings.lang) return;
    setDrill(null);
    update({ lang });
  };

  const startDrill = (d: ActiveDrill) => {
    setDrill(d);
    setTab('test');
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo" title="Dvorak + Orakel: it tells you what to practise">
          <span>
            dvorakel<span className="dot">.</span>
          </span>
          <small>finds your weak spots</small>
        </div>
        <nav className="tabs" aria-label="Main">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="seg" role="group" aria-label="Language">
          {(['en', 'de'] as Lang[]).map((l) => (
            <button key={l} className={settings.lang === l ? 'on' : ''} onClick={() => setLang(l)} aria-pressed={settings.lang === l}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        {settings.streakEnabled && <StreakChip streak={streak} />}
      </header>

      {loadError && <p className="notice">⚠ {loadError}</p>}

      <main>
        {tab === 'test' && (
          <TestView
            settings={settings}
            update={update}
            sessions={sessions ?? []}
            drill={drill}
            clearDrill={() => setDrill(null)}
            onSaved={onSaved}
          />
        )}
        {tab === 'practice' && <PracticeView settings={settings} update={update} sessions={sessions} onStart={startDrill} />}
        {tab === 'stats' && <StatsView settings={settings} sessions={sessions ?? []} streak={streak} onChanged={reload} />}
        {tab === 'settings' && <SettingsView settings={settings} update={update} onDataChanged={reload} />}
      </main>

      <footer className="footer">
        Dvorakel · data stays in this browser · word lists from OpenSubtitles frequencies (CC BY-SA 4.0), texts from Project
        Gutenberg
      </footer>
    </div>
  );
}
