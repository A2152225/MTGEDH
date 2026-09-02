/**
 * Origin: applyOracleIRStepsOnServer / Thieves' Auction + Warp World rulings.
 * Cluster: hold LTB/ETB until the whole chaos resolution finishes (no priority
 *   mid-spell). Auction 2004: "Triggers from the permanents leaving ... and then
 *   being put back ... are not put on the stack until the entire effect is done."
 * As-enters replacements (shock pay-2-life) still queue during the hold via
 *   queueBattlefieldEntryReplacementPromptsAfterOracleIR — they are not triggers.
 * Public: accumulateAndMaybeFlushChaosResolutionZoneTriggers,
 *   recordDeferredChaosEtbPermanentId, flushChaosResolutionZoneTriggers,
 *   maybeFlushChaosResolutionZoneTriggersIfIdle.
 */
import type { GameContext } from './context.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { processLTBTriggers } from './triggerEmissionFamilyUtils.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { hasPendingWarpWorldOracleIrPrompt } from './oracleIrServerZoneSync-handlers/oracleIrServerWarpWorldChoicePrompts.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import type { BattlefieldTriggerSnapshot } from './oracleIrPostApplyTriggerEmission.js';
import { debug } from '../../utils/debug.js';

let flushingChaosZoneTriggers = false;

function trimId(value: unknown): string {
  return String(value || '').trim();
}

function shouldHoldChaosResolutionTriggers(
  ctx: GameContext,
  result: OracleIRExecutionResult,
): boolean {
  const gaps = result.automationGaps || [];
  if (gaps.some((gap) => String(gap.metadata?.warpWorldChoice || '').trim())) return true;
  if (gaps.some((gap) => String(gap.stepKind || '') === 'repeated_zone_draft')) return true;
  if (String((ctx as any)?.state?.oracleIrPendingResumeStepsJson || '').trim()) return true;
  const gameId = trimId((ctx as any).gameId);
  if (gameId && gameId !== 'unknown' && hasPendingWarpWorldOracleIrPrompt(gameId)) return true;
  if (gameId && gameId !== 'unknown') {
    const queue = ResolutionQueueManager.getQueue(gameId);
    if ((queue?.steps || []).some((step: any) => {
      if (String(step?.type || '') !== String(ResolutionStepType.REPEATED_ZONE_DRAFT)) return false;
      const status = String(step?.status || '');
      return status !== 'completed' && status !== 'cancelled';
    })) {
      return true;
    }
  }
  return false;
}

function readHeld(state: any): { ltb: any[]; enteredIds: string[] } {
  const bag = state?.oracleIrHeldChaosZoneTriggers;
  const ltb = Array.isArray(bag?.ltb) ? [...bag.ltb] : [];
  const enteredIds = Array.isArray(bag?.enteredIds)
    ? bag.enteredIds.map((id: unknown) => trimId(id)).filter(Boolean)
    : [];
  return { ltb, enteredIds };
}

function writeHeld(state: any, ltb: any[], enteredIds: string[]): void {
  state.oracleIrHeldChaosZoneTriggers = { ltb, enteredIds: [...new Set(enteredIds)] };
}

function clearHeld(state: any): void {
  delete state.oracleIrHeldChaosZoneTriggers;
}

export function recordDeferredChaosEtbPermanentId(state: any, permanentId: string): void {
  const id = trimId(permanentId);
  if (!id || !state) return;
  const held = readHeld(state);
  if (!held.enteredIds.includes(id)) held.enteredIds.push(id);
  writeHeld(state, held.ltb, held.enteredIds);
}

export function flushChaosResolutionZoneTriggers(ctx: GameContext): void {
  if ((ctx as any)?.isReplaying) return;
  const state = (ctx as any).state;
  if (!state) return;
  if (flushingChaosZoneTriggers) return;
  flushingChaosZoneTriggers = true;
  const held = readHeld(state);
  clearHeld(state);
  debug(
    2,
    `[oracleIR] Chaos zone trigger flush: ltb=${held.ltb.length} etb=${held.enteredIds.length}`,
  );

  try {
    const ltbDetectCache = new Map<string, any[]>();
    const etbTriggerCache = new Map<string, any[]>();

    for (const left of held.ltb) {
      try {
        processLTBTriggers(ctx, left, { cause: 'exile', ltbDetectCache });
      } catch {
        // Defensive: the permanent already left.
      }
    }

    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    for (const id of held.enteredIds) {
      const permanent = battlefield.find((perm: any) => trimId(perm?.id) === id);
      if (!permanent || permanent?.isToken === true) continue;
      const controller = trimId(permanent?.controller);
      if (!controller) continue;
      try {
        triggerETBEffectsForPermanent(ctx, permanent, controller as any, true, { etbTriggerCache });
      } catch {
        // Defensive: the permanent already entered.
      }
    }
  } finally {
    flushingChaosZoneTriggers = false;
  }
}

function accumulateAndMaybeFlushChaosResolutionZoneTriggers(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  before: BattlefieldTriggerSnapshot,
  options?: { readonly skipLiveEtb: boolean },
): { readonly held: boolean } {
  const heldBefore = readHeld(state);
  const ltb = [...heldBefore.ltb];
  const enteredIds = [...heldBefore.enteredIds];

  const stillOnBattlefield = new Set(
    (Array.isArray(state?.battlefield) ? state.battlefield : [])
      .map((perm: any) => trimId(perm?.id))
      .filter(Boolean),
  );
  for (const [id, snap] of before.permanents.entries()) {
    if (stillOnBattlefield.has(id)) continue;
    ltb.push({
      id,
      controller: snap.controller,
      owner: snap.controller,
      isToken: snap.isToken === true,
      card: snap.card,
      type_line: snap.type_line,
    });
  }
  for (const perm of (Array.isArray(state?.battlefield) ? state.battlefield : [])) {
    const id = trimId(perm?.id);
    if (!id || before.permanents.has(id)) continue;
    enteredIds.push(id);
  }

  writeHeld(state, ltb, enteredIds);
  const holding = shouldHoldChaosResolutionTriggers(ctx, result);
  if (!holding && !options?.skipLiveEtb) {
    flushChaosResolutionZoneTriggers(ctx);
    return { held: false };
  }
  return { held: true };
}

export function maybeFlushChaosResolutionZoneTriggersIfIdle(ctx: GameContext): void {
  const state = (ctx as any)?.state;
  if (!state?.oracleIrHeldChaosZoneTriggers) return;
  if (shouldHoldChaosResolutionTriggers(ctx, { automationGaps: [] } as OracleIRExecutionResult)) return;
  flushChaosResolutionZoneTriggers(ctx);
}

export function prepareChaosResolutionZoneTriggersAfterOracleIR(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  before: BattlefieldTriggerSnapshot,
): { readonly skipLiveEtb: boolean } {
  const alreadyHolding = Boolean(state?.oracleIrHeldChaosZoneTriggers);
  const holdingNow = shouldHoldChaosResolutionTriggers(ctx, result);
  if (!holdingNow && !alreadyHolding) {
    return { skipLiveEtb: false };
  }
  const outcome = accumulateAndMaybeFlushChaosResolutionZoneTriggers(ctx, state, result, before, {
    skipLiveEtb: holdingNow,
  });
  return { skipLiveEtb: outcome.held || alreadyHolding };
}
