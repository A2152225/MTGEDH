// server/src/state/modules/apply-event-handlers/applyEventTriggerQueueEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Pushing triggered abilities, trigger ordering, delayed triggers and trigger shortcut preferences.
// Public entry: applyTriggerQueueEvents(ctx, e) -> true when it handled the event.
//
// Handles: setHouseRules, targetSelectionConfirm, pushTriggeredAbility, queueTriggerOrderStep, scheduleDelayedGraveyardReturn, scheduleDelayedDrawAtNextUpkeep, resolveTriggeredAbility, resolutionStepTimeoutRecovery, triggerOrderResponse, setTriggerShortcut, mayAutoPreferenceSet, setAutoYesOptional
import type { GameContext } from "../../context";
import type { PlayerID, GameEvent } from "../../types";
import { pushTriggerDoublerCopies } from "../triggers/combat.js";
import { clearReplayQueuedStepById } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { replayEnsureInterveningIfSubjectOnBattlefield } from "../replay-prompt-cleanup.js";
import { applyTriggerOrderToStack } from "../../resolution/handlers/triggerOrder.js";

export function applyTriggerQueueEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "setHouseRules": {
        // Set house rules for the game
        const rules = (e as any).rules ?? (e as any).houseRules;
        try {
          if (rules && typeof rules === 'object') {
            (ctx.state as any).houseRules = { ...(ctx.state as any).houseRules, ...rules };
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(setHouseRules): failed", err);
        }
        break;
      }

      case "targetSelectionConfirm": {
        // Target selection confirmed for a spell/ability
        // The actual targeting logic is handled by the spell resolution
        ctx.bumpSeq();
        break;
      }

      case "pushTriggeredAbility": {
        // Push a triggered ability onto the stack
        // This allows triggers to be replayed correctly
        const triggerId = (e as any).triggerId;
        const sourceId = (e as any).sourceId;
        const sourceName = (e as any).sourceName;
        const controllerId = (e as any).controllerId;
        const description = (e as any).description;
        const triggerType = (e as any).triggerType;
        const effect = (e as any).effect;
        const mandatory = (e as any).mandatory;
        const value = (e as any).value;
        const permanentId = (e as any).permanentId;
        const requiresChoice = (e as any).requiresChoice;
        const requiresTarget = (e as any).requiresTarget;
        const targetType = (e as any).targetType;
        const targetConstraint = (e as any).targetConstraint;
        const needsTargetSelection = (e as any).needsTargetSelection;
        const targetZone = (e as any).targetZone;
        const targetDestination = (e as any).targetDestination;
        const targetGraveyardScope = (e as any).targetGraveyardScope;
        const destinationUsesSelectedCardOwner = (e as any).destinationUsesSelectedCardOwner;
        const battlefieldControllerMode = (e as any).battlefieldControllerMode;
        const targetAction = (e as any).targetAction;
        const targetFilterTypes = (e as any).targetFilterTypes;
        const targetFilterRequiredTypeWords = (e as any).targetFilterRequiredTypeWords;
        const targetFilterExcludeTypes = (e as any).targetFilterExcludeTypes;
        const targetFilterPermanentOnly = (e as any).targetFilterPermanentOnly;
        const targetFilterExactManaValue = (e as any).targetFilterExactManaValue;
        const targetFilterMinManaValue = (e as any).targetFilterMinManaValue;
        const targetFilterMaxManaValue = (e as any).targetFilterMaxManaValue;
        const targetTotalPowerLimit = (e as any).targetTotalPowerLimit;
        const targetCastWithoutPayingManaCost = (e as any).targetCastWithoutPayingManaCost;
        const targetCastIsOptional = (e as any).targetCastIsOptional;
        const minTargets = (e as any).minTargets;
        const maxTargets = (e as any).maxTargets;
        const preselectedTargetsPersisted = (e as any).preselectedTargetsPersisted;
        const boundGraveyardCardId = (e as any).boundGraveyardCardId;
        const boundGraveyardOwnerId = (e as any).boundGraveyardOwnerId;
        const delayedReturnAt = (e as any).delayedReturnAt;
        const battlefieldTapped = (e as any).battlefieldTapped;
        const battlefieldCounters = (e as any).battlefieldCounters;
        const battlefieldFaceDown = (e as any).battlefieldFaceDown;
        const battlefieldTurnFaceUp = (e as any).battlefieldTurnFaceUp;
        const battlefieldSuspected = (e as any).battlefieldSuspected;
        const battlefieldSetTypeLine = (e as any).battlefieldSetTypeLine;
        const battlefieldSetOracleText = (e as any).battlefieldSetOracleText;
        const battlefieldLoseAllOtherTypes = (e as any).battlefieldLoseAllOtherTypes;
        const battlefieldGrantedTypes = (e as any).battlefieldGrantedTypes;
        const isModal = (e as any).isModal;
        const modalOptions = (e as any).modalOptions;
        const targetPlayer = (e as any).targetPlayer;
        const defendingPlayer = (e as any).defendingPlayer;
        const triggeringPlayer = (e as any).triggeringPlayer;
        const damagedPlayerId = (e as any).damagedPlayerId;
        const attackingPlayerId = (e as any).attackingPlayerId;
        const damageAmount = (e as any).damageAmount;
        const damageSourcePermanentIds = (e as any).damageSourcePermanentIds;
        const damageIncludedWarriorSource = (e as any).damageIncludedWarriorSource;
        const activatedAbilityIsManaAbility = (e as any).activatedAbilityIsManaAbility;
        const triggeringStackItemId = (e as any).triggeringStackItemId;
        const triggeringSpellCastSourceZone = (e as any).triggeringSpellCastSourceZone;
        const triggeringSpell = (e as any).triggeringSpell;
        const triggeringPermanentId = (e as any).triggeringPermanentId;
        const interveningIfSubjectPermanentId = (e as any).interveningIfSubjectPermanentId;
        const interveningIfSubjectSnapshot = (e as any).interveningIfSubjectSnapshot;
        const effectData = (e as any).effectData;
        const initiativeVentureTrigger = (e as any).initiativeVentureTrigger;
        const reboundCardId = (e as any).reboundCardId;
        const paradigmCardId = (e as any).paradigmCardId;
        const targets = Array.isArray((e as any).targets)
          ? (e as any).targets.map((entry: any) => String(entry || '')).filter(Boolean)
          : undefined;
        const card = (e as any).card;
        const sourcePermanentSnapshot = (e as any).sourcePermanentSnapshot;
        const dyingCreature = (e as any).dyingCreature;
        const sacrificedPermanent = (e as any).sacrificedPermanent;
        const lastSacrificedPermanents = Array.isArray((e as any).lastSacrificedPermanents)
          ? (e as any).lastSacrificedPermanents.map((entry: any) => ({ ...entry }))
          : undefined;
        const discardedCard = (e as any).discardedCard;
        const milledCard = (e as any).milledCard;
        
        try {
          // Check if this trigger is already on the stack (idempotency for replay)
          const existingTrigger = (ctx.state.stack || []).find((s: any) => s.id === triggerId);
          if (existingTrigger) {
            debug(1, `applyEvent(pushTriggeredAbility): trigger ${triggerId} already on stack, skipping (replay idempotency)`);
            break;
          }

          // Legacy inverted logs pushed ETBs before resolveTopOfStack; ensure the
          // subject permanent is on the battlefield before restoring the trigger.
          if ((ctx as any).isReplaying) {
            replayEnsureInterveningIfSubjectOnBattlefield(ctx as any, e as any);
          }
          
          ctx.state.stack = ctx.state.stack || [];
          ctx.state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: controllerId,
            source: sourceId,
            sourceName: sourceName,
            description: description,
            triggerType: triggerType,
            effect: effect,
            mandatory: typeof mandatory === 'boolean' ? mandatory : true,
            ...(typeof value !== 'undefined' ? { value } : null),
            ...(permanentId ? { permanentId } : null),
            ...(typeof requiresChoice === 'boolean' ? { requiresChoice } : null),
            ...(typeof requiresTarget === 'boolean' ? { requiresTarget } : null),
            ...(targetType ? { targetType } : null),
            ...(targetConstraint ? { targetConstraint } : null),
            ...(typeof needsTargetSelection === 'boolean' ? { needsTargetSelection } : null),
            ...(targetZone ? { targetZone } : null),
            ...(targetDestination ? { targetDestination } : null),
            ...(targetGraveyardScope ? { targetGraveyardScope } : null),
            ...(destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
            ...(battlefieldControllerMode ? { battlefieldControllerMode } : null),
            ...(targetAction ? { targetAction } : null),
            ...(Array.isArray(targetFilterTypes) ? { targetFilterTypes } : null),
            ...(Array.isArray(targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords } : null),
            ...(Array.isArray(targetFilterExcludeTypes) ? { targetFilterExcludeTypes } : null),
            ...(targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
            ...(typeof targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue } : null),
            ...(typeof targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue } : null),
            ...(typeof targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue } : null),
            ...(typeof targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit } : null),
            ...(targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
            ...(targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
            ...(typeof minTargets === 'number' ? { minTargets } : null),
            ...(typeof maxTargets === 'number' ? { maxTargets } : null),
            ...(preselectedTargetsPersisted === true ? { preselectedTargetsPersisted: true } : null),
            ...(boundGraveyardCardId ? { boundGraveyardCardId } : null),
            ...(boundGraveyardOwnerId ? { boundGraveyardOwnerId } : null),
            ...(delayedReturnAt ? { delayedReturnAt } : null),
            ...(battlefieldTapped === true ? { battlefieldTapped: true } : null),
            ...(battlefieldCounters && typeof battlefieldCounters === 'object' ? { battlefieldCounters } : null),
            ...(battlefieldFaceDown === true ? { battlefieldFaceDown: true } : null),
            ...(battlefieldTurnFaceUp === true ? { battlefieldTurnFaceUp: true } : null),
            ...(battlefieldSuspected === true ? { battlefieldSuspected: true } : null),
            ...(battlefieldSetTypeLine ? { battlefieldSetTypeLine } : null),
            ...(typeof battlefieldSetOracleText === 'string' ? { battlefieldSetOracleText } : null),
            ...(battlefieldLoseAllOtherTypes === true ? { battlefieldLoseAllOtherTypes: true } : null),
            ...(Array.isArray(battlefieldGrantedTypes) ? { battlefieldGrantedTypes } : null),
            ...(typeof isModal === 'boolean' ? { isModal } : null),
            ...(Array.isArray(modalOptions) ? { modalOptions } : null),
            ...(targetPlayer ? { targetPlayer } : null),
            ...(defendingPlayer ? { defendingPlayer } : null),
            ...(triggeringPlayer != null ? { triggeringPlayer } : null),
            ...(damagedPlayerId ? { damagedPlayerId } : null),
            ...(attackingPlayerId ? { attackingPlayerId } : null),
            ...(typeof damageAmount === 'number' ? { damageAmount } : null),
            ...(Array.isArray(damageSourcePermanentIds) ? { damageSourcePermanentIds } : null),
            ...(typeof damageIncludedWarriorSource === 'boolean' ? { damageIncludedWarriorSource } : null),
            ...(typeof activatedAbilityIsManaAbility === 'boolean' ? { activatedAbilityIsManaAbility } : null),
            ...(triggeringStackItemId ? { triggeringStackItemId } : null),
            ...(triggeringSpellCastSourceZone ? { triggeringSpellCastSourceZone } : null),
            ...(triggeringSpell && typeof triggeringSpell === 'object' ? { triggeringSpell } : null),
            ...(triggeringPermanentId ? { triggeringPermanentId } : null),
            ...(interveningIfSubjectPermanentId ? { interveningIfSubjectPermanentId } : null),
            ...(interveningIfSubjectSnapshot && typeof interveningIfSubjectSnapshot === 'object' ? { interveningIfSubjectSnapshot } : null),
            ...(effectData && typeof effectData === 'object' ? { effectData } : null),
            ...(initiativeVentureTrigger === true ? { initiativeVentureTrigger: true } : null),
            ...(reboundCardId ? { reboundCardId } : null),
            ...(paradigmCardId ? { paradigmCardId } : null),
            ...(Array.isArray(targets) ? { targets } : null),
            ...(card && typeof card === 'object' ? { card } : null),
            ...(sourcePermanentSnapshot && typeof sourcePermanentSnapshot === 'object' ? { sourcePermanentSnapshot } : null),
            ...(dyingCreature && typeof dyingCreature === 'object' ? { dyingCreature } : null),
            ...(sacrificedPermanent && typeof sacrificedPermanent === 'object' ? { sacrificedPermanent } : null),
            ...(lastSacrificedPermanents && lastSacrificedPermanents.length > 0 ? { lastSacrificedPermanents } : null),
            ...(discardedCard && typeof discardedCard === 'object' ? { discardedCard } : null),
            ...(milledCard && typeof milledCard === 'object' ? { milledCard } : null),
          } as any);
          pushTriggerDoublerCopies(ctx.state, (ctx.state.stack || [])[(ctx.state.stack || []).length - 1]);
          
          debug(2, `[applyEvent] Pushed triggered ability: ${sourceName} - ${description}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(pushTriggeredAbility): failed", err);
        }
        break;
      }

      case "queueTriggerOrderStep": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const stepId = String((e as any).stepId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const description = String((e as any).description || '').trim();
          const mandatory = (e as any).mandatory !== false;
          const requireAll = (e as any).requireAll === true;
          const triggers = Array.isArray((e as any).triggers)
            ? ((e as any).triggers as any[])
                .map((trigger: any) => ({
                  id: String(trigger?.id || '').trim(),
                  sourceName: String(trigger?.sourceName || '').trim(),
                  effect: String(trigger?.effect || '').trim(),
                  ...(trigger?.imageUrl ? { imageUrl: String(trigger.imageUrl) } : null),
                }))
                .filter((trigger: any) => Boolean(trigger.id))
            : [];

          if (gameId && playerId && triggers.length > 1) {
            const existingStep = ResolutionQueueManager
              .getQueue(gameId)
              .steps
              .find((step: any) => step && String(step.id || '').trim() === stepId);

            if (!existingStep) {
              ResolutionQueueManager.addStep(gameId, {
                ...(stepId ? { id: stepId } : null),
                type: ResolutionStepType.TRIGGER_ORDER,
                playerId: playerId as PlayerID,
                description: description || `Choose the order to put ${triggers.length} triggered abilities on the stack`,
                mandatory,
                triggers,
                requireAll,
              } as any, { allowDuringReplay: true });
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(queueTriggerOrderStep): failed', err);
        }
        break;
      }

      case "scheduleDelayedGraveyardReturn": {
        try {
          const stateAny = ctx.state as any;
          const entries = Array.isArray((e as any).entries) ? (e as any).entries : [];
          stateAny.pendingDelayedGraveyardReturns = Array.isArray(stateAny.pendingDelayedGraveyardReturns)
            ? stateAny.pendingDelayedGraveyardReturns
            : [];

          for (const rawEntry of entries) {
            const scheduleId = String(rawEntry?.scheduleId || '').trim();
            const cardId = String(rawEntry?.cardId || '').trim();
            const zoneOwnerId = String(rawEntry?.zoneOwnerId || '').trim();
            if (!cardId || !zoneOwnerId) continue;
            if (scheduleId && stateAny.pendingDelayedGraveyardReturns.some((entry: any) => String(entry?.scheduleId || '') === scheduleId)) {
              continue;
            }
            stateAny.pendingDelayedGraveyardReturns.push({
              ...(scheduleId ? { scheduleId } : null),
              cardId,
              zoneOwnerId,
              fireAtTurnNumber: Number(rawEntry?.fireAtTurnNumber ?? 0) || 0,
              fireAtStep: String(rawEntry?.fireAtStep || '').toLowerCase() === 'upkeep' ? 'upkeep' : 'end_step',
              fireAtPlayerId: String(rawEntry?.fireAtPlayerId || '').trim() || undefined,
              sourceName: String(rawEntry?.sourceName || (e as any).sourceName || 'Delayed trigger'),
              createdBy: String(rawEntry?.createdBy || (e as any).playerId || '').trim() || undefined,
              destination: String(rawEntry?.destination || '').toLowerCase() === 'battlefield' ? 'battlefield' : 'hand',
              destinationUsesSelectedCardOwner: rawEntry?.destinationUsesSelectedCardOwner === true,
              battlefieldControllerMode: String(rawEntry?.battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
              battlefieldControllerId: String(rawEntry?.battlefieldControllerId || '').trim() || undefined,
              battlefieldTapped: rawEntry?.battlefieldTapped === true,
              battlefieldCounters: rawEntry?.battlefieldCounters && typeof rawEntry.battlefieldCounters === 'object'
                ? { ...(rawEntry.battlefieldCounters as Record<string, number>) }
                : undefined,
              ...(rawEntry?.battlefieldFaceDown === true ? { battlefieldFaceDown: true } : null),
              ...(rawEntry?.battlefieldTurnFaceUp === true ? { battlefieldTurnFaceUp: true } : null),
              ...(rawEntry?.battlefieldSuspected === true ? { battlefieldSuspected: true } : null),
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(scheduleDelayedGraveyardReturn): failed', err);
        }
        break;
      }

      case "scheduleDelayedDrawAtNextUpkeep": {
        try {
          const stateAny = ctx.state as any;
          const entries = Array.isArray((e as any).entries) ? (e as any).entries : [];
          stateAny.pendingDelayedDrawsAtNextUpkeep = Array.isArray(stateAny.pendingDelayedDrawsAtNextUpkeep)
            ? stateAny.pendingDelayedDrawsAtNextUpkeep
            : [];

          for (const rawEntry of entries) {
            const scheduleId = String(rawEntry?.scheduleId || '').trim();
            const playerId = String(rawEntry?.playerId || rawEntry?.createdBy || (e as any).playerId || '').trim();
            if (!playerId) continue;
            if (scheduleId && stateAny.pendingDelayedDrawsAtNextUpkeep.some((entry: any) => String(entry?.scheduleId || '') === scheduleId)) {
              continue;
            }

            const count = Math.max(1, Math.floor(Number(rawEntry?.count || 1)));
            const upTo = rawEntry?.upTo === true;
            stateAny.pendingDelayedDrawsAtNextUpkeep.push({
              ...(scheduleId ? { scheduleId } : null),
              playerId,
              createdBy: String(rawEntry?.createdBy || playerId).trim(),
              sourceId: String(rawEntry?.sourceId || '').trim() || undefined,
              sourceName: String(rawEntry?.sourceName || (e as any).sourceName || 'Delayed trigger').trim() || 'Delayed trigger',
              count,
              ...(upTo ? { upTo: true } : null),
              fireAtTurnNumber: Number(rawEntry?.fireAtTurnNumber ?? 0) || 0,
              fireAtStep: 'upkeep',
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(scheduleDelayedDrawAtNextUpkeep): failed', err);
        }
        break;
      }

      case "resolutionStepTimeoutRecovery": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cancelledStepIds = Array.isArray((e as any).cancelledStepIds)
            ? ((e as any).cancelledStepIds as any[]).map((stepId: any) => String(stepId || '').trim()).filter(Boolean)
            : [];
          const fallbackStepId = String((e as any).stepId || '').trim();
          const stepIds = cancelledStepIds.length > 0
            ? cancelledStepIds
            : (fallbackStepId ? [fallbackStepId] : []);

          if (gameId) {
            for (const stepId of stepIds) {
              ResolutionQueueManager.cancelStep(gameId, stepId);
            }

            const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
            if (!pendingSummary.hasPending && (ctx.state as any)?.priority === null && (ctx.state as any)?.turnPlayer) {
              (ctx.state as any).priority = (ctx.state as any).turnPlayer;
              (ctx.state as any).priorityPassedBy = new Set<string>();
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(resolutionStepTimeoutRecovery): failed', err);
        }
        break;
      }

      case "resolveTriggeredAbility": {
        // Resolve a triggered ability - execute its effect
        const triggerId = (e as any).triggerId;
        const effect = (e as any).effect;
        const controllerId = (e as any).controllerId;
        const sourceName = (e as any).sourceName;
        
        try {
          // The actual effect execution is handled by resolveTopOfStack
          // This event just records that the trigger was resolved
          debug(2, `[applyEvent] Resolved triggered ability: ${sourceName} - ${effect}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(resolveTriggeredAbility): failed", err);
        }
        break;
      }

      case "mayAutoPreferenceSet": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const effectKey = String((e as any).effectKey || '').trim();
          const value = (e as any).value;
          if (!playerId || !effectKey) break;

          const stateAny = ctx.state as any;
          stateAny.mayAutoPreferences = stateAny.mayAutoPreferences || {};
          stateAny.mayAutoPreferences[playerId] = stateAny.mayAutoPreferences[playerId] || {};

          if (value === null || value === undefined) {
            delete stateAny.mayAutoPreferences[playerId][effectKey];
          } else {
            stateAny.mayAutoPreferences[playerId][effectKey] = value;
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mayAutoPreferenceSet): failed', err);
        }
        break;
      }

      case "setAutoYesOptional": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const enabled = (e as any).enabled === true;
          if (!playerId) break;

          const stateAny = ctx.state as any;
          stateAny.autoYesOptional = stateAny.autoYesOptional || {};
          if (enabled) {
            stateAny.autoYesOptional[playerId] = true;
          } else {
            delete stateAny.autoYesOptional[playerId];
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setAutoYesOptional): failed', err);
        }
        break;
      }

      case "setTriggerShortcut": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const cardName = String((e as any).cardName || '').trim().toLowerCase();
          const preference = String((e as any).preference || '').trim();
          const triggerDescriptionRaw = (e as any).triggerDescription;
          const triggerDescription = typeof triggerDescriptionRaw === 'string' ? triggerDescriptionRaw : undefined;

          if (!playerId || !cardName || !preference) break;

          const stateAny = ctx.state as any;
          stateAny.triggerShortcuts = stateAny.triggerShortcuts || {};
          stateAny.triggerShortcuts[playerId] = Array.isArray(stateAny.triggerShortcuts[playerId])
            ? stateAny.triggerShortcuts[playerId]
            : [];

          const shortcuts = stateAny.triggerShortcuts[playerId] as any[];
          const existingIndex = shortcuts.findIndex((entry: any) =>
            String(entry?.cardName || '').trim().toLowerCase() === cardName &&
            (!triggerDescription || entry?.triggerDescription === triggerDescription)
          );

          if (preference === 'ask_each_time') {
            if (existingIndex >= 0) {
              shortcuts.splice(existingIndex, 1);
            }
          } else {
            const shortcut = {
              cardName,
              playerId,
              preference,
              triggerDescription,
            };

            if (existingIndex >= 0) {
              shortcuts[existingIndex] = shortcut;
            } else {
              shortcuts.push(shortcut);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setTriggerShortcut): failed', err);
        }
        break;
      }

      case "triggerOrderResponse": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const stepId = String((e as any).stepId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || stepId).trim();
          const orderedTriggerIds = Array.isArray((e as any).orderedTriggerIds)
            ? ((e as any).orderedTriggerIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];

          if (resolvedStepId && ctx.gameId) {
            clearReplayQueuedStepById(ctx.gameId, resolvedStepId);
          }

          applyTriggerOrderToStack(ctx.state, orderedTriggerIds);

          if (playerId && (ctx.state as any).pendingTriggerOrdering?.[playerId]) {
            delete (ctx.state as any).pendingTriggerOrdering[playerId];
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(triggerOrderResponse): failed', err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
