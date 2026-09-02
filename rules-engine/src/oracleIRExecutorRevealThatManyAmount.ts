// Origin parent: oracleIRExecutorPlayerSurveilLookRevealSteps.ts
// Cluster: Warp World / Glimpse "reveal that many" amount resolution after shuffle.
// Public entries: isThatManyOrMuchRevealAmount, resolveThatManyRevealAmountForPlayer.

import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

function trimId(value: unknown): string {
  return String(value || '').trim();
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Leftover JSON / 903.9a resume may drop `kind` or keep a longer raw than "that many". */
export function isThatManyOrMuchRevealAmount(amount: unknown, stepRaw?: unknown): boolean {
  const qty = amount && typeof amount === 'object' ? (amount as { kind?: unknown; raw?: unknown }) : null;
  const kind = trimId(qty?.kind).toLowerCase();
  const raw = trimId(qty?.raw || stepRaw);
  if (kind === 'number' || kind === 'x' || kind === 'object_stat') return false;
  if (kind === 'reference_amount' && /^that\s+(?:many|much)$/i.test(raw)) return true;
  if (/^that\s+(?:many|much)(?:\s+cards?)?$/i.test(raw)) return true;
  if (/\breveals?\s+that\s+(?:many|much)\s+cards?\b/i.test(raw)) return true;
  return /^that\s+(?:many|much)\b/i.test(raw);
}

export function lookupMovedCountForPlayer(
  counts: Readonly<Record<string, number>> | undefined,
  playerId: string,
): number | undefined {
  if (!counts || typeof counts !== 'object') return undefined;
  const want = trimId(playerId);
  if (!want) return undefined;
  const direct = counts[want];
  if (isFiniteCount(direct)) return Math.max(0, direct);
  const wantLower = want.toLowerCase();
  for (const [key, value] of Object.entries(counts)) {
    if (trimId(key).toLowerCase() !== wantLower) continue;
    if (isFiniteCount(value)) return Math.max(0, value);
  }
  return undefined;
}

export function countsFromMovedCardOwners(
  cards: readonly unknown[] | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(cards)) return out;
  for (const card of cards) {
    const owner = trimId((card as { owner?: unknown } | undefined)?.owner)
      || trimId((card as { ownerId?: unknown } | undefined)?.ownerId);
    if (!owner) continue;
    out[owner] = (out[owner] || 0) + 1;
  }
  return out;
}

function mergeCountMaps(
  ...maps: Array<Readonly<Record<string, number>> | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue;
    for (const [key, value] of Object.entries(map)) {
      const id = trimId(key);
      if (!id || !isFiniteCount(value)) continue;
      out[id] = Math.max(0, value);
    }
  }
  return out;
}

/**
 * Per-player "that many" after Warp World shuffle.
 * When any shuffle count is known, a missing player is 0 (do not abort the whole reveal).
 */
export function resolveThatManyRevealAmountForPlayer(args: {
  readonly playerId: string;
  readonly amount: unknown;
  readonly stepRaw?: unknown;
  readonly ctx?: OracleIRExecutionContext;
  readonly lastMovedCountByPlayer?: Readonly<Record<string, number>>;
}): number | undefined {
  if (!isThatManyOrMuchRevealAmount(args.amount, args.stepRaw)) return undefined;
  const preferred = mergeCountMaps(args.ctx?.lastMovedCountByPlayer, args.lastMovedCountByPlayer);
  const merged = Object.keys(preferred).length > 0
    ? preferred
    : countsFromMovedCardOwners(args.ctx?.lastMovedCards);
  if (Object.keys(merged).length === 0) return undefined;
  return lookupMovedCountForPlayer(merged, args.playerId) ?? 0;
}
