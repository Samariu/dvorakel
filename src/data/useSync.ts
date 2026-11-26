import { useCallback, useEffect, useRef, useState } from 'react';
import { syncNow, type SyncOutcome } from './sync';
import { loadSyncConfig } from './syncConfig';

export interface SyncState {
  enabled: boolean;
  url?: string;
  syncing: boolean;
  lastSyncAt?: number;
  lastError?: string;
  serverSessions?: number;
}

export interface SyncApi {
  state: SyncState;
  /** Sync now. */
  run: () => void;
  /** Sync in a moment (coalesces bursts, e.g. several settings changes). */
  soon: () => void;
}

const PERIOD_MS = 2 * 60_000;

function read(syncing = false): SyncState {
  const c = loadSyncConfig();
  return c
    ? { enabled: true, url: c.url, syncing, lastSyncAt: c.lastSyncAt, lastError: c.lastError, serverSessions: c.serverSessions }
    : { enabled: false, syncing: false };
}

/** Keeps this browser in step with the sync server, if one is configured. */
export function useSync(onRemote: (o: SyncOutcome) => void): SyncApi {
  const [state, setState] = useState<SyncState>(() => read());
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(() => {
    if (!loadSyncConfig()) {
      setState(read());
      return;
    }
    setState(read(true));
    syncNow()
      .then((o) => {
        if (o.changed || o.settings) onRemoteRef.current(o);
      })
      .catch(() => {
        // The error is stored in the sync config and shown in Settings.
      })
      .finally(() => setState(read()));
  }, []);

  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, 1500);
  }, [run]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', run);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, PERIOD_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', run);
      clearInterval(id);
    };
  }, [run]);

  return { state, run, soon };
}
