/**
 * socket/resolution-handlers/aiTargetSelectionStepResponses.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep).
 * Cluster moved: the contiguous run of AI auto-answers for prompts that pick permanents on the
 * battlefield - FIGHT_TARGET (first legal creature that passes the step's controller/exclude-source
 * filter), TAP_UNTAP_TARGET (first N permanents matching the type / power / toughness / tap-status
 * filter), TARGET_SELECTION (delegates to chooseAITargetSelectionsForChoiceStep over the
 * "different target" filtered list), MUTATE_TARGET_SELECTION (stamps the pending cast before
 * completing, as the parent did), COUNTER_MOVEMENT and COUNTER_TARGET.
 * Public entry symbol: buildAiTargetSelectionStepResponse.
 *
 * The six `case` bodies became one dispatcher because they were contiguous in the parent switch and
 * each ended in a plain `break`, so the call site is a single fallthrough group of `case` labels
 * assigning `response = buildAiTargetSelectionStepResponse(game, gameId, step, helpers);`. The early
 * `break`s for "no legal target" are now early `return`s of the identical cancelled responses.
 * Heuristics and debug strings are unchanged. Returns null only for a step type outside this group.
 *
 * `getFilteredValidTargetsForStep` stays a private function of the parent, so it is passed in as a
 * helper rather than imported. Reads `game` but never `io` or the queue. Must not import
 * resolution.ts.
 */

import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
  type TargetSelectionStep,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { chooseAITargetSelectionsForChoiceStep } from "../ai.js";
import { canPermanentBeTargetedByPlayer } from "../../rules-engine/targeting";
import { getEffectivePower, getEffectiveToughness } from "../util.js";

export interface AiTargetSelectionStepHelpers {
  getFilteredValidTargetsForStep: (gameId: string, step: TargetSelectionStep) => readonly any[];
}

