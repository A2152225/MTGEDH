/**
 * Silent-throw tripwire for game-logic hook paths.
 *
 * Hook and handler catches that used to swallow errors (empty catch, log-only,
 * or return-a-fallback) should call reportHookFailure(tag, err, ctx) before
 * that fallback. Failures are kept in an in-memory ring so smoke tests, AI
 * self-play, and the vitest afterEach hook can fail the run instead of hiding
 * the exception the way the Nov 15 require() hook breakages did.
 *
 * Production gameplay is unchanged when MTGEDH_STRICT_HOOKS is unset: the
 * caller still applies its fallback. The reporter logs one tagged line and
 * records the event. With MTGEDH_STRICT_HOOKS=1 (or true/yes/on), it rethrows
 * after recording so the failure aborts the current hook immediately.
 *
 * Public: reportHookFailure, getHookFailures, getHookFailureCounts,
 * resetHookFailures, formatHookFailuresForAssert, isStrictHooksEnabled,
 * STRICT_HOOKS_ENV.
 */

export const STRICT_HOOKS_ENV = 'MTGEDH_STRICT_HOOKS';

export type HookFailureContext = {
  cardName?: string;
  cardId?: string;
  gameId?: string;
  playerId?: string;
  source?: string;
  extra?: string;
};

export type HookFailure = {
  at: number;
  tag: string;
  message: string;
  name: string;
  stack?: string;
  ctx?: HookFailureContext;
};

const CAPACITY = 200;
const ring: Array<HookFailure | undefined> = new Array(CAPACITY);
let nextIndex = 0;
let filled = 0;
const counts = new Map<string, number>();

export function isStrictHooksEnabled(): boolean {
  const raw = String(process.env[STRICT_HOOKS_ENV] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function errorParts(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name || 'Error',
      message: err.message || String(err),
      stack: err.stack,
    };
  }
  if (typeof err === 'string') return { name: 'Error', message: err };
  try {
    return { name: 'Error', message: JSON.stringify(err) };
  } catch {
    return { name: 'Error', message: String(err) };
  }
}

function stackSnippet(stack: string | undefined, lines = 4, maxChars = 400): string {
  if (!stack) return '';
  return stack
    .split(/\n/)
    .slice(0, lines)
    .join(' | ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

export function reportHookFailure(tag: string, err: unknown, ctx?: HookFailureContext): void {
  const parts = errorParts(err);
  const cleanedCtx = ctx
    ? Object.fromEntries(Object.entries(ctx).filter(([, value]) => value != null && value !== ''))
    : undefined;
  const entry: HookFailure = {
    at: Date.now(),
    tag: String(tag || 'unknown'),
    name: parts.name,
    message: parts.message,
    stack: parts.stack,
    ctx: cleanedCtx && Object.keys(cleanedCtx).length ? (cleanedCtx as HookFailureContext) : undefined,
  };

  ring[nextIndex] = entry;
  nextIndex = (nextIndex + 1) % CAPACITY;
  if (filled < CAPACITY) filled += 1;
  counts.set(entry.tag, (counts.get(entry.tag) || 0) + 1);

  const card = entry.ctx?.cardName ? ` card=${entry.ctx.cardName}` : '';
  const source = entry.ctx?.source ? ` source=${entry.ctx.source}` : '';
  const snippet = stackSnippet(parts.stack);
  const line = `[hook-failure] tag=${entry.tag}${card}${source} ${parts.name}: ${parts.message}`
    + (snippet ? ` stack=${snippet}` : '');
  try {
    console.error(line);
  } catch {
    // Never let logging throw; the optional rethrow below is the only abort path.
  }

  if (isStrictHooksEnabled()) {
    if (err instanceof Error) throw err;
    const wrapped = new Error(`[hook-failure] ${entry.tag}: ${parts.message}`);
    throw wrapped;
  }
}

export function getHookFailures(): HookFailure[] {
  const out: HookFailure[] = [];
  const start = filled < CAPACITY ? 0 : nextIndex;
  for (let i = 0; i < filled; i++) {
    const entry = ring[(start + i) % CAPACITY];
    if (entry) out.push(entry);
  }
  return out;
}

export function getHookFailureCounts(): Record<string, number> {
  return Object.fromEntries(counts.entries());
}

export function resetHookFailures(): void {
  ring.fill(undefined);
  nextIndex = 0;
  filled = 0;
  counts.clear();
}

export function formatHookFailuresForAssert(failures: readonly HookFailure[] = getHookFailures()): string {
  return failures
    .map((failure) => {
      const card = failure.ctx?.cardName ? ` card=${failure.ctx.cardName}` : '';
      const source = failure.ctx?.source ? ` source=${failure.ctx.source}` : '';
      const snippet = stackSnippet(failure.stack, 3, 240);
      return `${failure.tag}${card}${source}: ${failure.name}: ${failure.message}${snippet ? ` (${snippet})` : ''}`;
    })
    .join('\n');
}
