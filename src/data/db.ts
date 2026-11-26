import Dexie, { type Table } from 'dexie';
import type { Lang, SessionRecord } from '../types';
import { loadSettings, saveSettings, touchSettings, type Settings } from './settings';
import { syncEnabled } from './syncConfig';

/** A change waiting to be sent to the sync server. */
export interface OutboxEntry {
  /** `s:<uid>` for a new session, `d:<uid>` for a deletion. */
  key: string;
  kind: 's' | 'd';
  uid: string;
}

class DvorakelDB extends Dexie {
  sessions!: Table<SessionRecord, number>;
  outbox!: Table<OutboxEntry, string>;
  constructor() {
    super('dvorakel');
    this.version(1).stores({ sessions: '++id, startedAt, lang, dateKey' });
    this.version(2)
      .stores({ sessions: '++id, startedAt, lang, dateKey, uid', outbox: '&key' })
      .upgrade((tx) =>
        tx
          .table('sessions')
          .toCollection()
          .modify((s: SessionRecord) => {
            if (!s.uid) s.uid = legacyUid(s);
          }),
      );
  }
}

export const db = new DvorakelDB();

/**
 * Id for sessions recorded before ids existed. Deterministic, so the same
 * session copied to two browsers (export/import) is recognised as one.
 */
export function legacyUid(s: Pick<SessionRecord, 'startedAt' | 'lang' | 'ks'>): string {
  return `l-${Math.round(s.startedAt)}-${s.lang}-${s.ks?.length ?? 0}`;
}

export function newUid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const outboxFor = (kind: 's' | 'd', uids: string[]): OutboxEntry[] => uids.map((uid) => ({ key: `${kind}:${uid}`, kind, uid }));

/** Store new sessions and queue them for sync. Returns the local ids. */
export async function addSessions(recs: SessionRecord[]): Promise<number[]> {
  const withUid = recs.map(({ id: _id, ...r }) => ({ ...r, uid: r.uid ?? newUid() }) as SessionRecord);
  return db.transaction('rw', db.sessions, db.outbox, async () => {
    const ids = (await db.sessions.bulkAdd(withUid, { allKeys: true })) as number[];
    if (syncEnabled()) await db.outbox.bulkPut(outboxFor('s', withUid.map((r) => r.uid!)));
    return ids;
  });
}

export async function saveSession(s: SessionRecord): Promise<number> {
  return (await addSessions([s]))[0];
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
  await addSessions(pending.map((r) => ({ ...r, abandoned: true })));
  writePending([]);
}

export async function allSessions(): Promise<SessionRecord[]> {
  return db.sessions.orderBy('startedAt').toArray();
}

export async function sessionsFor(lang: Lang): Promise<SessionRecord[]> {
  return (await db.sessions.where('lang').equals(lang).toArray()).sort((a, b) => a.startedAt - b.startedAt);
}

async function deleteUids(uids: string[]) {
  if (syncEnabled() && uids.length) await db.outbox.bulkPut(outboxFor('d', uids));
}

export async function deleteSession(id: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.outbox, async () => {
    const s = await db.sessions.get(id);
    await db.sessions.delete(id);
    if (s?.uid) {
      await db.outbox.delete(`s:${s.uid}`);
      await deleteUids([s.uid]);
    }
  });
}

/** Queue every local session for upload (when sync is switched on). */
export async function queueAllForSync(): Promise<void> {
  const uids = (await db.sessions.toArray()).map((s) => s.uid).filter((u): u is string => !!u);
  await db.outbox.bulkPut(outboxFor('s', uids));
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
  const incoming = sessions.map((s) => ({ ...s, uid: s.uid ?? legacyUid(s) }));
  const keep = new Set(incoming.map((s) => s.uid));
  await db.transaction('rw', db.sessions, db.outbox, async () => {
    // With sync on, "replace" means: sessions not in the file are deleted everywhere.
    const gone = (await db.sessions.toArray()).map((s) => s.uid).filter((u): u is string => !!u && !keep.has(u));
    await db.sessions.clear();
    await deleteUids(gone);
    await addSessions(incoming);
  });
  if (f.settings) {
    saveSettings({ ...loadSettings(), ...f.settings });
    touchSettings();
  }
  return sessions.length;
}

/** Deletes every session (on all synced browsers too, if sync is on). */
export async function resetData(): Promise<void> {
  await db.transaction('rw', db.sessions, db.outbox, async () => {
    const uids = (await db.sessions.toArray()).map((s) => s.uid).filter((u): u is string => !!u);
    await db.sessions.clear();
    await deleteUids(uids);
  });
}
