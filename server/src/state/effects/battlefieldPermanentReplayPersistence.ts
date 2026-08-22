import type { OracleIrReplayMutationBridge } from './effectProgramReplayMutationPersistence.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';

/** Fields captured for undo/replay when Oracle IR mutates existing permanents. */
export const BATTLEFIELD_PERMANENT_REPLAY_PATCH_FIELDS = [
  'controller',
  'isSuspected',
  'tapped',
  'exerted',
  'phasedOut',
  'phasedOutBy',
  'phasedOutControllerId',
  'temporaryEffects',
  'grantedAbilities',
  'temporaryAbilities',
  'untilEndOfTurn',
  'temporaryPTMods',
  'modifiers',
  'tempPowerBonus',
  'tempToughnessBonus',
  'temporaryPowerBoost',
  'temporaryToughnessBoost',
  'tempBonusExpires',
  'cantAttackPlayers',
  'summoningSickness',
  'mustAttackEachCombat',
  'cantAttackOwner',
  'goaded',
] as const;

/** Default fields for Critical undo/replay gap #2 (temp P/T / until-EOT abilities). */
export const TEMPORARY_PERMANENT_MOD_REPLAY_FIELDS = [
  'temporaryPTMods',
  'temporaryAbilities',
  'grantedAbilities',
  'temporaryEffects',
  'untilEndOfTurn',
  'modifiers',
  'tempPowerBonus',
  'tempToughnessBonus',
  'temporaryPowerBoost',
  'temporaryToughnessBoost',
  'tempBonusExpires',
  'summoningSickness',
] as const;

type ReplayPatchField = (typeof BATTLEFIELD_PERMANENT_REPLAY_PATCH_FIELDS)[number];
export type BattlefieldPermanentReplayPatch = Partial<Record<ReplayPatchField, unknown>>;

function clonePatchValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => clonePatchValue(entry));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, clonePatchValue(entry)]),
    );
  }
  return value;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function snapshotBattlefieldPermanentReplayPatches(state: any): Map<string, BattlefieldPermanentReplayPatch> {
  const out = new Map<string, BattlefieldPermanentReplayPatch>();
  for (const perm of state?.battlefield || []) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;

    const patch: BattlefieldPermanentReplayPatch = {};
    for (const field of BATTLEFIELD_PERMANENT_REPLAY_PATCH_FIELDS) {
      if (perm[field] !== undefined) {
        patch[field] = clonePatchValue(perm[field]);
      }
    }
    out.set(permanentId, patch);
  }
  return out;
}

