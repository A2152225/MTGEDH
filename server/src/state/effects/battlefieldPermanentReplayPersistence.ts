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
