// client/src/utils/stateDeltaClient.ts
// Networking-only: rebuild full per-viewer views from server "stateDelta" packets
// and hand them to the existing "state" listeners as an ordinary full payload, so
// UI code sees exactly what a full broadcast would have produced (fresh objects).
// Any version gap or patch failure drops the base and asks for requestState.
import { applyStateDelta, type StateDeltaPayload } from '../../../shared/src/stateDelta';

type DeltaSocket = {
  onAny: (fn: (event: string, ...args: any[]) => void) => unknown;
  on: (event: string, fn: (...args: any[]) => void) => unknown;
  emit: (event: string, ...args: any[]) => unknown;
  listeners: (event: string) => Array<(...args: any[]) => void>;
};

const RESYNC_RETRY_MS = 3000;

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export interface StateDeltaClient {
  readonly version: () => number | null;
  readonly handleIncoming: (event: string, payload: any) => void;
}

export function createStateDeltaClient(sock: DeltaSocket): StateDeltaClient {
  let base: any = null;
  let version: number | null = null;
  let gameId: string | null = null;
  let resyncAt = 0;

  const dropBase = () => { base = null; version = null; };

  const requestResync = (gid: string) => {
    dropBase();
    const now = Date.now();
    if (resyncAt && now - resyncAt < RESYNC_RETRY_MS) return;
    resyncAt = now;
    try { sock.emit('requestState', { gameId: gid }); } catch { /* ignore */ }
  };

  const onFullState = (p: any) => {
    resyncAt = 0;
    const wrapped = !!p && typeof p === 'object' && 'view' in p;
    const v = wrapped ? Number(p.viewVersion) : NaN;
    if (wrapped && p.view && Number.isFinite(v)) {
      base = cloneJson(p.view);
      version = v;
      gameId = p.gameId != null ? String(p.gameId) : null;
    } else {
      // Unversioned full state (join, requestState, room fallback): wait for a versioned one.
      dropBase();
      if (wrapped && p.gameId != null) gameId = String(p.gameId);
    }
  };

  const onDelta = (p: StateDeltaPayload) => {
    if (!p || p.gameId == null) return;
    const gid = String(p.gameId);
    if (base === null || version === null || gameId !== gid || p.baseVersion !== version) {
      requestResync(gid);
      return;
    }
    try {
      base = applyStateDelta(base, Array.isArray(p.ops) ? p.ops : []);
    } catch {
      requestResync(gid);
      return;
    }
    version = p.newVersion;
    const payload: Record<string, unknown> = { gameId: gid, view: cloneJson(base), seq: p.seq, viewVersion: p.newVersion };
    if (p.forceStateReplace) payload.forceStateReplace = true;
    for (const fn of sock.listeners('state').slice()) {
      try { fn(payload); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('state listener failed for delta:', e);
      }
    }
  };

  const handleIncoming = (event: string, payload: any) => {
    if (event === 'state') onFullState(payload);
    else if (event === 'stateDelta') onDelta(payload);
  };

  return { version: () => version, handleIncoming };
}

const installedOn = new WeakSet<object>();

/** onAny runs before per-event listeners and survives socket.off('state'). */
export function installStateDeltaClient(sock: DeltaSocket): void {
  if (installedOn.has(sock as object)) return;
  installedOn.add(sock as object);
  const client = createStateDeltaClient(sock);
  sock.onAny((event: string, ...args: any[]) => client.handleIncoming(event, args[0]));
  sock.on('disconnect', () => client.handleIncoming('state', null));
}