function diffPermanentReplayPatch(
  before: BattlefieldPermanentReplayPatch,
  after: BattlefieldPermanentReplayPatch,
): BattlefieldPermanentReplayPatch | null {
  const patch: BattlefieldPermanentReplayPatch = {};
  const keys = new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ]) as Set<ReplayPatchField>;

  for (const key of keys) {
    const previous = before[key];
    const next = after[key];
    if (stableSerialize(previous) !== stableSerialize(next)) {
      patch[key] = next === undefined ? null : clonePatchValue(next);
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function diffBattlefieldPermanentReplayPatches(
  before: Map<string, BattlefieldPermanentReplayPatch>,
  after: Map<string, BattlefieldPermanentReplayPatch>,
): Array<{ permanentId: string; patch: BattlefieldPermanentReplayPatch }> {
  const changes: Array<{ permanentId: string; patch: BattlefieldPermanentReplayPatch }> = [];
  const permanentIds = new Set([...before.keys(), ...after.keys()]);

  for (const permanentId of permanentIds) {
    const patch = diffPermanentReplayPatch(before.get(permanentId) || {}, after.get(permanentId) || {});
    if (patch) {
      changes.push({ permanentId, patch });
    }
  }

  return changes;
}

export function applyBattlefieldPermanentReplayPatch(permanent: any, patch: BattlefieldPermanentReplayPatch): void {
  if (!permanent || !patch || typeof patch !== 'object') return;

  for (const [field, value] of Object.entries(patch)) {
    if (value === null) {
      delete permanent[field];
      continue;
    }
    permanent[field] = clonePatchValue(value);
  }

  delete permanent.effectivePower;
  delete permanent.effectiveToughness;
}

function buildReplayMutationPayload(bridge?: OracleIrReplayMutationBridge): Record<string, unknown> {
  if (!bridge) return {};
  if (bridge.effectProgramMutation) {
    return {
      ...(bridge.sourceId ? { effectProgramSourceId: bridge.sourceId } : {}),
      ...(bridge.sourceName ? { effectProgramSourceName: bridge.sourceName } : {}),
      effectProgramMutation: true,
    };
  }
  return {
    ...(bridge.sourceId ? { oracleIrSourceId: bridge.sourceId } : {}),
    ...(bridge.sourceName ? { oracleIrSourceName: bridge.sourceName } : {}),
    oracleIrReplayMutation: true,
  };
}

/** Persist non-counter, non-goad battlefield permanent mutations for undo/replay. */
export function persistBattlefieldPermanentPatchesFromOracleIR(
  ctx: GameContext,
  before: Map<string, BattlefieldPermanentReplayPatch>,
  state: any,
  bridge?: OracleIrReplayMutationBridge,
): void {
  if ((ctx as any).isReplaying) return;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  const after = snapshotBattlefieldPermanentReplayPatches(state);
  const changes = diffBattlefieldPermanentReplayPatches(before, after);
  if (changes.length === 0) return;

  const mutationPayload = buildReplayMutationPayload(bridge);

  for (const { permanentId, patch } of changes) {
    try {
      appendEvent(
        gameId,
        Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
        'battlefieldPermanentPatch',
        {
          permanentId,
          patch,
          ...mutationPayload,
        },
      );
      if (typeof (ctx as any).bumpSeq === 'function') {
        (ctx as any).bumpSeq();
      }
    } catch (err) {
      debugWarn(1, `[OracleIR] appendEvent(battlefieldPermanentPatch) failed for ${permanentId}:`, err);
    }
  }
}

type PersistCtxLike = {
  gameId?: unknown;
  seq?: unknown;
  isReplaying?: unknown;
  skipEventPersistence?: unknown;
  bumpSeq?: unknown;
  state?: unknown;
};

function resolvePersistGameId(ctx: PersistCtxLike): string {
  return String(ctx?.gameId || "").trim();
}

function resolvePersistSeq(ctx: PersistCtxLike): number {
  const seq = (ctx as any)?.seq;
  if (seq && typeof seq === "object" && seq.value != null) {
    return Number(seq.value) || 0;
  }
  return Number(seq ?? (ctx as any)?.state?.seq ?? 0) || 0;
}

function shouldSkipBattlefieldPermanentPatchPersistence(ctx: PersistCtxLike): boolean {
  return Boolean((ctx as any)?.isReplaying) || Boolean((ctx as any)?.skipEventPersistence);
}

/**
 * Persist selected battlefield permanent fields after a live silent mutation
 * (temporary P/T, temporary abilities, granted abilities, etc.).
 *
 * Live callers should mutate first, then call this. Replay restores via
 * applyEvent(battlefieldPermanentPatch); do not also re-run the silent push
 * during resolveTopOfStack replay (that path only pops).
 */
export function persistBattlefieldPermanentPatchAfterMutation(
  ctx: PersistCtxLike,
  permanent: any,
  options?: {
    fields?: readonly ReplayPatchField[];
    sourceId?: string;
    sourceName?: string;
  },
): boolean {
  if (shouldSkipBattlefieldPermanentPatchPersistence(ctx)) return false;

  const permanentId = String(permanent?.id || '').trim();
  if (!permanentId) return false;

  const gameId = resolvePersistGameId(ctx);
  if (!gameId || gameId === 'unknown') return false;

  const fields = (options?.fields && options.fields.length > 0)
    ? options.fields
    : (TEMPORARY_PERMANENT_MOD_REPLAY_FIELDS as readonly ReplayPatchField[]);

  // Only persist fields that currently exist so we do not null unrelated keys.
  const patch: BattlefieldPermanentReplayPatch = {};
  for (const field of fields) {
    if (permanent[field] !== undefined) {
      patch[field] = clonePatchValue(permanent[field]);
    }
  }
  if (Object.keys(patch).length === 0) return false;

  try {
    appendEvent(
      gameId,
      resolvePersistSeq(ctx),
      'battlefieldPermanentPatch',
      {
        permanentId,
        patch,
        temporaryPermanentModMutation: true,
        ...(options?.sourceId ? { sourceId: options.sourceId } : {}),
        ...(options?.sourceName ? { sourceName: options.sourceName } : {}),
      },
    );
    if (typeof (ctx as any).bumpSeq === 'function') {
      (ctx as any).bumpSeq();
    }
    return true;
  } catch (err) {
    debugWarn(1, `[temp-mod] appendEvent(battlefieldPermanentPatch) failed for ${permanentId}:`, err);
    return false;
  }
}

