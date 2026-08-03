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
import { millCardsFromLibrary } from '../state/modules/triggerLibraryMillUtils.js';
import { uid } from '../state/utils.js';

export const LOOP_SHORTCUT_MAX_ITERATIONS = 50;
export const LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS = 1000;

const MANA_COLOR_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;
const MANA_COLOR_ALIASES: Record<string, (typeof MANA_COLOR_KEYS)[number]> = {
  white: 'white',
  blue: 'blue',
  black: 'black',
  red: 'red',
  green: 'green',
  colorless: 'colorless',
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

export type LoopShortcutTokenFingerprintEntry = {
  count: number;
  /** Prototype permanent used when cloning tokens (no ETB). */
  prototype: any;
};

/** Full board snapshot used to derive a steady-state per-iteration delta. */
export type LoopShortcutBoardSnapshot = {
  floatingManaByPlayer: Record<string, Record<string, number>>;
  lifeByPlayer: Record<string, number>;
  tokensByFingerprint: Record<string, LoopShortcutTokenFingerprintEntry>;
  libraryCountByPlayer: Record<string, number>;
};

/**
 * Net per-iteration outcome after a sustain probe.
 * Multiply-safe fields are applied once as `× remaining`; mill is fast-replayed.
 */
export type LoopShortcutIterationDelta = {
  floatingManaByPlayer: Record<string, Record<string, number>>;
  lifeByPlayer: Record<string, number>;
  tokensByFingerprint: Record<string, LoopShortcutTokenFingerprintEntry>;
  /** Cards removed from library per player in one steady-state iteration. */
  millsByPlayer: Record<string, number>;
};

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

function normalizeManaColorKey(raw: string): (typeof MANA_COLOR_KEYS)[number] | null {
  return MANA_COLOR_ALIASES[String(raw || '').trim()] || null;
}

function floatingManaBreakdown(manaPool: any, playerId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of MANA_COLOR_KEYS) out[key] = 0;
  const pool = manaPool?.[playerId];
  if (!pool || typeof pool !== 'object') return out;
  for (const [rawKey, rawVal] of Object.entries(pool)) {
    if (rawKey === 'restricted') continue;
    const color = normalizeManaColorKey(rawKey);
    if (!color) continue;
    out[color] = (out[color] || 0) + Math.max(0, Number(rawVal) || 0);
  }
  return out;
}

function libraryCountForPlayer(
  state: any,
  playerId: string,
  libraries?: Map<string, any[]> | null,
): number {
  if (libraries && typeof libraries.get === 'function') {
    const lib = libraries.get(String(playerId));
    if (Array.isArray(lib)) return lib.length;
  }
  const z = state?.zones?.[playerId];
  if (typeof z?.libraryCount === 'number' && Number.isFinite(z.libraryCount)) {
    return Math.max(0, Math.floor(z.libraryCount));
  }
  return zoneLen(state?.zones, playerId, 'library');
}

function tokenPowerToughness(perm: any): { power: string; toughness: string } {
  const power = String(
    perm?.power ?? perm?.basePower ?? perm?.card?.power ?? '',
  ).trim();
  const toughness = String(
    perm?.toughness ?? perm?.baseToughness ?? perm?.card?.toughness ?? '',
  ).trim();
  return { power, toughness };
}

