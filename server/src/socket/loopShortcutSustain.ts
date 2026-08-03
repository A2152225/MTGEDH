/**
 * Loop Shortcut self-sustain checks and compressed replay snapshots.
 *
 * A loop is self-sustaining when the looping player's key resources do not
 * decrease across a steady-state iteration (after iter 1 → after iter 2 when
 * probing large batches). Equality is allowed; growth is fine.
 *
 * Mana uses *available* mana: floating pool + untapped tap-for-mana sources
 * (lands, rocks, etc.) via getAvailableMana — not floating pool alone.
 * Spending kickstart float/lands is OK when creature count does not shrink,
 * since sac outlets (e.g. Ashnod's Altar) convert creatures back into mana.
 */
import { getAvailableMana, getTotalManaFromPool } from '../state/modules/mana-check.js';

export const LOOP_SHORTCUT_MAX_ITERATIONS = 50;
export const LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS = 1000;

/** Event types still written while mid-batch event append is suppressed. */
export const LOOP_SHORTCUT_SUPPRESSED_APPEND_ALLOWLIST = new Set([
  'loopShortcutBatchStart',
  'loopShortcutBatchApply',
  'loopShortcutBatchEnd',
]);

export type LoopShortcutResourceSnapshot = {
  life: number;
  creatureCount: number;
  permanentCount: number;
  handCount: number;
  libraryCount: number;
  graveyardCount: number;
  exileCount: number;
  /** Floating pool + untapped mana sources (not Altar sac potential). */
  manaTotal: number;
  /** Floating mana only (debug / messaging). */
  floatingMana: number;
};

const STATE_PATCH_KEYS = [
  'battlefield',
  'zones',
  'manaPool',
  'life',
  'stack',
  'commandZone',
  'exile',
  'turnPlayer',
  'priority',
  'phase',
  'step',
  'turn',
  'turnNumber',
  'morophonChosenType',
  'asEntersChosenCreatureType',
  'chosenCreatureTypeByPermanent',
  'landmarks',
  'dungeons',
  'monarch',
  'initiative',
  'emblems',
  'delayedTriggers',
  'pendingTriggers',
] as const;

function zoneLen(zones: any, playerId: string, zone: string): number {
  const z = zones?.[playerId]?.[zone];
  return Array.isArray(z) ? z.length : Number(z?.length || z?.count || 0) || 0;
}

function floatingManaForPlayer(manaPool: any, playerId: string): number {
  const pool = manaPool?.[playerId];
  if (!pool || typeof pool !== 'object') return 0;
  let total = 0;
  for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless', 'W', 'U', 'B', 'R', 'G', 'C']) {
    total += Math.max(0, Number(pool[key]) || 0);
  }
  if (Array.isArray(pool.restricted)) {
    total += pool.restricted.length;
  }
  return total;
}

function availableManaForPlayer(state: any, playerId: string): number {
  try {
    return getTotalManaFromPool(getAvailableMana(state, playerId as any) as any);
  } catch {
    return floatingManaForPlayer(state?.manaPool, playerId);
  }
}