/** AI answer for the battlefield target prompts listed in the module header. */
export function buildAiTargetSelectionStepResponse(
  game: any,
  gameId: string,
  step: ResolutionStep,
  helpers: AiTargetSelectionStepHelpers,
): ResolutionStepResponse | null {
  switch (step.type) {
    case ResolutionStepType.FIGHT_TARGET: {
      const stepData = step as any;
      const battlefield = game.state?.battlefield || [];
      const sourceId = String(step.sourceId || stepData.sourceId || '');
      const sourceCreature = (Array.isArray(battlefield) ? battlefield : []).find((perm: any) => perm?.id === sourceId);
      const targetFilter = stepData.targetFilter || {};
      const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
      const excludeSource = targetFilter.excludeSource !== false;

      const candidates = (Array.isArray(battlefield) ? battlefield : []).filter((perm: any) => {
        if (!perm || typeof perm.id !== 'string') return false;
        if (!sourceCreature) return false;
        if (excludeSource && perm.id === sourceId) return false;

        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) return false;

        if (controllerFilter === 'you' && perm.controller !== step.playerId) return false;
        if (controllerFilter === 'opponent' && perm.controller === step.playerId) return false;
        if (!canPermanentBeTargetedByPlayer(perm, game.state as any, step.playerId as any)) return false;

        return true;
      });

      if (candidates.length === 0) {
        debugWarn(1, `[Resolution] AI FIGHT_TARGET: no valid targets for source ${sourceId}`);
        return {
          stepId: step.id,
          playerId: step.playerId,
          selections: [],
          cancelled: true,
          timestamp: Date.now(),
        };
      }

      const chosen = candidates[0];
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [String(chosen.id)],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI chose fight target: ${String(chosen.card?.name || chosen.id)}`);
      return response;
    }

    case ResolutionStepType.TAP_UNTAP_TARGET: {
      const stepData = step as any;
      const battlefield = game.state?.battlefield || [];
      const sourceId = String(step.sourceId || stepData.sourceId || '');
      const targetCount = Math.max(1, Number(stepData.targetCount || 1));
      const targetFilter = stepData.targetFilter || {};
      const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
      const tapStatus: 'tapped' | 'untapped' | 'any' = targetFilter.tapStatus || 'any';
      const excludeSource = targetFilter.excludeSource === true;
      const requireAllTypes = targetFilter.requireAllTypes === true;
      const minPower = targetFilter.minPower !== undefined ? Number(targetFilter.minPower) : undefined;
      const maxPower = targetFilter.maxPower !== undefined ? Number(targetFilter.maxPower) : undefined;
      const minToughness = targetFilter.minToughness !== undefined ? Number(targetFilter.minToughness) : undefined;
      const maxToughness = targetFilter.maxToughness !== undefined ? Number(targetFilter.maxToughness) : undefined;

      const candidates = (Array.isArray(battlefield) ? battlefield : []).filter((perm: any) => {
        if (!perm || typeof perm.id !== 'string') return false;
        if (excludeSource && perm.id === sourceId) return false;

        // Type filter (if present)
        const types = Array.isArray(targetFilter.types) ? targetFilter.types : [];
        if (types.length > 0) {
          const typeLine = String(perm.card?.type_line || '').toLowerCase();
          if (requireAllTypes) {
            const matchesAll = types.every((t: any) => typeLine.includes(String(t).toLowerCase()));
            if (!matchesAll) return false;
          } else {
            const matchesAny = types.some((t: any) => typeLine.includes(String(t).toLowerCase()));
            if (!matchesAny) return false;
          }
        }

        if (minPower !== undefined || maxPower !== undefined) {
          const pwr = getEffectivePower(perm);
          if (minPower !== undefined && pwr < minPower) return false;
          if (maxPower !== undefined && pwr > maxPower) return false;
        }
        if (minToughness !== undefined || maxToughness !== undefined) {
          const tgh = getEffectiveToughness(perm);
          if (minToughness !== undefined && tgh < minToughness) return false;
          if (maxToughness !== undefined && tgh > maxToughness) return false;
        }

        if (controllerFilter === 'you' && perm.controller !== step.playerId) return false;
        if (controllerFilter === 'opponent' && perm.controller === step.playerId) return false;

        if (tapStatus === 'tapped' && !perm.tapped) return false;
        if (tapStatus === 'untapped' && perm.tapped) return false;

        return true;
      });

      if (candidates.length < targetCount) {
        debugWarn(1, `[Resolution] AI TAP_UNTAP_TARGET: not enough valid targets (${candidates.length} < ${targetCount})`);
        return {
          stepId: step.id,
          playerId: step.playerId,
          selections: { targetIds: [], action: 'tap' },
          cancelled: true,
          timestamp: Date.now(),
        };
      }

      const chosenIds = candidates.slice(0, targetCount).map((p: any) => String(p.id));
      const chosenAction: 'tap' | 'untap' = stepData.action === 'untap' ? 'untap' : 'tap';
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: { targetIds: chosenIds, action: chosenAction },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI TAP_UNTAP_TARGET: chose ${chosenIds.length} target(s)`);
      return response;
    }

    case ResolutionStepType.TARGET_SELECTION: {
      const targetStep = step as TargetSelectionStep;
      const filteredValidTargets = helpers.getFilteredValidTargetsForStep(gameId, targetStep);
      const selections = chooseAITargetSelectionsForChoiceStep(game, step.playerId, {
        ...targetStep,
        validTargets: filteredValidTargets,
      });

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI TARGET_SELECTION: chose ${selections.length} target(s)`);
      return response;
    }

    case ResolutionStepType.MUTATE_TARGET_SELECTION: {
      const stepData = step as any;
      const validTargets: any[] = Array.isArray(stepData.validTargets) ? stepData.validTargets : [];
      const pendingCast = (game.state as any)?.pendingSpellCasts?.[String(stepData.effectId || '').trim()];
      const targetPermanentId = String(
        validTargets[0]?.id || pendingCast?.validTargetIds?.[0] || '',
      ).trim();

      // Stamp before completeStep. applyResolutionStepSideEffects can lose the
      // race with a leftover AI handler that already completed the step.
      if (pendingCast && targetPermanentId) {
        pendingCast.targets = [targetPermanentId];
        pendingCast.mutateTarget = targetPermanentId;
        pendingCast.mutateOnTop = true;
        pendingCast.forcedAlternateCostId = 'mutate';
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: { targetPermanentId, onTop: true },
        cancelled: !targetPermanentId,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI MUTATE_TARGET_SELECTION: chose ${targetPermanentId || 'no target'}`);
      return response;
    }

    case ResolutionStepType.COUNTER_MOVEMENT: {
      const stepData = step as any;
      const battlefield = game.state?.battlefield || [];
      const sourceFilter = stepData.sourceFilter || {};
      const targetFilter = stepData.targetFilter || {};

      const validSources = (Array.isArray(battlefield) ? battlefield : []).filter((perm: any) => {
        if (!perm || typeof perm.id !== 'string') return false;
        if (sourceFilter.controller === 'you' && perm.controller !== step.playerId) return false;
        const counters = (perm as any).counters || {};
        return Object.keys(counters).some((k) => Number(counters[k] || 0) > 0);
      });

      if (validSources.length === 0) {
        debugWarn(1, `[Resolution] AI COUNTER_MOVEMENT: no valid source permanents with counters`);
        return {
          stepId: step.id,
          playerId: step.playerId,
          selections: { sourcePermanentId: '', targetPermanentId: '', counterType: '' },
          cancelled: true,
          timestamp: Date.now(),
        };
      }

      const chosenSource = validSources[0];
      const sourceCounters = (chosenSource as any).counters || {};
      const counterType = Object.keys(sourceCounters).find((k) => Number(sourceCounters[k] || 0) > 0) || '';

      const validTargets = (Array.isArray(battlefield) ? battlefield : []).filter((perm: any) => {
        if (!perm || typeof perm.id !== 'string') return false;
        if (targetFilter.controller === 'you' && perm.controller !== step.playerId) return false;
        if (targetFilter.excludeSource && perm.id === chosenSource.id) return false;
        return true;
      });

      if (!counterType || validTargets.length === 0) {
        debugWarn(1, `[Resolution] AI COUNTER_MOVEMENT: no valid target or counterType`);
        return {
          stepId: step.id,
          playerId: step.playerId,
          selections: { sourcePermanentId: '', targetPermanentId: '', counterType: '' },
          cancelled: true,
          timestamp: Date.now(),
        };
      }

      const chosenTarget = validTargets[0];
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          sourcePermanentId: String(chosenSource.id),
          targetPermanentId: String(chosenTarget.id),
          counterType: String(counterType),
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI COUNTER_MOVEMENT: moved ${counterType} counter from ${String(chosenSource.card?.name || chosenSource.id)} to ${String(chosenTarget.card?.name || chosenTarget.id)}`);
      return response;
    }

    case ResolutionStepType.COUNTER_TARGET: {
      const stepData = step as any;
      const validTargets: any[] = Array.isArray(stepData.validTargets) ? stepData.validTargets : [];
      if (validTargets.length === 0) {
        debugWarn(1, `[Resolution] AI COUNTER_TARGET: no valid targets`);
        return {
          stepId: step.id,
          playerId: step.playerId,
          selections: [],
          cancelled: true,
          timestamp: Date.now(),
        };
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [String(validTargets[0].id)],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI COUNTER_TARGET: chose ${String(validTargets[0].label || validTargets[0].id)}`);
      return response;
    }

    default:
      return null;
  }
}
