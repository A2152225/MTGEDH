/**
 * CPU profile of a self-play game, summarised for the tick that timed out.
 *
 * Origin parent: tests/helpers/liveGameHarness.ts (new, no code moved).
 * Off unless AI_SELFPLAY_STALL_PROFILE=1. The V8 sampling profiler runs for the
 * whole advance loop; on a tick-timeout the harness stops it and this module
 * reports where the real time of the last tick went (self time, inclusive time,
 * heaviest call path, idle share). Also tracks event-loop lag so a blocked loop
 * can be told apart from a busy but free one.
 *
 * Public entry symbols: startStallCpuProfile, stopStallCpuProfile,
 * startEventLoopLagMonitor.
 */
import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector';
import { setInterval as realSetInterval, clearInterval as realClearInterval } from 'node:timers';

type CallFrame = { functionName: string; url: string; lineNumber: number };
type ProfileNode = { id: number; callFrame: CallFrame; children?: number[] };
type CpuProfile = { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[]; startTime: number; endTime: number };

const PROFILE_ENABLED = process.env.AI_SELFPLAY_STALL_PROFILE === '1';
const SAMPLING_INTERVAL_US = Math.max(500, Number(process.env.AI_SELFPLAY_STALL_PROFILE_INTERVAL_US || 2000) || 2000);

let session: inspector.Session | null = null;

function post<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!session) {
      reject(new Error('no inspector session'));
      return;
    }
    session.post(method, params as never, (err: Error | null, result: unknown) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}

export async function startStallCpuProfile(): Promise<boolean> {
  if (!PROFILE_ENABLED || session) return false;
  try {
    session = new inspector.Session();
    session.connect();
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US });
    await post('Profiler.start');
    return true;
  } catch (err) {
    console.log(`[selfplay-stall] cpu profile could not start: ${String(err).slice(0, 160)}`);
    try { session?.disconnect(); } catch { /* ignore */ }
    session = null;
    return false;
  }
}

function frameLabel(frame: CallFrame): string {
  const file = String(frame.url || '').split(/[\\/]/).pop() || '';
  const name = frame.functionName || '(anonymous)';
  return file ? `${name} ${file}:${frame.lineNumber + 1}` : name;
}

function summarise(profile: CpuProfile, windowMs: number): { lines: string[]; headline: string } {
  const nodes = new Map<number, ProfileNode>();
  const parentOf = new Map<number, number>();
  for (const node of profile.nodes) {
    nodes.set(node.id, node);
    for (const child of node.children || []) parentOf.set(child, node.id);
  }
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  const windowStartUs = profile.endTime - windowMs * 1000;
  const selfUs = new Map<number, number>();
  let clock = profile.startTime;
  let windowUs = 0;
  for (let index = 0; index < samples.length; index++) {
    clock += deltas[index] || 0;
    if (clock < windowStartUs) continue;
    const delta = deltas[index] || 0;
    selfUs.set(samples[index], (selfUs.get(samples[index]) || 0) + delta);
    windowUs += delta;
  }

  const selfByFn = new Map<string, number>();
  const inclusiveByFn = new Map<string, number>();
  const inclusiveByNode = new Map<number, number>();
  for (const [nodeId, us] of selfUs) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    const label = frameLabel(node.callFrame);
    selfByFn.set(label, (selfByFn.get(label) || 0) + us);
    const seen = new Set<string>();
    let cursor: number | undefined = nodeId;
    while (cursor !== undefined) {
      inclusiveByNode.set(cursor, (inclusiveByNode.get(cursor) || 0) + us);
      const cursorNode = nodes.get(cursor);
      if (cursorNode) {
        const cursorLabel = frameLabel(cursorNode.callFrame);
        if (!seen.has(cursorLabel)) {
          seen.add(cursorLabel);
          inclusiveByFn.set(cursorLabel, (inclusiveByFn.get(cursorLabel) || 0) + us);
        }
      }
      cursor = parentOf.get(cursor);
    }
  }

  const pct = (us: number) => (windowUs > 0 ? ((us / windowUs) * 100).toFixed(1) : '0.0');
  const ms = (us: number) => Math.round(us / 1000);
  const top = (map: Map<string, number>, limit: number) =>
    [...map.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit);

  const idleUs = (selfByFn.get('(idle)') || 0);
  const programUs = (selfByFn.get('(program)') || 0);
  const gcUs = (selfByFn.get('(garbage collector)') || 0);

  // Heaviest path: from the root, keep stepping into the child that holds the most time.
  const heaviest: string[] = [];
  const root = profile.nodes.find((node) => !parentOf.has(node.id));
  let cursor = root;
  while (cursor && heaviest.length < 70) {
    let best: ProfileNode | undefined;
    let bestUs = 0;
    for (const childId of cursor.children || []) {
      const us = inclusiveByNode.get(childId) || 0;
      const child = nodes.get(childId);
      if (!child || us <= bestUs) continue;
      if (child.callFrame.functionName === '(idle)') continue;
      best = child;
      bestUs = us;
    }
    if (!best || bestUs < windowUs * 0.01) break;
    heaviest.push(`${pct(bestUs).padStart(5)}% ${String(ms(bestUs)).padStart(7)}ms  ${frameLabel(best.callFrame)}`);
    cursor = best;
  }

  const lines = [
    `window=${Math.round(windowUs / 1000)}ms of last ${Math.round(windowMs)}ms, samples=${samples.length}, interval=${SAMPLING_INTERVAL_US}us`,
    `idle=${pct(idleUs)}% program=${pct(programUs)}% gc=${pct(gcUs)}%`,
    '',
    'TOP SELF TIME',
    ...top(selfByFn, 40).map(([label, us]) => `${pct(us).padStart(5)}% ${String(ms(us)).padStart(7)}ms  ${label}`),
    '',
    'TOP INCLUSIVE TIME',
    ...top(inclusiveByFn, 70).map(([label, us]) => `${pct(us).padStart(5)}% ${String(ms(us)).padStart(7)}ms  ${label}`),
    '',
    'HEAVIEST CALL PATH (root first)',
    ...heaviest,
  ];
  const headline = `idle=${pct(idleUs)}% gc=${pct(gcUs)}% topSelf=[${top(selfByFn, 8)
    .map(([label, us]) => `${pct(us)}% ${label}`)
    .join('; ')}]`;
  return { lines, headline };
}