function isCreaturePermanent(perm: any): boolean {
  const typeLine = String(perm?.type_line || perm?.card?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

export function clampLoopShortcutIterations(raw: unknown): number {
  const n = Math.floor(Number(raw) || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS, n));
}

export function snapshotLoopShortcutResources(state: any, playerId: string): LoopShortcutResourceSnapshot {
  const bf = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const controlled = bf.filter((p: any) => String(p?.controller || '') === String(playerId));
  return {
    life: Math.max(0, Number(state?.life?.[playerId] ?? 0) || 0),
    creatureCount: controlled.filter(isCreaturePermanent).length,
    permanentCount: controlled.length,
    handCount: zoneLen(state?.zones, playerId, 'hand'),
    libraryCount: zoneLen(state?.zones, playerId, 'library'),
    graveyardCount: zoneLen(state?.zones, playerId, 'graveyard'),
    exileCount: zoneLen(state?.zones, playerId, 'exile'),
    manaTotal: availableManaForPlayer(state, playerId),
    floatingMana: floatingManaForPlayer(state?.manaPool, playerId),
  };
}

/**
 * Mana may drop after a kickstart (spent float / tapped lands) when the
 * creature board *grew* — tokens fund Altar-style outlets on later iterations.
 * Spending float with a flat creature count is not treated as sustained.
 */
export function manaResourceOk(
  before: LoopShortcutResourceSnapshot,
  after: LoopShortcutResourceSnapshot,
): boolean {
  if (after.manaTotal >= before.manaTotal) return true;
  return after.creatureCount > before.creatureCount;
}

export function isLoopShortcutSelfSustaining(
  before: LoopShortcutResourceSnapshot,
  after: LoopShortcutResourceSnapshot,
): boolean {
  return (
    after.life >= before.life &&
    after.creatureCount >= before.creatureCount &&
    after.permanentCount >= before.permanentCount &&
    after.handCount >= before.handCount &&
    after.libraryCount >= before.libraryCount &&
    after.graveyardCount >= before.graveyardCount &&
    after.exileCount >= before.exileCount &&
    manaResourceOk(before, after)
  );
}

export function resolveLoopShortcutIterationBudget(args: {
  requested: number;
  selfSustaining: boolean | null;
}): { maxIterations: number; requiresSustain: boolean } {
  const requested = clampLoopShortcutIterations(args.requested);
  const requiresSustain = requested > LOOP_SHORTCUT_MAX_ITERATIONS;
  if (!requiresSustain) {
    return { maxIterations: requested, requiresSustain: false };
  }
  if (args.selfSustaining === true) {
    return { maxIterations: requested, requiresSustain: true };
  }
  // Not yet known, or proven not sustained: soft-cap.
  if (args.selfSustaining === false) {
    return { maxIterations: LOOP_SHORTCUT_MAX_ITERATIONS, requiresSustain: true };
  }
  // Probe pending — allow running the first iteration under the hard cap.
  return { maxIterations: requested, requiresSustain: true };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Capture mutable board state for compressed loop-shortcut replay. */
export function captureLoopShortcutStatePatch(state: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!state || typeof state !== 'object') return patch;
  for (const key of STATE_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(state, key) && (state as any)[key] !== undefined) {
      try {
        patch[key] = deepClone((state as any)[key]);
      } catch {
        // skip non-serializable
      }
    }
  }
  return patch;
}

/** Apply a compressed loop-shortcut patch during event replay. */
export function applyLoopShortcutStatePatch(state: any, patch: Record<string, unknown> | null | undefined): void {
  if (!state || typeof state !== 'object' || !patch || typeof patch !== 'object') return;
  for (const key of STATE_PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    try {
      (state as any)[key] = deepClone((patch as any)[key]);
    } catch {
      // skip
    }
  }
}

export function isLoopShortcutBroadcastSuppressed(gameOrState: any): boolean {
  const state = gameOrState?.state && typeof gameOrState.state === 'object'
    ? gameOrState.state
    : gameOrState;
  return Number(state?._suppressBroadcastCount || 0) > 0;
}

export function beginSuppressEventAppend(game: any): void {
  const state = game?.state as any;
  if (!state || typeof state !== 'object') return;
  state._suppressEventAppendCount = Math.max(0, Number(state._suppressEventAppendCount) || 0) + 1;
}

export function endSuppressEventAppend(game: any): void {
  const state = game?.state as any;
  if (!state || typeof state !== 'object') return;
  const next = Math.max(0, (Number(state._suppressEventAppendCount) || 0) - 1);
  if (next <= 0) delete state._suppressEventAppendCount;
  else state._suppressEventAppendCount = next;
}

export function shouldSuppressEventAppend(gameOrState: any, eventType: string): boolean {
  const state = gameOrState?.state ?? gameOrState;
  if (!state || typeof state !== 'object') return false;
  if (Number(state._suppressEventAppendCount || 0) <= 0) return false;
  if (LOOP_SHORTCUT_SUPPRESSED_APPEND_ALLOWLIST.has(String(eventType || ''))) return false;
  return true;
}