function tokenKeywordsKey(perm: any): string {
  const fromCard = Array.isArray(perm?.card?.keywords) ? perm.card.keywords : [];
  const fromPerm = Array.isArray(perm?.keywords) ? perm.keywords : [];
  const merged = [...fromCard, ...fromPerm]
    .map((k: any) => String(k || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return merged.join(',');
}

export function loopShortcutTokenFingerprint(perm: any): string {
  const controller = String(perm?.controller || '').trim();
  const name = String(perm?.card?.name || perm?.name || '').trim().toLowerCase();
  const typeLine = String(perm?.type_line || perm?.card?.type_line || '').trim().toLowerCase();
  const tapped = perm?.tapped ? '1' : '0';
  const { power, toughness } = tokenPowerToughness(perm);
  const keywords = tokenKeywordsKey(perm);
  return [controller, name, typeLine, tapped, power, toughness, keywords].join('|');
}

function isTokenLikePermanent(perm: any): boolean {
  return Boolean(perm?.isToken || perm?.isGroupedTokens);
}

function tokenInstanceCount(perm: any): number {
  if (perm?.isGroupedTokens) {
    const groupedLen = Array.isArray(perm?.groupedTokenIds) ? perm.groupedTokenIds.length : 0;
    const explicit = Math.floor(Number(perm?.tokenCount) || 0);
    return Math.max(1, explicit || groupedLen || 1);
  }
  return 1;
}

function stripTokenGroupFields(perm: any): any {
  const clone = deepClone(perm);
  delete clone.isGroupedTokens;
  delete clone.tokenCount;
  delete clone.groupedTokenIds;
  clone.isToken = true;
  return clone;
}

/** Snapshot floating mana / life / tokens / library sizes for delta multiply. */
export function snapshotLoopShortcutBoard(
  state: any,
  libraries?: Map<string, any[]> | null,
): LoopShortcutBoardSnapshot {
  const floatingManaByPlayer: Record<string, Record<string, number>> = {};
  const lifeByPlayer: Record<string, number> = {};
  const tokensByFingerprint: Record<string, LoopShortcutTokenFingerprintEntry> = {};
  const libraryCountByPlayer: Record<string, number> = {};

  const players = Array.isArray(state?.players) ? state.players : [];
  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    floatingManaByPlayer[playerId] = floatingManaBreakdown(state?.manaPool, playerId);
    lifeByPlayer[playerId] = Math.max(0, Number(state?.life?.[playerId] ?? 0) || 0);
    libraryCountByPlayer[playerId] = libraryCountForPlayer(state, playerId, libraries);
  }

  // Also include any manaPool / life keys that may not be in players yet.
  for (const playerId of Object.keys(state?.manaPool || {})) {
    const id = String(playerId || '').trim();
    if (!id || floatingManaByPlayer[id]) continue;
    floatingManaByPlayer[id] = floatingManaBreakdown(state?.manaPool, id);
  }
  for (const playerId of Object.keys(state?.life || {})) {
    const id = String(playerId || '').trim();
    if (!id || lifeByPlayer[id] != null) continue;
    lifeByPlayer[id] = Math.max(0, Number(state?.life?.[id] ?? 0) || 0);
  }
  for (const playerId of Object.keys(state?.zones || {})) {
    const id = String(playerId || '').trim();
    if (!id || libraryCountByPlayer[id] != null) continue;
    libraryCountByPlayer[id] = libraryCountForPlayer(state, id, libraries);
  }

  const bf = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of bf) {
    if (!isTokenLikePermanent(perm)) continue;
    const fp = loopShortcutTokenFingerprint(perm);
    if (!fp || fp.startsWith('|')) continue;
    const count = tokenInstanceCount(perm);
    const existing = tokensByFingerprint[fp];
    if (existing) {
      existing.count += count;
    } else {
      tokensByFingerprint[fp] = {
        count,
        prototype: stripTokenGroupFields(perm),
      };
    }
  }

  return {
    floatingManaByPlayer,
    lifeByPlayer,
    tokensByFingerprint,
    libraryCountByPlayer,
  };
}

function allPlayerIdsFromSnapshots(
  before: LoopShortcutBoardSnapshot,
  after: LoopShortcutBoardSnapshot,
): string[] {
  const ids = new Set<string>([
    ...Object.keys(before.floatingManaByPlayer || {}),
    ...Object.keys(after.floatingManaByPlayer || {}),
    ...Object.keys(before.lifeByPlayer || {}),
    ...Object.keys(after.lifeByPlayer || {}),
    ...Object.keys(before.libraryCountByPlayer || {}),
    ...Object.keys(after.libraryCountByPlayer || {}),
  ]);
  return [...ids].filter(Boolean);
}

/** Diff two board snapshots into a per-iteration delta (prefer end-of-iter1 → end-of-iter2). */
export function diffLoopShortcutIterationDelta(
  before: LoopShortcutBoardSnapshot,
  after: LoopShortcutBoardSnapshot,
): LoopShortcutIterationDelta {
  const floatingManaByPlayer: Record<string, Record<string, number>> = {};
  const lifeByPlayer: Record<string, number> = {};
  const millsByPlayer: Record<string, number> = {};
  const tokensByFingerprint: Record<string, LoopShortcutTokenFingerprintEntry> = {};

  for (const playerId of allPlayerIdsFromSnapshots(before, after)) {
    const beforeMana = before.floatingManaByPlayer[playerId] || {};
    const afterMana = after.floatingManaByPlayer[playerId] || {};
    const manaDelta: Record<string, number> = {};
    let hasManaDelta = false;
    for (const color of MANA_COLOR_KEYS) {
      const d = (Number(afterMana[color]) || 0) - (Number(beforeMana[color]) || 0);
      if (d !== 0) {
        manaDelta[color] = d;
        hasManaDelta = true;
      }
    }
    if (hasManaDelta) floatingManaByPlayer[playerId] = manaDelta;

    const lifeDelta =
      (Number(after.lifeByPlayer[playerId]) || 0) - (Number(before.lifeByPlayer[playerId]) || 0);
    if (lifeDelta !== 0) lifeByPlayer[playerId] = lifeDelta;

    const mill =
      (Number(before.libraryCountByPlayer[playerId]) || 0) -
      (Number(after.libraryCountByPlayer[playerId]) || 0);
    if (mill > 0) millsByPlayer[playerId] = mill;
  }

  const fps = new Set([
    ...Object.keys(before.tokensByFingerprint || {}),
    ...Object.keys(after.tokensByFingerprint || {}),
  ]);
  for (const fp of fps) {
    const beforeEntry = before.tokensByFingerprint[fp];
    const afterEntry = after.tokensByFingerprint[fp];
    const deltaCount = (Number(afterEntry?.count) || 0) - (Number(beforeEntry?.count) || 0);
    if (deltaCount === 0) continue;
    const prototype = deltaCount > 0
      ? afterEntry?.prototype || beforeEntry?.prototype
      : beforeEntry?.prototype || afterEntry?.prototype;
    if (!prototype) continue;
    tokensByFingerprint[fp] = { count: deltaCount, prototype };
  }

  return {
    floatingManaByPlayer,
    lifeByPlayer,
    tokensByFingerprint,
    millsByPlayer,
  };
}

