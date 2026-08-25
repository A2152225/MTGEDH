/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: running the spell-cast triggers a cast produced - APNAP
 * ordering, intervening-if gating, Oracle IR vs legacy routing, queueing the
 * resolution steps each trigger needs, and the opponent-cast trigger pass.
 *
 * Public entry symbols: processSpellCastTriggersForCast,
 * processOpponentSpellCastTriggersForCast.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { updateCounters } from "../../state/modules/counters_tokens.js";
import { inferTriggeredAbilityTargetMetadata } from "../../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { isOracleIrTriggerPrimaryEnabled } from "../../state/modules/oracleIrFeatureFlags.js";
import { tryResolveTriggerViaOracleIR } from "../../state/modules/oracleIrTriggerExecution.js";
import { isTriggerEffectOwnedByOracleIrPrimary } from "../../state/modules/oracleIrTriggerLegacyRouting.js";
import { getOpponentSpellCastTriggers } from "../../state/modules/triggers/index.js";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { ResolutionQueueManager, ResolutionStepType, createResolutionStep } from "../../state/resolution/index.js";
import { uid } from "../../state/utils";
import { debug, debugWarn } from "../../utils/debug.js";
import { queueOptionalPaymentStep } from "../optional-payment-prompts.js";
import { deriveCastUsedManaFromPermanentSource, getPlayerName, millUntilLand } from "../util";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import {
  applySpellCastUntapTrigger,
  cloneTriggeredSpellCopy,
  persistQueuedSpellCastStepContinuation,
} from "./gameActionsSpellCopyHeroicTriggers.js";
import {
  createSpellCastTriggerToken,
  getSpellCastTriggersForCard,
  hasSpellCastTriggerTriggeredThisTurn,
  markSpellCastTriggerTriggeredThisTurn,
  normalizeSpellCastSourceZone,
  resolveSpellCastOptionalPaymentChoice,
} from "./gameActionsSpellCastTriggerDetection.js";

