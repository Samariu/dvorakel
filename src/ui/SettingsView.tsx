import { useRef, useState, type ReactNode } from 'react';
import { exportData, importData, resetData } from '../data/db';
import { withGoal, type Settings, type Theme } from '../data/settings';
import { POOL_SIZES } from '../content/generator';
import { dateKey, FREEZE_EVERY, goalFor, MAX_FREEZES } from '../streak/streak';

interface Props {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  onDataChanged: () => void;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </span>
  );
}

function Field({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div>
        <div>{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsView({ settings, update, onDataChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const goal = goalFor(dateKey(new Date()), settings.goals);

  const setGoal = (type: 'minutes' | 'tests', value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const next = withGoal(settings, type, value);
    update({ goals: next.goals });
  };

  const doExport = async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dvorakel-backup-${dateKey(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg(`Exported ${data.sessions.length} sessions.`);
  };

  const doImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      if (!confirm('Importing replaces all sessions in this browser with the ones in the file. Continue?')) return;
      const n = await importData(json);
      setMsg(`Imported ${n} sessions. Reloading settings…`);
      onDataChanged();
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setMsg(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doReset = async () => {
    if (!confirm('Delete ALL sessions and statistics in this browser? This cannot be undone. Export a backup first if unsure.')) return;
    await resetData();
    onDataChanged();
    setMsg('All sessions deleted.');
  };

  return (
    <div className="settings" style={{ maxWidth: 720 }}>
      <h2 className="page-title">Settings</h2>
      <p className="page-sub">Changes are saved automatically.</p>

      <section className="card">
        <h3>Typing</h3>
        <Field title="Word pool" desc="How many of the most common words random tests draw from.">
          <select value={settings.poolSize} onChange={(e) => update({ poolSize: Number(e.target.value) })}>
            {POOL_SIZES.map((n) => (
              <option key={n} value={n}>
                top {n.toLocaleString()}
              </option>
            ))}
          </select>
        </Field>
        <Field title="No-backspace mode" desc="Mistakes can't be corrected; you have to keep going.">
          <Switch label="No-backspace mode" checked={settings.noBackspace} onChange={(v) => update({ noBackspace: v })} />
        </Field>
        <Field title="Live WPM" desc="Show speed while typing.">
          <Switch label="Live WPM" checked={settings.liveWpm} onChange={(v) => update({ liveWpm: v })} />
        </Field>
        <Field title="WPM targets" desc="Drawn as lines on the speed chart, comma separated.">
          <input
            type="text"
            defaultValue={settings.targets.join(', ')}
            style={{ width: '8em', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px' }}
            onBlur={(e) => {
              const t = e.target.value
                .split(/[,\s]+/)
                .map(Number)
                .filter((x) => x > 0 && x < 400);
              update({ targets: t });
            }}
            aria-label="WPM targets"
          />
        </Field>
      </section>

      <section className="card">
        <h3>Streak</h3>
        <Field title="Show streak" desc="Turn off to hide the streak everywhere. Your history is kept either way.">
          <Switch label="Show streak" checked={settings.streakEnabled} onChange={(v) => update({ streakEnabled: v })} />
        </Field>
        <Field title="Daily goal" desc="Changing the goal applies from today; past days keep the goal they had.">
          <span style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              min={1}
              max={600}
              value={goal.value}
              onChange={(e) => setGoal(goal.type, Number(e.target.value))}
              aria-label="Goal value"
            />
            <select value={goal.type} onChange={(e) => setGoal(e.target.value as 'minutes' | 'tests', goal.value)} aria-label="Goal unit">
              <option value="minutes">minutes</option>
              <option value="tests">tests</option>
            </select>
          </span>
        </Field>
        <p className="notice">
          You earn a freeze for every {FREEZE_EVERY} goal days in a row (max {MAX_FREEZES}). A freeze is used automatically when you
          miss a day, so one busy day doesn't reset your streak.
        </p>
      </section>

      <section className="card">
        <h3>Appearance</h3>
        <Field title="Theme">
          <div className="seg" role="group" aria-label="Theme">
            {(['system', 'dark', 'light'] as Theme[]).map((t) => (
              <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => update({ theme: t })}>
                {t}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section className="card">
        <h3>Data</h3>
        <p className="notice" style={{ marginTop: 0 }}>
          Everything is stored only in this browser (IndexedDB). Clearing site data deletes it, so export a backup now and then. A
          backup also moves your history to another computer or browser.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={doExport}>
            Export backup (JSON)
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import backup…
          </button>
          <button className="btn danger" onClick={doReset}>
            Delete all data
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {msg && <p className="notice">{msg}</p>}
      </section>
    </div>
  );
}