/**
 * Stops the profiler. With `report`, writes the raw profile and a text summary of
 * the last `windowMs` of real time and returns a one-line headline.
 */
export async function stopStallCpuProfile(report?: { label: string; windowMs: number }): Promise<string | null> {
  if (!session) return null;
  let headline: string | null = null;
  try {
    const { profile } = await post<{ profile: CpuProfile }>('Profiler.stop');
    if (report) {
      const outDir = path.resolve(process.env.AI_SELFPLAY_STALL_PROFILE_DIR || 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const safeLabel = report.label.replace(/[^A-Za-z0-9_.-]+/g, '_');
      const summary = summarise(profile, report.windowMs);
      const summaryPath = path.join(outDir, `stall-profile-${safeLabel}.txt`);
      fs.writeFileSync(summaryPath, `${summary.lines.join('\n')}\n`);
      fs.writeFileSync(path.join(outDir, `stall-profile-${safeLabel}.cpuprofile`), JSON.stringify(profile));
      headline = `${summary.headline} summary=${summaryPath}`;
    }
  } catch (err) {
    headline = `cpu profile failed: ${String(err).slice(0, 160)}`;
  } finally {
    try { session.disconnect(); } catch { /* ignore */ }
    session = null;
  }
  return headline;
}

/**
 * Real-timer heartbeat. `maxLagMs` is the longest the event loop went without
 * running it: seconds or more means one synchronous block, tens of ms means the
 * loop stayed free and the time went into many short callbacks.
 */
export function startEventLoopLagMonitor(intervalMs = 100): {
  reset: () => void;
  read: () => { maxLagMs: number; beats: number };
  stop: () => void;
} {
  const now = () => Number(process.hrtime.bigint()) / 1_000_000;
  let last = now();
  let maxLagMs = 0;
  let beats = 0;
  const timer = realSetInterval(() => {
    const current = now();
    const lag = current - last - intervalMs;
    if (lag > maxLagMs) maxLagMs = lag;
    last = current;
    beats += 1;
  }, intervalMs);
  timer.unref?.();
  return {
    reset: () => {
      last = now();
      maxLagMs = 0;
      beats = 0;
    },
    read: () => ({ maxLagMs: Math.max(maxLagMs, now() - last - intervalMs), beats }),
    stop: () => realClearInterval(timer),
  };
}