function countMatchingTokensOnBattlefield(state: any, fingerprint: string): number {
  const bf = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let total = 0;
  for (const perm of bf) {
    if (!isTokenLikePermanent(perm)) continue;
    if (loopShortcutTokenFingerprint(perm) !== fingerprint) continue;
    total += tokenInstanceCount(perm);
  }
  return total;
}

/**
 * True when multiplying `delta × multiplier` would not require impossible removals
 * (negative tokens / over-draining floating mana below zero is clamped, not fatal —
 * negative token counts without enough board presence abort).
 */
export function canApplyMultipliedSafeDelta(
  state: any,
  delta: LoopShortcutIterationDelta,
  multiplier: number,
): { ok: boolean; reason?: string } {
  const mult = Math.floor(Number(multiplier) || 0);
  if (mult <= 0) return { ok: true };
  if (!delta || typeof delta !== 'object') {
    return { ok: false, reason: 'Missing iteration delta' };
  }

  for (const [fp, entry] of Object.entries(delta.tokensByFingerprint || {})) {
    const perIter = Math.floor(Number(entry?.count) || 0);
    if (perIter >= 0) continue;
    const needRemove = Math.abs(perIter) * mult;
    const available = countMatchingTokensOnBattlefield(state, fp);
    if (available < needRemove) {
      return {
        ok: false,
        reason: `Cannot remove ${needRemove} token(s) for fingerprint (have ${available})`,
      };
    }
  }

  return { ok: true };
}

function ensureManaPool(state: any, playerId: string): any {
  state.manaPool = state.manaPool || {};
  const existing = state.manaPool[playerId];
  if (existing && typeof existing === 'object') return existing;
  const created = {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
    restricted: [],
  };
  state.manaPool[playerId] = created;
  return created;
}

function applyFloatingManaDelta(
  state: any,
  playerId: string,
  colorDeltas: Record<string, number>,
  multiplier: number,
): void {
  const pool = ensureManaPool(state, playerId);
  for (const [rawColor, rawDelta] of Object.entries(colorDeltas || {})) {
    const color = normalizeManaColorKey(rawColor);
    if (!color) continue;
    const delta = (Number(rawDelta) || 0) * multiplier;
    if (delta === 0) continue;
    pool[color] = Math.max(0, (Number(pool[color]) || 0) + delta);
  }
}

function removeMatchingTokenInstances(state: any, fingerprint: string, count: number): number {
  let remaining = Math.max(0, Math.floor(count));
  if (remaining <= 0) return 0;
  const bf = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let removed = 0;

  for (let i = bf.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const perm = bf[i];
    if (!isTokenLikePermanent(perm)) continue;
    if (loopShortcutTokenFingerprint(perm) !== fingerprint) continue;

    if (perm?.isGroupedTokens) {
      const groupCount = tokenInstanceCount(perm);
      if (groupCount <= remaining) {
        bf.splice(i, 1);
        remaining -= groupCount;
        removed += groupCount;
      } else {
        const nextCount = groupCount - remaining;
        perm.tokenCount = nextCount;
        if (Array.isArray(perm.groupedTokenIds)) {
          perm.groupedTokenIds = perm.groupedTokenIds.slice(0, nextCount);
        }
        removed += remaining;
        remaining = 0;
      }
      continue;
    }

    bf.splice(i, 1);
    remaining -= 1;
    removed += 1;
  }

  state.battlefield = bf;
  return removed;
}

