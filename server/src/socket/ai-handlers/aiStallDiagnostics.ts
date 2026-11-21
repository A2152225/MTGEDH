/**
 * AI scheduling counters for stall diagnosis (self-play harness tick-timeouts).
 *
 * Origin parent: none (new). Written to by aiScheduler.ts and aiFastPassPrecheck.ts;
 * read by tests/helpers/liveGameHarness.ts when one fake-timer tick exceeds its
 * real wall-clock budget.
 *
 * Cluster: plain in-memory counters and duration maxima. They never touch game
 * state, so nothing here needs a replay event. Caller capture (a stack trace per
 * schedule call) is off unless AI_STALL_DIAG_CALLERS=1.
 *
 * Public entry symbols: noteAIStallCount, noteAIStallDuration, noteAIStallCaller,
 * aiStallNowMs, resetAIStallDiagnostics, formatAIStallDiagnostics.
 */

type DurationStat = { count: number; totalMs: number; maxMs: number };

const counts = new Map<string, number>();
const durations = new Map<string, DurationStat>();
const callers = new Map<string, number>();
const CAPTURE_CALLERS = process.env.AI_STALL_DIAG_CALLERS === '1';

/** Real monotonic ms (the harness fakes Date, never hrtime). */
export function aiStallNowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export function noteAIStallCount(name: string): void {
  counts.set(name, (counts.get(name) || 0) + 1);
}

export function noteAIStallDuration(name: string, startedAtMs: number): void {
  const elapsed = aiStallNowMs() - startedAtMs;
  const stat = durations.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
  stat.count += 1;
  stat.totalMs += elapsed;
  if (elapsed > stat.maxMs) stat.maxMs = elapsed;
  durations.set(name, stat);
}

/** Records which code scheduled an AI action. No-op unless AI_STALL_DIAG_CALLERS=1. */
export function noteAIStallCaller(name: string): void {
  if (!CAPTURE_CALLERS) return;
  const frames = String(new Error().stack || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim().replace(/^at\s+/, ''))
    .filter((line) => !/aiStallDiagnostics|scheduleAIActionInternal|scheduleAIPriority|scheduleAIGameFlow|node:internal/.test(line))
    .slice(0, 2)
    .map((line) => {
      const fn = line.split(' ')[0] || '?';
      const where = line.match(/([^\\/()]+\.[cm]?[jt]s):(\d+)/);
      return where ? `${fn}@${where[1]}:${where[2]}` : fn;
    });
  const key = `${name} <- ${frames.join(' <- ') || '?'}`;
  callers.set(key, (callers.get(key) || 0) + 1);
}

export function resetAIStallDiagnostics(): void {
  counts.clear();
  durations.clear();
  callers.clear();
}

export function formatAIStallDiagnostics(): string {
  const countText = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');
  const durationText = [...durations.entries()]
    .sort((left, right) => right[1].totalMs - left[1].totalMs)
    .map(([name, stat]) => `${name}{n=${stat.count} total=${Math.round(stat.totalMs)}ms max=${Math.round(stat.maxMs)}ms}`)
    .join(' ');
  const callerText = [...callers.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([name, value]) => `${value}x ${name}`)
    .join(' | ');
  return `counts=[${countText}] durations=[${durationText}] callers=[${callerText}]`;
}
