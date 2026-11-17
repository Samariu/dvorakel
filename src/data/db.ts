import Dexie, { type Table } from 'dexie';
import type { Lang, SessionRecord } from '../types';
import { loadSettings, saveSettings, type Settings } from './settings';

class DvorakelDB extends Dexie {
  sessions!: Table<SessionRecord, number>;
  constructor() {
    super('dvorakel');
    this.version(1).stores({ sessions: '++id, startedAt, lang, dateKey' });
  }
}

export const db = new DvorakelDB();

export async function saveSession(s: SessionRecord): Promise<number> {
  return db.sessions.add(s);
}

/**
 * Abandoned tests that were in progress when the page was closed. IndexedDB
 * writes can't be relied on during unload, so they are parked synchronously in
 * localStorage and written to the database on the next start.
 */
const PENDING_KEY = 'dvorakel.pendingAbandoned';

function readPending(): SessionRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writePending(recs: SessionRecord[]) {
  try {
    if (recs.length) localStorage.setItem(PENDING_KEY, JSON.stringify(recs));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage full or blocked: the abandoned test is lost, nothing else breaks.
  }
}

export function stashAbandoned(rec: SessionRecord): void {
  writePending([...readPending().filter((r) => r.startedAt !== rec.startedAt), rec]);
}

/** The page came back from the back/forward cache: the test is still running. */
export function unstashAbandoned(startedAt: number): void {
  writePending(readPending().filter((r) => r.startedAt !== startedAt));
}

export async function flushAbandoned(): Promise<void> {
  const pending = readPending();
  if (!pending.length) return;
  await db.sessions.bulkAdd(pending.map(({ id: _id, ...rest }) => ({ ...rest, abandoned: true }) as SessionRecord));
  writePending([]);
}

export async function allSessions(): Promise<SessionRecord[]> {
  return db.sessions.orderBy('startedAt').toArray();
}

export async function sessionsFor(lang: Lang): Promise<SessionRecord[]> {
  return (await db.sessions.where('lang').equals(lang).toArray()).sort((a, b) => a.startedAt - b.startedAt);
}

export async function deleteSession(id: number): Promise<void> {
  await db.sessions.delete(id);
}

export interface ExportFile {
  app: 'dvorakel';
  version: 1;
  exportedAt: string;
  settings: Settings;
  sessions: SessionRecord[];
}

export async function exportData(): Promise<ExportFile> {
  return {
    app: 'dvorakel',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: loadSettings(),
    sessions: await allSessions(),
  };
}

/** Replaces all data with the file's contents. Returns the number of sessions imported. */
export async function importData(file: unknown): Promise<number> {
  const f = file as Partial<ExportFile>;
  if (!f || f.app !== 'dvorakel' || !Array.isArray(f.sessions)) {
    throw new Error('This is not a Dvorakel export file.');
  }
  const sessions = f.sessions.filter(
    (s) => s && typeof s.startedAt === 'number' && Array.isArray(s.ks) && Array.isArray(s.words) && (s.lang === 'en' || s.lang === 'de'),
  );
  await db.transaction('rw', db.sessions, async () => {
    await db.sessions.clear();
    await db.sessions.bulkAdd(sessions.map(({ id: _id, ...rest }) => rest as SessionRecord));
  });
  if (f.settings) saveSettings({ ...loadSettings(), ...f.settings });
  return sessions.length;
}

export async function resetData(): Promise<void> {
  await db.sessions.clear();
}
