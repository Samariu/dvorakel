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
