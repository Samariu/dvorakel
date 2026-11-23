/** Sync connection settings. Kept per browser and never exported or synced themselves. */
export interface SyncConfig {
  /** Base URL of the sync server, e.g. https://pi.tailnet.ts.net */
  url: string;
  token: string;
  /** Server sequence number pulled up to. */
  cursor: number;
  /** `updatedAt` of the settings last sent to the server. */
  settingsPushedAt: number;
  lastSyncAt?: number;
  lastError?: string;
  /** Sessions on the server at the last sync. */
  serverSessions?: number;
}

const KEY = 'dvorakel.sync';

export function loadSyncConfig(): SyncConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.url === 'string' && typeof v.token === 'string' ? (v as SyncConfig) : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(c: SyncConfig | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: sync just won't remember its state.
  }
}

export function updateSyncConfig(patch: Partial<SyncConfig>): SyncConfig | null {
  const c = loadSyncConfig();
  if (!c) return null;
  const next = { ...c, ...patch };
  saveSyncConfig(next);
  return next;
}

export const syncEnabled = () => loadSyncConfig() !== null;
