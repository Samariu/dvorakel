import type { SessionRecord } from '../types';
import { db, queueAllForSync } from './db';
import { applyRemoteSettings, loadSettings, settingsUpdatedAt, touchSettings, type Settings } from './settings';
import { loadSyncConfig, saveSyncConfig, updateSyncConfig, type SyncConfig } from './syncConfig';

const PUSH_BATCH = 200;
const PULL_BATCH = 500;
const TIMEOUT_MS = 30_000;

export interface SyncOutcome {
  /** Sessions added or removed locally by the pull. */
  changed: number;
  /** Settings were replaced by newer ones from the server. */
  settings: Settings | null;
}

interface PullItem {
  seq: number;
  uid: string;
  deleted: boolean;
  data: SessionRecord | null;
}

interface PullResponse {
  items: PullItem[];
  next: number;
  more: boolean;
  settings: { value: Partial<Settings>; updatedAt: number } | null;
}

export function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function call<T>(cfg: Pick<SyncConfig, 'url' | 'token'>, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(cfg.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (e) {
    throw new Error(
      ctrl.signal.aborted
        ? 'The sync server did not answer in time.'
        : `Can't reach the sync server (${e instanceof Error ? e.message : String(e)}). Is the Pi on and Tailscale connected?`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new Error('The sync server rejected the token.');
  if (!res.ok) throw new Error(`Sync server error ${res.status}: ${await res.text().catch(() => '')}`.trim());
  return (await res.json()) as T;
}

export interface ServerStatus {
  sessions: number;
  deleted: number;
  seq: number;
}

export function serverStatus(cfg: Pick<SyncConfig, 'url' | 'token'>): Promise<ServerStatus> {
  return call<ServerStatus>(cfg, '/v1/status');
}

/** Switch sync on: check the server, then queue everything in this browser for upload. */
export async function connectSync(url: string, token: string): Promise<ServerStatus> {
  const cfg = { url: normaliseUrl(url), token: token.trim() };
  if (!/^https?:\/\//.test(cfg.url)) throw new Error('The address must start with https://');
  const status = await serverStatus(cfg);
  saveSyncConfig({ ...cfg, cursor: 0, settingsPushedAt: 0, serverSessions: status.sessions });
  // Settings never changed here count as very old, so another browser's real choices win.
  if (!settingsUpdatedAt()) touchSettings(1);
  await queueAllForSync();
  return status;
}

export function disconnectSync(): void {
  saveSyncConfig(null);
  void db.outbox.clear();
}

async function push(cfg: SyncConfig): Promise<void> {
  let sendSettings = settingsUpdatedAt() > cfg.settingsPushedAt;
  for (;;) {
    const batch = await db.outbox.limit(PUSH_BATCH).toArray();
    if (!batch.length && !sendSettings) return;
    const newUids = batch.filter((e) => e.kind === 's').map((e) => e.uid);
    const local = newUids.length ? await db.sessions.where('uid').anyOf(newUids).toArray() : [];
    const sessions = local.map(({ id: _id, ...s }) => s);
    const deleted = batch.filter((e) => e.kind === 'd').map((e) => e.uid);
    const at = settingsUpdatedAt();
    await call(cfg, '/v1/push', {
      sessions,
      deleted,
      settings: sendSettings ? { value: loadSettings(), updatedAt: at } : null,
    });
    await db.outbox.bulkDelete(batch.map((e) => e.key));
    if (sendSettings) cfg = updateSyncConfig({ settingsPushedAt: at }) ?? cfg;
    sendSettings = false;
  }
}

async function pull(cfg: SyncConfig): Promise<SyncOutcome> {
  let changed = 0;
  let settings: Settings | null = null;
  for (;;) {
    const r = await call<PullResponse>(cfg, `/v1/pull?since=${cfg.cursor}&limit=${PULL_BATCH}`);
    await db.transaction('rw', db.sessions, async () => {
      for (const it of r.items) {
        const existing = await db.sessions.where('uid').equals(it.uid).primaryKeys();
        if (it.deleted) {
          if (existing.length) {
            await db.sessions.bulkDelete(existing);
            changed++;
          }
        } else if (!existing.length && it.data) {
          const { id: _id, ...rec } = it.data;
          await db.sessions.add({ ...rec, uid: it.uid } as SessionRecord);
          changed++;
        }
      }
    });
    cfg = updateSyncConfig({ cursor: r.next }) ?? cfg;
    if (r.settings && r.settings.updatedAt > settingsUpdatedAt()) {
      settings = applyRemoteSettings(r.settings.value, r.settings.updatedAt);
      cfg = updateSyncConfig({ settingsPushedAt: r.settings.updatedAt }) ?? cfg;
    }
    if (!r.more) return { changed, settings };
  }
}

/** Push local changes, then pull everything new. Throws with a readable message. */
async function syncOnce(): Promise<SyncOutcome> {
  const cfg = loadSyncConfig();
  if (!cfg) return { changed: 0, settings: null };
  try {
    await push(cfg);
    const out = await pull(loadSyncConfig() ?? cfg);
    const status = await serverStatus(cfg).catch(() => null);
    updateSyncConfig({ lastSyncAt: Date.now(), lastError: undefined, ...(status ? { serverSessions: status.sessions } : {}) });
    return out;
  } catch (e) {
    updateSyncConfig({ lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

let running: Promise<SyncOutcome> | null = null;
let again = false;

/** Runs a sync; calls while one is running are merged into one more run afterwards. */
export function syncNow(): Promise<SyncOutcome> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let total: SyncOutcome = { changed: 0, settings: null };
    try {
      do {
        again = false;
        const r = await syncOnce();
        total = { changed: total.changed + r.changed, settings: r.settings ?? total.settings };
      } while (again);
      return total;
    } finally {
      running = null;
    }
  })();
  return running;
}

