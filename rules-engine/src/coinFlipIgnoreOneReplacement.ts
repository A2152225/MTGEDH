/**
 * Generic "If you would flip a coin, instead flip two coins and ignore one"
 * replacement (Krark's Thumb family). No card-name routing.
 *
 * Nested copies replace each individual flip (2019 ruling). Dry-run auto-keeps
 * a called side when either coin matches. Interactive play prompts whenever
 * a pair differs so the player chooses which result to ignore.
 *
 * Public entries: countCoinFlipIgnoreOneReplacements,
 *   generateCoinFlipResultWithIgnoreOne, resolveCoinFlipWithIgnoreOne,
 *   COIN_IGNORE_ONE_CHOICE.
 */
import type { CoinSide } from './coinFlip';
import { generateCoinFlipResult } from './coinFlip';

export const COIN_IGNORE_ONE_CHOICE = 'coin_ignore_one';

const IGNORE_ONE_ORACLE =
  /if you would flip a coin,\s*instead flip two coins and ignore one/i;

function normalizeOracle(text: unknown): string {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function readPermanentOracle(permanent: any): string {
  return normalizeOracle(
    permanent?.card?.oracle_text
    || permanent?.card?.oracleText
    || permanent?.oracle_text
    || '',
  );
}

export function countCoinFlipIgnoreOneReplacements(state: unknown, playerId: string): number {
  const pid = String(playerId || '').trim();
  if (!pid) return 0;
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? ((state as { battlefield: unknown[] }).battlefield)
    : [];
  let count = 0;
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const record = perm as { controller?: string; phasedOut?: boolean; card?: unknown };
    if (record.phasedOut === true) continue;
    if (String(record.controller || '').trim() !== pid) continue;
    if (IGNORE_ONE_ORACLE.test(readPermanentOracle(record))) count += 1;
  }
  return count;
}

function pickKeptCoin(a: CoinSide, b: CoinSide, call?: CoinSide): CoinSide {
  if (call && (a === call || b === call)) return call;
  return a;
}

export type CoinIgnoreOneKeep = 'first' | 'second';

export type CoinFlipIgnoreOneResolve =
  | { readonly kind: 'result'; readonly result: CoinSide; readonly rawFlips: readonly CoinSide[] }
  | {
      readonly kind: 'choice_required';
      readonly a: CoinSide;
      readonly b: CoinSide;
      readonly rawFlips: readonly CoinSide[];
      readonly keepChoices: readonly CoinIgnoreOneKeep[];
      readonly playerId: string;
      readonly call?: CoinSide;
    };

type LeafCursor = { index: number };

function nextRawFlip(rawFlips: CoinSide[], cursor: LeafCursor): CoinSide {
  if (cursor.index < rawFlips.length) {
    const existing = rawFlips[cursor.index];
    cursor.index += 1;
    return existing;
  }
  const generated = generateCoinFlipResult();
  rawFlips.push(generated);
  cursor.index += 1;
  return generated;
}

function resolveLayer(
  layers: number,
  rawFlips: CoinSide[],
  cursor: LeafCursor,
  keepChoices: CoinIgnoreOneKeep[],
  keepIndex: { value: number },
  interactive: boolean,
  call?: CoinSide,
): { result: CoinSide } | { pending: { a: CoinSide; b: CoinSide } } {
  if (layers <= 0) {
    return { result: nextRawFlip(rawFlips, cursor) };
  }
  const left = resolveLayer(layers - 1, rawFlips, cursor, keepChoices, keepIndex, interactive, call);
  if ('pending' in left) return left;
  const right = resolveLayer(layers - 1, rawFlips, cursor, keepChoices, keepIndex, interactive, call);
  if ('pending' in right) return right;
  if (left.result === right.result) return { result: left.result };
  const supplied = keepChoices[keepIndex.value];
  if (supplied === 'first' || supplied === 'second') {
    keepIndex.value += 1;
    return { result: supplied === 'second' ? right.result : left.result };
  }
  if (interactive) {
    return { pending: { a: left.result, b: right.result } };
  }
  return { result: pickKeptCoin(left.result, right.result, call) };
}

export function resolveCoinFlipWithIgnoreOne(
  state: unknown,
  playerId: string,
  options?: {
    readonly call?: CoinSide;
    readonly interactive?: boolean;
    readonly keepChoices?: readonly CoinIgnoreOneKeep[];
    readonly rawFlips?: readonly CoinSide[];
  },
): CoinFlipIgnoreOneResolve {
  const layers = countCoinFlipIgnoreOneReplacements(state, playerId);
  const rawFlips = [...(options?.rawFlips || [])];
  const keepChoices = [...(options?.keepChoices || [])];
  const cursor: LeafCursor = { index: 0 };
  const keepIndex = { value: 0 };
  const resolved = resolveLayer(
    layers,
    rawFlips,
    cursor,
    keepChoices,
    keepIndex,
    options?.interactive === true,
    options?.call,
  );
  if ('pending' in resolved) {
    return {
      kind: 'choice_required',
      a: resolved.pending.a,
      b: resolved.pending.b,
      rawFlips,
      keepChoices,
      playerId: String(playerId || '').trim(),
      ...(options?.call ? { call: options.call } : {}),
    };
  }
  return { kind: 'result', result: resolved.result, rawFlips };
}

export function generateCoinFlipResultWithIgnoreOne(
  state: unknown,
  playerId: string,
  options?: { call?: CoinSide },
): CoinSide {
  const resolved = resolveCoinFlipWithIgnoreOne(state, playerId, options);
  if (resolved.kind === 'result') return resolved.result;
  return pickKeptCoin(resolved.a, resolved.b, options?.call);
}