export function processSpellCastTriggersForCast(
  gameId: string,
  game: any,
  io: Server,
  casterId: string,
  spellCard: any,
  castSourceZone?: SpellCastSourceZone,
  triggeringStackItemId?: string,
): void {
  try {
    const ctxForInterveningIf = { state: game.state } as any;
    const normalizedCastSourceZone = normalizeSpellCastSourceZone(castSourceZone);
    const triggeringSpellSnapshot = {
      id: spellCard?.id,
      name: spellCard?.name,
      type_line: spellCard?.type_line,
      ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone } : null),
    };
    const stackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
    let triggeringStackItem: any = null;
    const normalizedTriggeringStackItemId = String(triggeringStackItemId || '').trim();

    if (normalizedTriggeringStackItemId) {
      triggeringStackItem = stackArr.find((item: any) => item && String(item.id || '') === normalizedTriggeringStackItemId) || null;
    }

    if (!triggeringStackItem) {
      for (let i = stackArr.length - 1; i >= 0; i--) {
        const item = stackArr[i];
        if (!item || String(item.controller || '') !== String(casterId)) continue;
        const itemCardId = String(item?.card?.id || '');
        if (itemCardId && itemCardId === String(spellCard?.id || '')) {
          triggeringStackItem = item;
          break;
        }
      }
    }

    const resolvedTriggeringStackItemId = triggeringStackItem ? String(triggeringStackItem.id || '') : undefined;
    const spellCastTriggers = getSpellCastTriggersForCard(game, casterId, spellCard, castSourceZone);
    const castManaPayment = Array.isArray((triggeringStackItem as any)?.manaPayment)
      ? (triggeringStackItem as any).manaPayment
      : (Array.isArray((triggeringStackItem as any)?.card?.manaPayment)
        ? (triggeringStackItem as any).card.manaPayment
        : undefined);
    const castManaProducedByPermanentBeforePayment = (triggeringStackItem as any)?.manaProducedByPermanentBeforePayment
      || (triggeringStackItem as any)?.card?.manaProducedByPermanentBeforePayment;
    const castPoolBeforePayment = (triggeringStackItem as any)?.poolBeforeSpellPayment
      || (triggeringStackItem as any)?.card?.poolBeforeSpellPayment;
    const castManaSpentBreakdown = (triggeringStackItem as any)?.manaSpentBreakdown
      || (triggeringStackItem as any)?.card?.manaSpentBreakdown;
    for (const trigger of spellCastTriggers) {
      if (trigger.requiresManaFromPermanentId) {
        const usedSourceMana = deriveCastUsedManaFromPermanentSource(game.state, String(casterId), trigger.requiresManaFromPermanentId, {
          poolBeforePayment: castPoolBeforePayment,
          consumed: castManaSpentBreakdown,
          manaProducedByPermanentBeforePayment: castManaProducedByPermanentBeforePayment,
          manaPayment: castManaPayment,
        });
        if (!usedSourceMana) {
          debug(2, `[processSpellCastTriggersForCast] Skipping ${trigger.cardName}: cast did not use mana produced by ${trigger.requiresManaFromPermanentId}`);
          continue;
        }
      }
      if (hasSpellCastTriggerTriggeredThisTurn(game, trigger)) {
        debug(2, `[processSpellCastTriggersForCast] Skipping once-per-turn spell-cast trigger already used: ${trigger.cardName}`);
        continue;
      }

      const raw = String(trigger.description || trigger.effect || '').trim();
      let triggerText = raw;
      if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
        triggerText = `Whenever you cast a spell, ${triggerText}`;
      }
      const sourcePerm = (game.state?.battlefield || []).find((perm: any) => perm && perm.id === trigger.permanentId);
      const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
      const baseRefs: any = {
        triggeringStackItemId: resolvedTriggeringStackItemId,
        stackItem: triggeringStackItem || undefined,
      };
      const ok = isInterveningIfSatisfied(
        ctxForInterveningIf,
        String(trigger.controllerId || casterId),
        triggerText,
        sourcePerm,
        needsThatPlayerRef
          ? {
              ...baseRefs,
              thatPlayerId: String(casterId),
              referencedPlayerId: String(casterId),
              theirPlayerId: String(casterId),
            }
          : baseRefs,
      );
      if (ok === false) {
        debug(2, `[processSpellCastTriggersForCast] Skipping spell-cast trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
        continue;
      }

      debug(2, `[processSpellCastTriggersForCast] Triggered: ${trigger.cardName} - ${trigger.description}`);

      if (trigger.replacementEffect?.kind === 'bottom_spell_reveal_until_nonland') {
        markSpellCastTriggerTriggeredThisTurn(game, trigger);

        const queuedRevealChoiceStep = createResolutionStep({
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: casterId as any,
          description: `${trigger.cardName}: Put ${spellCard.name} on the bottom of its owner's library and reveal until a nonland card?`,
          mandatory: false,
          sourceId: trigger.permanentId,
          sourceName: trigger.cardName,
          options: [
            { id: 'yes', label: 'Use ability' },
            { id: 'no', label: 'Decline' },
          ],
          minSelections: 1,
          maxSelections: 1,
          spellBottomRevealUntilNonlandChoice: true,
          triggeringStackItemId: resolvedTriggeringStackItemId,
          triggeringSpellControllerId: casterId,
          triggeringSpellCard: {
            ...spellCard,
            owner: (spellCard as any).owner || casterId,
          },
          revealFromLibraryPlayerId: trigger.controllerId,
          revealSourcePermanentId: trigger.permanentId,
          revealSourceCardName: trigger.cardName,
        } as any);

        persistQueuedSpellCastStepContinuation(gameId, game, {
          playerId: casterId,
          cardId: String(spellCard?.id || ''),
          queuedResolutionStep: queuedRevealChoiceStep,
        });

        ResolutionQueueManager.addStep(gameId, queuedRevealChoiceStep as any);
        continue;
      }

      const inferredTargetMetadata = inferTriggeredAbilityTargetMetadata(String(trigger.effect || trigger.description || ''), {
        gameState: game.state,
        controllerId: String(trigger.controllerId || casterId),
        sourceName: trigger.cardName,
        sourcePermanent: sourcePerm,
      });
      const routesThroughDirectSpellCopy = trigger.copiesSpell === true;

      if (trigger.optionalPaymentCost && !trigger.mandatory) {
        const triggerControllerId = String(trigger.controllerId || casterId);
        const sourcePermForPayment = (game.state?.battlefield || []).find((perm: any) => perm && perm.id === trigger.permanentId);
        const cardImageUrl =
          sourcePermForPayment?.card?.image_uris?.small || sourcePermForPayment?.card?.image_uris?.normal;
        const manaCost = String(trigger.optionalPaymentCost || '').trim();

        queueOptionalPaymentStep(gameId, {
          playerId: triggerControllerId,
          sourceId: String(trigger.permanentId || ''),
          sourceName: trigger.cardName,
          sourceImage: cardImageUrl,
          description: trigger.description || `${trigger.cardName}: You may pay ${manaCost}.`,
          mandatory: false,
          minSelections: 0,
          maxSelections: 1,
          priority: -1,
          payChoiceId: 'pay_mana',
          payLabel: `Pay ${manaCost}`,
          payDescription: `If you do: ${trigger.effect || 'resolve effect'}`,
          declineChoiceId: 'decline',
          declineLabel: 'Decline',
          declineDescription: 'Do not pay the optional cost.',
          validationKind: 'mana',
          manaCost,
          stepData: {
            spellCastTriggerOptionalPaymentChoice: true,
            permanentId: trigger.permanentId,
            cardName: trigger.cardName,
            manaCost,
            effect: trigger.effect,
            triggerDescription: trigger.description,
            tokenDetails: trigger.tokenDetails,
            createsToken: trigger.createsToken === true,
          },
          onPay: async () => {
            resolveSpellCastOptionalPaymentChoice(io, game, gameId, triggerControllerId, trigger, true);
          },
          onDecline: async () => {
            resolveSpellCastOptionalPaymentChoice(io, game, gameId, triggerControllerId, trigger, false);
          },
        });
        continue;
      }

      const effectLowerForShortcut = trigger.effect.toLowerCase();
      const hasShortcut = (
        effectLowerForShortcut.includes('draw a card') || effectLowerForShortcut.includes('draw cards') || effectLowerForShortcut.includes('draws a card') ||
        effectLowerForShortcut.includes('untap') ||
        trigger.copiesSpell === true ||
        trigger.cardName.toLowerCase().includes('consuming aberration') || effectLowerForShortcut.includes('until they reveal a land card') ||
        (trigger.createsToken && trigger.tokenDetails && trigger.mandatory)
      );

      if (
        !routesThroughDirectSpellCopy
        && (
          inferredTargetMetadata.requiresTarget === true
          || String(inferredTargetMetadata.targetZone || '').length > 0
          || String(inferredTargetMetadata.targetAction || '').length > 0
          || !hasShortcut
        )
      ) {
        const triggerId = uid('trigger');
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: String(trigger.controllerId || casterId),
          source: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: 'cast_creature_type',
          effect: trigger.effect,
          mandatory: trigger.mandatory,
          triggeringPlayer: String(casterId),
          addsLoyaltyCounters: trigger.addsLoyaltyCounters,
          ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
          ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
          effectData: {
            casterId: String(casterId),
            ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone, sourceCastZone: normalizedCastSourceZone } : null),
            ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
            triggeringSpell: triggeringSpellSnapshot,
          },
          ...(inferredTargetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
          ...(inferredTargetMetadata.targetType ? { targetType: inferredTargetMetadata.targetType } : null),
          ...(inferredTargetMetadata.targetConstraint ? { targetConstraint: inferredTargetMetadata.targetConstraint } : null),
          ...(inferredTargetMetadata.targetZone ? { targetZone: inferredTargetMetadata.targetZone } : null),
          ...(inferredTargetMetadata.targetDestination ? { targetDestination: inferredTargetMetadata.targetDestination } : null),
          ...(inferredTargetMetadata.targetGraveyardScope ? { targetGraveyardScope: inferredTargetMetadata.targetGraveyardScope } : null),
          ...(inferredTargetMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
          ...(inferredTargetMetadata.battlefieldControllerMode ? { battlefieldControllerMode: inferredTargetMetadata.battlefieldControllerMode } : null),
          ...(inferredTargetMetadata.battlefieldCounters ? { battlefieldCounters: inferredTargetMetadata.battlefieldCounters } : null),
          ...(inferredTargetMetadata.targetAction ? { targetAction: inferredTargetMetadata.targetAction } : null),
          ...(Array.isArray(inferredTargetMetadata.targetFilterTypes) ? { targetFilterTypes: inferredTargetMetadata.targetFilterTypes } : null),
          ...(Array.isArray(inferredTargetMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: inferredTargetMetadata.targetFilterRequiredTypeWords } : null),
          ...(Array.isArray(inferredTargetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: inferredTargetMetadata.targetFilterExcludeTypes } : null),
          ...(inferredTargetMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
          ...(typeof inferredTargetMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: inferredTargetMetadata.targetFilterExactManaValue } : null),
          ...(typeof inferredTargetMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: inferredTargetMetadata.targetFilterMinManaValue } : null),
          ...(typeof inferredTargetMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: inferredTargetMetadata.targetFilterMaxManaValue } : null),
          ...(typeof inferredTargetMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: inferredTargetMetadata.targetTotalPowerLimit } : null),
          ...(inferredTargetMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
          ...(inferredTargetMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
          ...(typeof inferredTargetMetadata.minTargets === 'number' ? { minTargets: inferredTargetMetadata.minTargets } : null),
          ...(typeof inferredTargetMetadata.maxTargets === 'number' ? { maxTargets: inferredTargetMetadata.maxTargets } : null),
        } as any;

        game.state.stack = game.state.stack || [];
        game.state.stack.push(stackItem);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
            triggerId,
            sourceId: trigger.permanentId,
            permanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            controllerId: String(trigger.controllerId || casterId),
            description: trigger.description,
            triggerType: 'cast_creature_type',
            effect: trigger.effect,
            mandatory: trigger.mandatory,
            triggeringPlayer: String(casterId),
            addsLoyaltyCounters: trigger.addsLoyaltyCounters,
            ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
            ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
            effectData: stackItem.effectData,
            ...(inferredTargetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
            ...(inferredTargetMetadata.targetType ? { targetType: inferredTargetMetadata.targetType } : null),
            ...(inferredTargetMetadata.targetConstraint ? { targetConstraint: inferredTargetMetadata.targetConstraint } : null),
            ...(inferredTargetMetadata.targetZone ? { targetZone: inferredTargetMetadata.targetZone } : null),
            ...(inferredTargetMetadata.targetDestination ? { targetDestination: inferredTargetMetadata.targetDestination } : null),
            ...(inferredTargetMetadata.targetGraveyardScope ? { targetGraveyardScope: inferredTargetMetadata.targetGraveyardScope } : null),
            ...(inferredTargetMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
            ...(inferredTargetMetadata.battlefieldControllerMode ? { battlefieldControllerMode: inferredTargetMetadata.battlefieldControllerMode } : null),
            ...(inferredTargetMetadata.battlefieldCounters ? { battlefieldCounters: inferredTargetMetadata.battlefieldCounters } : null),
            ...(inferredTargetMetadata.targetAction ? { targetAction: inferredTargetMetadata.targetAction } : null),
            ...(Array.isArray(inferredTargetMetadata.targetFilterTypes) ? { targetFilterTypes: inferredTargetMetadata.targetFilterTypes } : null),
            ...(Array.isArray(inferredTargetMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: inferredTargetMetadata.targetFilterRequiredTypeWords } : null),
            ...(Array.isArray(inferredTargetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: inferredTargetMetadata.targetFilterExcludeTypes } : null),
            ...(inferredTargetMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
            ...(typeof inferredTargetMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: inferredTargetMetadata.targetFilterExactManaValue } : null),
            ...(typeof inferredTargetMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: inferredTargetMetadata.targetFilterMinManaValue } : null),
            ...(typeof inferredTargetMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: inferredTargetMetadata.targetFilterMaxManaValue } : null),
            ...(typeof inferredTargetMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: inferredTargetMetadata.targetTotalPowerLimit } : null),
            ...(inferredTargetMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
            ...(inferredTargetMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
            ...(typeof inferredTargetMetadata.minTargets === 'number' ? { minTargets: inferredTargetMetadata.minTargets } : null),
            ...(typeof inferredTargetMetadata.maxTargets === 'number' ? { maxTargets: inferredTargetMetadata.maxTargets } : null),
          });
        } catch (err) {
          debugWarn(1, '[processSpellCastTriggersForCast] appendEvent(pushTriggeredAbility spell-cast generic) failed:', err);
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${trigger.cardName} triggers: ${trigger.description}`,
          ts: Date.now(),
        });
        continue;
      }

      const effectLower = trigger.effect.toLowerCase();
      if (effectLower.includes('draw a card') || effectLower.includes('draw cards') || effectLower.includes('draws a card')) {
        if (typeof game.drawCards === 'function') {
          game.drawCards(casterId, 1);
          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}`,
            gameId,
            from: 'system',
            message: `${trigger.cardName}: ${getPlayerName(game, casterId)} draws a card.`,
            ts: Date.now(),
          });
        }
      }

      if (effectLower.includes('untap')) {
        applySpellCastUntapTrigger(game, casterId);
      }

      if (trigger.copiesSpell === true) {
        const copyEffectText = String(trigger.effect || trigger.description || '').trim();
        let copiedViaOracleIr = false;
        if (
          copyEffectText
          && isOracleIrTriggerPrimaryEnabled()
          && isTriggerEffectOwnedByOracleIrPrimary(copyEffectText, trigger.cardName)
        ) {
          const irOutcome = tryResolveTriggerViaOracleIR(
            {
              gameId,
              state: game.state,
              io,
              ...(typeof game.bumpSeq === 'function' ? { bumpSeq: game.bumpSeq.bind(game) } : {}),
            } as any,
            {
              controller: String(trigger.controllerId || casterId) as PlayerID,
              sourceName: trigger.cardName,
              effectText: copyEffectText,
              triggerItem: {
                permanentId: trigger.permanentId,
                source: trigger.permanentId,
                triggeringStackItemId: resolvedTriggeringStackItemId,
                triggeringPlayer: casterId,
                effectData: {
                  casterId: String(casterId),
                  ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
                  ...(triggeringSpellSnapshot ? { triggeringSpell: triggeringSpellSnapshot } : null),
                },
              },
            },
          );
          copiedViaOracleIr = irOutcome.handled;
        }

        if (!copiedViaOracleIr) {
          cloneTriggeredSpellCopy(gameId, game, io, trigger, casterId, resolvedTriggeringStackItemId, String(spellCard?.id || ''));
        }
      }

      if (trigger.cardName.toLowerCase().includes('consuming aberration') || effectLower.includes('until they reveal a land card')) {
        const opponents = (game.state.players || []).filter((player: any) => player.id !== casterId);
        for (const opponent of opponents) {
          const millResult = millUntilLand(game, opponent.id);
          if (millResult.milled.length > 0) {
            io.to(gameId).emit('chat', {
              id: `m_${Date.now()}`,
              gameId,
              from: 'system',
              message: `${trigger.cardName}: ${getPlayerName(game, opponent.id)} mills ${millResult.milled.length} card(s)${millResult.landHit ? ` (stopped at ${millResult.landHit.name})` : ''}.`,
              ts: Date.now(),
            });
          }
        }
      }

      if (trigger.createsToken && trigger.tokenDetails) {
        createSpellCastTriggerToken(game, io, gameId, casterId, trigger);
      }

      if (trigger.addsLoyaltyCounters && trigger.addsLoyaltyCounters > 0) {
        const battlefield = game.state?.battlefield || [];
        const planeswalker = battlefield.find((perm: any) => perm.id === trigger.permanentId && perm.controller === casterId);
        if (planeswalker) {
          const addAmount = Number(trigger.addsLoyaltyCounters) || 0;
          updateCounters(
            {
              state: game.state,
              bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
              gameId,
            } as any,
            String(planeswalker.id),
            { loyalty: addAmount },
          );
          const newLoyalty = Number((planeswalker as any)?.counters?.loyalty || 0);

          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}`,
            gameId,
            from: 'system',
            message: `${trigger.cardName}: ${getPlayerName(game, casterId)} adds ${addAmount} loyalty counter${addAmount > 1 ? 's' : ''} (now ${newLoyalty}).`,
            ts: Date.now(),
          });

          debug(2, `[processSpellCastTriggersForCast] ${trigger.cardName}: Added ${addAmount} loyalty counter(s), now at ${newLoyalty}`);
        }
      }

      if (trigger.requiresTarget && (effectLower.includes('tap or untap target') || effectLower.includes('untap target') || effectLower.includes('tap target'))) {
        const targetedOk = isInterveningIfSatisfied(
          ctxForInterveningIf,
          String(trigger.controllerId || casterId),
          triggerText,
          sourcePerm,
          needsThatPlayerRef
            ? {
                thatPlayerId: String(casterId),
                referencedPlayerId: String(casterId),
                theirPlayerId: String(casterId),
              }
            : undefined,
        );
        if (targetedOk === false) {
          debug(2, `[processSpellCastTriggersForCast] Skipping targeted spell-cast trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
          continue;
        }

        const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        game.state.stack = game.state.stack || [];
        game.state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: casterId,
          source: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: 'cast_creature_type',
          effect: trigger.effect,
          mandatory: trigger.mandatory,
          triggeringPlayer: String(casterId),
          ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
          ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
          effectData: {
            casterId: String(casterId),
            ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone, sourceCastZone: normalizedCastSourceZone } : null),
            ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
            triggeringSpell: triggeringSpellSnapshot,
          },
          requiresTarget: true,
          targetType: trigger.targetType || 'permanent',
        } as any);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
            triggerId,
            sourceId: trigger.permanentId,
            permanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            controllerId: casterId,
            description: trigger.description,
            triggerType: 'cast_creature_type',
            effect: trigger.effect,
            mandatory: trigger.mandatory,
            triggeringPlayer: String(casterId),
            ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
            ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
            effectData: {
              casterId: String(casterId),
              ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone, sourceCastZone: normalizedCastSourceZone } : null),
              ...(resolvedTriggeringStackItemId ? { triggeringStackItemId: resolvedTriggeringStackItemId } : null),
              triggeringSpell: triggeringSpellSnapshot,
            },
            requiresTarget: true,
            targetType: trigger.targetType || 'permanent',
          });
        } catch (err) {
          debugWarn(1, '[processSpellCastTriggersForCast] appendEvent(pushTriggeredAbility spell-cast targeted) failed:', err);
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${trigger.cardName} triggers: ${getPlayerName(game, casterId)} may tap or untap target permanent.`,
          ts: Date.now(),
        });
      }
    }

  } catch (err) {
    debugWarn(1, '[processSpellCastTriggersForCast] Failed to process spell-cast triggers:', err);
  }
}

export function processOpponentSpellCastTriggersForCast(
  gameId: string,
  game: any,
  io: Server,
  casterId: string,
  spellCard: any,
  castSourceZone?: SpellCastSourceZone,
): void {
  try {
    const allPlayerIds = (game.state?.players || []).map((player: any) => player.id);
    const battlefield = game.state?.battlefield || [];
    const ctxForInterveningIf = { state: game.state } as any;
    const normalizedCastSourceZone = normalizeSpellCastSourceZone(castSourceZone);
    const triggeringSpellSnapshot = {
      id: spellCard?.id,
      name: spellCard?.name,
      type_line: spellCard?.type_line,
      ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone } : null),
    };
    const spellTypeLine = String(spellCard?.type_line || '').toLowerCase();
    const isNoncreatureSpell = !spellTypeLine.includes('creature');
    const noncreatureSpellsThisTurn = (game.state?.noncreatureSpellsCastThisTurn || {})[casterId] || 0;
    const isFirstNoncreatureThisTurn = isNoncreatureSpell && noncreatureSpellsThisTurn === 0;

    if (isNoncreatureSpell) {
      game.state.noncreatureSpellsCastThisTurn = game.state.noncreatureSpellsCastThisTurn || {};
      game.state.noncreatureSpellsCastThisTurn[casterId] = noncreatureSpellsThisTurn + 1;
    }

    const opponentTriggers = orderTriggersByAPNAP(
      { state: game.state } as any,
      getOpponentSpellCastTriggers(
        battlefield,
        casterId,
        spellCard,
        allPlayerIds,
        isFirstNoncreatureThisTurn,
      ),
    );

    for (const trigger of opponentTriggers) {
      const raw = String(trigger.description || (trigger as any).effect || '').trim();
      let triggerText = raw;
      if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
        triggerText = `Whenever an opponent casts a spell, ${triggerText}`;
      }
      const resolvedCasterId = String((trigger as any).casterId || casterId || '').trim();
      const sourcePerm = (game.state?.battlefield || []).find((perm: any) => perm && perm.id === (trigger as any).permanentId);
      const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
      const ok = isInterveningIfSatisfied(
        ctxForInterveningIf,
        String(trigger.controllerId),
        triggerText,
        sourcePerm,
        needsThatPlayerRef && resolvedCasterId
          ? {
              thatPlayerId: resolvedCasterId,
              referencedPlayerId: resolvedCasterId,
              theirPlayerId: resolvedCasterId,
            }
          : undefined,
      );
      if (ok === false) {
        debug(2, `[processOpponentSpellCastTriggersForCast] Skipping opponent spell trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
        continue;
      }

      game.state.stack = game.state.stack || [];
      const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const stackItem: any = {
        id: triggerId,
        type: 'triggered_ability',
        controller: trigger.controllerId,
        source: trigger.permanentId,
        permanentId: trigger.permanentId,
        sourceName: trigger.cardName,
        description: trigger.description,
        triggerType: trigger.triggerType,
        mandatory: trigger.mandatory,
        targetPlayer: String((trigger as any).casterId || casterId || ''),
        triggeringPlayer: String((trigger as any).casterId || casterId || ''),
        ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
        effectData: {
          casterId: trigger.casterId,
          ...(normalizedCastSourceZone ? { castSourceZone: normalizedCastSourceZone, sourceCastZone: normalizedCastSourceZone } : null),
          triggeringSpell: triggeringSpellSnapshot,
          paymentCost: trigger.paymentCost,
          paymentAmount: trigger.paymentAmount,
          benefitIfNotPaid: trigger.benefitIfNotPaid,
        },
      };
      game.state.stack.push(stackItem);

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: trigger.description,
          triggerType: trigger.triggerType,
          effect: (trigger as any).effect || trigger.description,
          mandatory: trigger.mandatory,
          targetPlayer: stackItem.targetPlayer,
          triggeringPlayer: stackItem.triggeringPlayer,
          ...(normalizedCastSourceZone ? { triggeringSpellCastSourceZone: normalizedCastSourceZone } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[processOpponentSpellCastTriggersForCast] appendEvent(pushTriggeredAbility opponent spell-cast) failed:', err);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${trigger.cardName} triggers (${trigger.description}).`,
        ts: Date.now(),
      });
    }
  } catch (err) {
    debugWarn(1, '[processOpponentSpellCastTriggersForCast] Failed to process opponent spell triggers:', err);
  }
}
