import { watch as fsWatch } from 'node:fs';
import type { IndexStats } from './indexer.js';

export type WatchListener = (relativePath: string | null) => void;
export type WatchFn = (root: string, listener: WatchListener) => { close(): void };

export interface WatchOptions {
  root: string;
  /** Runs one incremental index pass (normally indexRepository). */
  reindex: () => Promise<IndexStats>;
  /** Quiet period after the last change before a pass starts. Default 300. */
  debounceMs?: number;
  /** Called after each pass with its stats and the changed paths that triggered it (sorted, deduped; may be empty when the platform gave no filename). */
  onIndexed?: (stats: IndexStats, changedPaths: string[]) => void;
  /** Called when a pass throws; the watcher keeps running. */
  onError?: (error: unknown) => void;
  /** Defaults to node:fs `watch(root, { recursive: true })`. Injected in tests. */
  watch?: WatchFn;
}

export interface Watcher {
  /** Resolves when no pass is running or scheduled. */
  idle(): Promise<void>;
  /** Stops watching, cancels a pending pass, and waits for a running pass to finish. */
  close(): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 300;

/** Recursive `fs.watch` on the root; errors are forwarded to `onError`. */
function createFsWatch(onError: (error: unknown) => void): WatchFn {
  return (root, listener) => {
    const watcher = fsWatch(root, { recursive: true }, (_event, filename) =>
      listener(filename ? String(filename) : null),
    );
    watcher.on('error', onError);
    return watcher;
  };
}

function isInsideGit(relativePath: string): boolean {
  return relativePath.split('/').includes('.git');
}

/**
 * Re-runs an incremental index pass whenever files under `root` change.
 *
 * Events are debounced: each one restarts a timer, and when it fires a single pass runs for
 * everything collected so far. Passes never overlap. Events that arrive during a pass are
 * kept, and one follow-up pass is scheduled after it finishes. Changes inside `.git` are
 * ignored. A failing pass is reported through `onError` and the watcher keeps running.
 */
export function watchRepository(options: WatchOptions): Watcher {
  const { root, reindex, onIndexed, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const onError = options.onError ?? (() => {});
  const startWatching = options.watch ?? createFsWatch(onError);

  const changed = new Set<string>();
  let dirty = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> | undefined;
  let closed = false;
  let idleWaiters: Array<() => void> = [];

  function settleIdle(): void {
    if (timer !== undefined || current !== undefined) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      current = runPass().finally(() => {
        current = undefined;
        if (dirty && !closed) schedule();
        settleIdle();
      });
    }, debounceMs);
  }

  async function runPass(): Promise<void> {
    const paths = [...changed].sort();
    changed.clear();
    dirty = false;
    try {
      const stats = await reindex();
      onIndexed?.(stats, paths);
    } catch (error) {
      onError(error);
    }
  }

  const fsWatcher = startWatching(root, (relativePath) => {
    if (closed) return;
    if (relativePath !== null) {
      const normalized = relativePath.replaceAll('\\', '/');
      if (isInsideGit(normalized)) return;
      changed.add(normalized);
    }
    dirty = true;
    // During a pass the event is only recorded; the pass schedules its own follow-up.
    if (current === undefined) schedule();
  });

  return {
    idle() {
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
        settleIdle();
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      fsWatcher.close();
      await current;
      settleIdle();
    },
  };
}