function cloneTokenOntoBattlefield(state: any, prototype: any): void {
  if (!prototype || typeof prototype !== 'object') return;
  const clone = deepClone(prototype);
  clone.id = uid('tok');
  clone.isToken = true;
  delete clone.isGroupedTokens;
  delete clone.tokenCount;
  delete clone.groupedTokenIds;
  if (clone.card && typeof clone.card === 'object') {
    clone.card = { ...clone.card, id: uid('card'), zone: 'battlefield' };
  }
  if (!Array.isArray(state.battlefield)) state.battlefield = [];
  state.battlefield.push(clone);
}

/**
 * Apply mana / life / token inventory deltas once at `× multiplier`.
 * Does **not** call createToken (no ETB / Altar / Aura Shards storms).
 */
export function applyMultipliedSafeDelta(
  state: any,
  delta: LoopShortcutIterationDelta,
  multiplier: number,
): void {
  const mult = Math.floor(Number(multiplier) || 0);
  if (mult <= 0 || !state || typeof state !== 'object' || !delta) return;

  for (const [playerId, colorDeltas] of Object.entries(delta.floatingManaByPlayer || {})) {
    applyFloatingManaDelta(state, String(playerId), colorDeltas || {}, mult);
  }

  for (const [playerId, lifeDelta] of Object.entries(delta.lifeByPlayer || {})) {
    const d = (Number(lifeDelta) || 0) * mult;
    if (d === 0) continue;
    state.life = state.life || {};
    const id = String(playerId);
    state.life[id] = Math.max(0, (Number(state.life[id]) || 0) + d);
  }

  for (const [fp, entry] of Object.entries(delta.tokensByFingerprint || {})) {
    const perIter = Math.floor(Number(entry?.count) || 0);
    if (perIter === 0) continue;
    const total = perIter * mult;
    if (total > 0) {
      for (let i = 0; i < total; i += 1) {
        cloneTokenOntoBattlefield(state, entry.prototype);
      }
    } else if (total < 0) {
      removeMatchingTokenInstances(state, fp, Math.abs(total));
    }
  }
}

/** Build a mill-capable context from an InMemoryGame wrapper. */
export function loopShortcutMillContextFromGame(game: any): any {
  if (!game) return null;
  if (game.state && (game.libraries || game.bumpSeq)) {
    return {
      state: game.state,
      libraries: game.libraries,
      bumpSeq: typeof game.bumpSeq === 'function' ? () => game.bumpSeq() : undefined,
      rng: typeof (game as any).rng === 'function' ? (game as any).rng : Math.random,
    };
  }
  return game?.ctx || game;
}

/**
 * Fast-replay mills for remaining iterations via millCardsFromLibrary
 * (Eldrazi / GY-from-library replacements still run).
 */
export function fastReplayLoopShortcutMills(args: {
  game: any;
  millsByPlayer: Record<string, number>;
  remainingIterations: number;
}): { milledTotal: number; calls: number } {
  const remaining = Math.max(0, Math.floor(Number(args.remainingIterations) || 0));
  const millsByPlayer = args.millsByPlayer || {};
  if (remaining <= 0) return { milledTotal: 0, calls: 0 };

  const ctx = loopShortcutMillContextFromGame(args.game);
  const state = args.game?.state ?? ctx?.state;
  if (!state || !ctx) return { milledTotal: 0, calls: 0 };

  let milledTotal = 0;
  let calls = 0;

  for (let iter = 0; iter < remaining; iter += 1) {
    for (const [playerId, perIterRaw] of Object.entries(millsByPlayer)) {
      const perIter = Math.max(0, Math.floor(Number(perIterRaw) || 0));
      if (perIter <= 0) continue;
      const milled = millCardsFromLibrary(state, playerId as any, perIter, ctx);
      milledTotal += milled;
      calls += 1;
    }
  }

  return { milledTotal, calls };
}

/**
 * Attempt multiply-safe apply + fast mill for remaining iterations.
 * Returns false when the caller should fall back to physical looping.
 */
export function tryApplyLoopShortcutDeltaMultiply(args: {
  game: any;
  delta: LoopShortcutIterationDelta;
  remainingIterations: number;
}): { ok: boolean; reason?: string; milledTotal?: number } {
  const remaining = Math.max(0, Math.floor(Number(args.remainingIterations) || 0));
  if (remaining <= 0) return { ok: true, milledTotal: 0 };

  const state = args.game?.state;
  if (!state) return { ok: false, reason: 'Missing game state' };

  const gate = canApplyMultipliedSafeDelta(state, args.delta, remaining);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  try {
    applyMultipliedSafeDelta(state, args.delta, remaining);
    const millResult = fastReplayLoopShortcutMills({
      game: args.game,
      millsByPlayer: args.delta.millsByPlayer || {},
      remainingIterations: remaining,
    });
    return { ok: true, milledTotal: millResult.milledTotal };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message || err || 'Delta multiply failed') };
  }
}
