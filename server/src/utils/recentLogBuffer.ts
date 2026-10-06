/**
 * server/src/utils/recentLogBuffer.ts
 *
 * Fixed-size in-memory ring of recent server log lines, fed by utils/debug.ts
 * (level-1 lines always, verbose lines only when DEBUG_STATE enables them).
 * Used to attach "last N relevant log lines" to game-stall reports without
 * reading log files. Only the leading string/number args are kept, so this
 * stays cheap on hot paths.
 *
 * Public entry symbols: recordRecentLogLine, getRecentLogLines, clearRecentLogLinesForTests.
 */

const RECENT_LOG_CAPACITY = 1000;
const MAX_LINE_CHARS = 500;

interface RecentLogEntry {
  at: number;
  level: string;
  text: string;
  gameId?: string;
}

const ring: Array<RecentLogEntry | undefined> = new Array(RECENT_LOG_CAPACITY);
let nextIndex = 0;
let filled = 0;

export function recordRecentLogLine(level: string, args: readonly unknown[]): void {
  try {
    if (!args || args.length === 0) return;
    const first = args[0];
    let text = typeof first === 'string'
      ? first
      : first instanceof Error
        ? `${first.name}: ${first.message}`
        : '';
    let gameId: string | undefined;
    for (let i = 1; i < args.length && i < 4; i++) {
      const arg = args[i] as any;
      if (typeof arg === 'string' || typeof arg === 'number') {
        if (text.length < MAX_LINE_CHARS) text += ` ${arg}`;
      } else if (arg instanceof Error) {
        if (text.length < MAX_LINE_CHARS) text += ` ${arg.message}`;
      } else if (arg && typeof arg === 'object' && !Array.isArray(arg) && typeof arg.gameId === 'string') {
        gameId = arg.gameId;
      }
    }
    if (!text) return;
    ring[nextIndex] = { at: Date.now(), level, text: text.slice(0, MAX_LINE_CHARS), gameId };
    nextIndex = (nextIndex + 1) % RECENT_LOG_CAPACITY;
    if (filled < RECENT_LOG_CAPACITY) filled += 1;
  } catch {
    // never let log capture break callers
  }
}

function orderedEntries(): RecentLogEntry[] {
  const out: RecentLogEntry[] = [];
  const start = filled < RECENT_LOG_CAPACITY ? 0 : nextIndex;
  for (let i = 0; i < filled; i++) {
    const entry = ring[(start + i) % RECENT_LOG_CAPACITY];
    if (entry) out.push(entry);
  }
  return out;
}

function format(entry: RecentLogEntry): string {
  return `${new Date(entry.at).toISOString()} [${entry.level}] ${entry.text}`;
}

/**
 * Last `limit` lines. With a gameId, lines that mention the game (in text or
 * via a `{ gameId }` arg) are preferred; falls back to all recent lines when
 * fewer than 10 game-specific lines exist.
 */
export function getRecentLogLines(limit: number, gameId?: string): string[] {
  const entries = orderedEntries();
  const max = Math.max(0, limit | 0);
  if (gameId) {
    const relevant = entries.filter((entry) => entry.gameId === gameId || entry.text.includes(gameId));
    if (relevant.length >= 10) return relevant.slice(-max).map(format);
  }
  return entries.slice(-max).map(format);
}

export function clearRecentLogLinesForTests(): void {
  ring.fill(undefined);
  nextIndex = 0;
  filled = 0;
}
