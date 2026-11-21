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
  'amplifyRevealed',
  'optionalDrawStepSkipTurn',
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

function clonePatchFieldCached(
  field: ReplayPatchField,
  value: unknown,
  byRef: WeakMap<object, unknown>,
  byContent: Map<string, unknown>,
): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;

  const hit = byRef.get(value as object);
  if (hit !== undefined) return hit;

  const contentKey = `${field}:${stableSerialize(value)}`;
  const shared = byContent.get(contentKey);
  if (shared !== undefined) {
    byRef.set(value as object, shared);
    return shared;
  }

  const cloned = clonePatchValue(value);
  byRef.set(value as object, cloned);
  byContent.set(contentKey, cloned);
  return cloned;
}

export function snapshotBattlefieldPermanentReplayPatches(state: any): Map<string, BattlefieldPermanentReplayPatch> {
  const out = new Map<string, BattlefieldPermanentReplayPatch>();
  // Borg / token swarms: share deep clones across identical field values (CPU profile ~20% here).
  const fieldCloneByRef = new WeakMap<object, unknown>();
  const fieldCloneByContent = new Map<string, unknown>();
  const wholePatchByContent = new Map<string, BattlefieldPermanentReplayPatch>();

  for (const perm of state?.battlefield || []) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;

    const presentFields: ReplayPatchField[] = [];
    for (const field of BATTLEFIELD_PERMANENT_REPLAY_PATCH_FIELDS) {
      if (perm[field] !== undefined) presentFields.push(field);
    }

    // Whole-patch reuse when every present field already has a content-cached clone
    // with a matching serialize key (built below on first sight of each unique set).
    const contentParts: string[] = [];
    for (const field of presentFields) {
      contentParts.push(`${field}=${stableSerialize(perm[field])}`);
    }
    const shareKey = contentParts.join('\0');
    const sharedPatch = wholePatchByContent.get(shareKey);
    if (sharedPatch) {
      out.set(permanentId, sharedPatch);
      continue;
    }

    const patch: BattlefieldPermanentReplayPatch = {};
    for (const field of presentFields) {
      patch[field] = clonePatchFieldCached(field, perm[field], fieldCloneByRef, fieldCloneByContent);
    }
    wholePatchByContent.set(shareKey, patch);
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
    // Snapshot sharing makes identical fields reference-equal — skip stringify.
    if (previous === next) continue;
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
  // Identical before/after patch objects (token swarms) share one diff result.
  const diffByBefore = new WeakMap<
    BattlefieldPermanentReplayPatch,
    WeakMap<BattlefieldPermanentReplayPatch, BattlefieldPermanentReplayPatch | null>
  >();

  for (const permanentId of permanentIds) {
    // A permanent that left (or has not entered yet) is a zone change, not a
    // field patch. Diffing it against {} nulls controller and leaves the
    // object on the battlefield, so destroyed creatures stay targetable.
    if (!before.has(permanentId) || !after.has(permanentId)) continue;
    const beforePatch = before.get(permanentId) || {};
    const afterPatch = after.get(permanentId) || {};

    let byAfter = diffByBefore.get(beforePatch);
    if (!byAfter) {
      byAfter = new WeakMap();
      diffByBefore.set(beforePatch, byAfter);
    }
    let patch: BattlefieldPermanentReplayPatch | null | undefined = byAfter.get(afterPatch);
    if (patch === undefined) {
      patch = diffPermanentReplayPatch(beforePatch, afterPatch);
      byAfter.set(afterPatch, patch);
    }
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

