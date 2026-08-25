/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: isAIManaBatteryChargeInvestAction, executeAIActivateAbility.
 *
 * Public entry symbols: isAIManaBatteryChargeInvestAction, executeAIActivateAbility.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { parseReturnToHandCostFromManaAbilityCost } from "../../state/modules/mana-check.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { ensureGame, permanentHasManaBatteryCounterLoop } from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { snapshotAIAbilityActivationState } from "./aiAbilityActivationSnapshot.js";
import type { AIActivatedAbilityResolverCandidate } from "./aiAbilityActivationTypes.js";
import { AI_MANA_ABILITY_PATTERN, AI_REACTION_DELAY_MS } from "./aiConstants.js";
import { executeAILegacyActivateAbility } from "./aiLegacyActivateAbilityHandlers.js";
import { executePassPriority } from "./aiPriorityPassCombatExecutors.js";
import { scheduleAIPriority } from "./aiScheduler.js";

function buildAIActivatedAbilityResolverCandidates(permanent: any): AIActivatedAbilityResolverCandidate[] {
  return getAIHandlerDeps().buildAIActivatedAbilityResolverCandidates(permanent);
}

function didAIAbilityActivationProgress(before: any, after: any): boolean {
  return getAIHandlerDeps().didAIAbilityActivationProgress(before, after);
}

function resolveAIActivatedAbilityId(action: any, permanent: any): string | undefined {
  return getAIHandlerDeps().resolveAIActivatedAbilityId(action, permanent);
}

async function requestAISharedBattlefieldAbilityActivation(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  request: { permanentId: string; abilityId: string; xValue?: unknown; drainQueuedSteps?: boolean },
): Promise<boolean> {
  return getAIHandlerDeps().requestAISharedBattlefieldAbilityActivation(io, gameId, playerId, request);
}

export function isAIManaBatteryChargeInvestAction(permanent: any, action: any): boolean {
  const battery = permanentHasManaBatteryCounterLoop(permanent);
  if (!battery.invests) return false;

  const texts: string[] = [
    String(action?.abilityText || ''),
  ];
  const abilityId = String(action?.abilityId || '').trim();
  if (abilityId) {
    for (const candidate of buildAIActivatedAbilityResolverCandidates(permanent)) {
      if (String(candidate?.id || '') === abilityId || String(candidate?.id || '').endsWith(abilityId)) {
        texts.push(String(candidate?.text || ''), String(candidate?.effect || ''));
      }
    }
  } else {
    for (const candidate of buildAIActivatedAbilityResolverCandidates(permanent)) {
      texts.push(String(candidate?.text || ''), String(candidate?.effect || ''));
    }
  }

  const joined = texts.join('\n').toLowerCase();
  return /\bput\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\S+\s+counters?\s+on\b/i.test(joined);
}

/**
 * Execute AI activated ability activation
 * Handles tapping permanents and putting abilities on the stack
 */
export async function executeAIActivateAbility(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  action: any,
  continueAfterResolution: boolean = true,
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;

  debug(1, '[AI] Activating ability:', {
    gameId,
    playerId,
    cardName: action.cardName,
    permanentId: action.permanentId,
  });

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === String(action?.permanentId || ''));
  if (!permanent) {
    debugWarn(2, '[AI] Permanent not found for ability activation:', action?.permanentId);
    return false;
  }

  const battery = permanentHasManaBatteryCounterLoop(permanent);

  // Return-to-hand mana lines (e.g. Tidal Commons) need an interactive TARGET_SELECTION on the
  // shared activate path, but AI completeStep does not apply that cost/effect. Legacy pays the
  // bounce and adds mana immediately — correct for mana abilities (no stack).
  const activatedAbilityText = String(action?.abilityText || permanent?.card?.oracle_text || '').trim();
  const activatedCostSection = activatedAbilityText.split(':')[0] || '';
  const isReturnToHandManaAbility =
    AI_MANA_ABILITY_PATTERN.test(activatedAbilityText)
    && !/target/i.test(activatedAbilityText)
    && Boolean(parseReturnToHandCostFromManaAbilityCost(activatedCostSection));
  if (isReturnToHandManaAbility && !(battery.invests && battery.paysOut)) {
    const beforeReturn = snapshotAIAbilityActivationState(game, gameId, playerId, String(action?.permanentId || ''));
    await executeAILegacyActivateAbility(io, gameId, playerId, action, continueAfterResolution);
    await Promise.resolve();
    const afterReturn = snapshotAIAbilityActivationState(game, gameId, playerId, String(action?.permanentId || ''));
    const progressedReturn = didAIAbilityActivationProgress(beforeReturn, afterReturn);
    if (progressedReturn && continueAfterResolution) {
      scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
    }
    return progressedReturn;
  }

  const resolvedAbilityId = resolveAIActivatedAbilityId(action, permanent);
  if (resolvedAbilityId) {
    const progressed = await requestAISharedBattlefieldAbilityActivation(io, gameId, playerId, {
      permanentId: String(action.permanentId || ''),
      abilityId: resolvedAbilityId,
      xValue: action?.xValue,
      drainQueuedSteps: !continueAfterResolution,
    });
    if (progressed) {
      if (continueAfterResolution) {
        scheduleAIPriority(io, gameId, playerId, AI_REACTION_DELAY_MS);
      }
      return true;
    }

    // Do NOT fall back to the legacy activator when the shared path already ran.
    // Legacy uses full-card oracle text for "is mana ability?" and can grant free mana
    // (or otherwise progress) after INSUFFICIENT_MANA — e.g. Gemstone Array charge spam.
    debugWarn(1, '[AI] Shared battlefield activation did not progress; not falling back to legacy AI handler', {
      gameId,
      playerId,
      permanentId: action?.permanentId,
      abilityId: resolvedAbilityId,
      cardName: action?.cardName,
    });
    return false;
  }

  // Mana-battery cards must never hit legacy (free mana / unpaid charge loops).
  if (battery.invests && battery.paysOut) {
    debugWarn(1, '[AI] Refusing legacy fallback for mana-battery permanent:', {
      gameId,
      playerId,
      permanentId: action?.permanentId,
      cardName: action?.cardName,
      abilityText: action?.abilityText,
    });
    return false;
  }

  debugWarn(1, '[AI] Could not resolve battlefield ability id for AI action; falling back to legacy AI handler', {
    gameId,
    playerId,
    permanentId: action?.permanentId,
    cardName: action?.cardName,
    abilityText: action?.abilityText,
  });

  const before = snapshotAIAbilityActivationState(game, gameId, playerId, String(action?.permanentId || ''));
  await executeAILegacyActivateAbility(io, gameId, playerId, action, continueAfterResolution);
  await Promise.resolve();
  const after = snapshotAIAbilityActivationState(game, gameId, playerId, String(action?.permanentId || ''));
  return didAIAbilityActivationProgress(before, after);
}
