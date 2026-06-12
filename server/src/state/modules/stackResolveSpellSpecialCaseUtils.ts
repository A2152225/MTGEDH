import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { canPermanentBeTargetedByPlayer } from '../../rules-engine/targeting.js';
import { getEffectivePower } from '../../socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import { applyDamageToPermanentWithCounterEffects } from './counter-common-effects.js';
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from './triggers/damage-received.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { addTemporaryEtbTrigger } from './triggerEtbEntryEffects.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import {
  clearDivineReckoningChoiceBatch,
  clearPrisonersDilemmaChoiceBatch,
  createDivineReckoningChoiceBatch,
  createPrisonersDilemmaChoiceBatch,
} from './spellLegacyChoiceBatchUtils.js';
import { applySummonsOfSarumanEffect } from './oracleIrSpellLegacySummonsUtils.js';
import { wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';

export function applyInstantSorcerySpecialCaseSpellEffects(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    gameId: string;
    spellXValue: unknown;
    isRiteOfHarmonyStyleWindow: boolean;
    isDivineReckoningStyleChoice: boolean;
    isPrisonersDilemmaStyleChoice: boolean;
    isSummonsOfSarumanStyle: boolean;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const gameId = options.gameId;
  const spellXValue = options.spellXValue;

  if (options.isRiteOfHarmonyStyleWindow) {
    const sourceId = String(item?.source || effectiveCard?.id || item?.id || uid('rite_of_harmony'));
    addTemporaryEtbTrigger(state, {
      id: uid('temporary_etb_trigger'),
      controller: String(controller),
      sourceId,
      sourceName: effectiveCard?.name || 'spell',
      description: 'draw a card',
      effect: 'draw a card',
      watchTypes: ['creature', 'enchantment'],
      triggerType: 'temporary_etb',
      mandatory: true,
      expiresAt: 'end_of_turn',
    });

    debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || 'spell'} granted ${controller} a temporary creature/enchantment ETB draw trigger`);
  }

  if (options.isDivineReckoningStyleChoice) {
    const players = Array.isArray(state.players) ? state.players : [];
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const turnOrder: PlayerID[] = players
      .map((player: any) => player?.id)
      .filter((playerId: any) => typeof playerId === 'string') as PlayerID[];
    const activePlayerId: PlayerID =
      state?.turnPlayer ||
      state?.activePlayerId ||
      state?.activePlayer ||
      players[state?.activePlayerIndex || 0]?.id ||
      controller;
    const batchId = `${String(item?.id || card?.id || effectiveCard?.id || uid('divine_reckoning'))}:divine_reckoning`;
    const sourceId = String(item?.id || card?.id || effectiveCard?.id || '').trim() || undefined;
    const stepConfigs: any[] = [];
    const expectedPlayerIds: string[] = [];

    for (const player of players) {
      const playerId = String(player?.id || '').trim();
      if (!playerId || player?.hasLost) continue;

      const validTargets = battlefield
        .filter((permanent: any) => permanent && String(permanent.controller || '') === playerId)
        .filter((permanent: any) => isCreatureNow(permanent))
        .map((permanent: any) => ({
          id: permanent.id,
          label: permanent.card?.name || 'Creature',
          description: permanent.card?.type_line || 'creature',
          imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
        }));

      if (validTargets.length === 0) continue;

      expectedPlayerIds.push(playerId);
      stepConfigs.push({
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `${effectiveCard?.name || 'Divine Reckoning'}: choose a creature you control to keep. The rest will be destroyed.`,
        mandatory: true,
        sourceId,
        sourceName: effectiveCard?.name || 'Divine Reckoning',
        sourceImage: effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
        validTargets,
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature you control',
        priority: 0,
        divineReckoningChoice: true,
        divineReckoningBatchId: batchId,
        divineReckoningExpectedPlayerIds: expectedPlayerIds,
        divineReckoningController: String(controller),
        divineReckoningSourceId: sourceId,
        divineReckoningSourceName: effectiveCard?.name || 'Divine Reckoning',
      });
    }

    if (stepConfigs.length > 0 && gameId && gameId !== 'unknown') {
      for (const config of stepConfigs) {
        config.divineReckoningExpectedPlayerIds = [...expectedPlayerIds];
      }

      createDivineReckoningChoiceBatch(state, {
        id: batchId,
        controller: String(controller),
        sourceId,
        sourceName: effectiveCard?.name || 'Divine Reckoning',
        expectedPlayerIds,
      });

      try {
        const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, stepConfigs as any, turnOrder as any, activePlayerId as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
          sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
          queuedResolutionSteps: steps as any[],
        });
        debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || 'Divine Reckoning'} queued ${steps.length} Divine Reckoning survivor choice step(s)`);
      } catch (err) {
        clearDivineReckoningChoiceBatch(state, batchId);
        debugWarn(1, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || 'Divine Reckoning'} failed to queue Divine Reckoning choices:`, err);
      }
    } else {
      clearDivineReckoningChoiceBatch(state, batchId);
      debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || 'Divine Reckoning'} had no creatures to choose for Divine Reckoning`);
    }
  }

  if (options.isPrisonersDilemmaStyleChoice) {
    const players = Array.isArray(state.players) ? state.players : [];
    const turnOrder: PlayerID[] = players
      .map((player: any) => player?.id)
      .filter((playerId: any) => typeof playerId === 'string') as PlayerID[];
    const activePlayerId: PlayerID =
      state?.turnPlayer ||
      state?.activePlayerId ||
      state?.activePlayer ||
      players[state?.activePlayerIndex || 0]?.id ||
      controller;
    const batchId = `${String(item?.id || card?.id || effectiveCard?.id || uid('prisoners_dilemma'))}:prisoners_dilemma`;
    const sourceId = String(item?.id || card?.id || effectiveCard?.id || '').trim() || undefined;
    const stepConfigs: any[] = [];
    const expectedPlayerIds: string[] = [];

    for (const player of players) {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === String(controller) || player?.hasLost) continue;

      expectedPlayerIds.push(playerId);
      stepConfigs.push({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        description: `${effectiveCard?.name || "Prisoner's Dilemma"}: secretly choose silence or snitch.`,
        mandatory: true,
        sourceId,
        sourceName: effectiveCard?.name || "Prisoner's Dilemma",
        sourceImage: effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
        options: [
          { id: 'silence', label: 'Silence' },
          { id: 'snitch', label: 'Snitch' },
        ],
        minSelections: 1,
        maxSelections: 1,
        priority: 0,
        prisonersDilemmaChoice: true,
        secretChoice: true,
        prisonersDilemmaBatchId: batchId,
        prisonersDilemmaExpectedPlayerIds: expectedPlayerIds,
        prisonersDilemmaController: String(controller),
        prisonersDilemmaSourceId: sourceId,
        prisonersDilemmaSourceName: effectiveCard?.name || "Prisoner's Dilemma",
      });
    }

    if (stepConfigs.length > 0 && gameId && gameId !== 'unknown') {
      for (const config of stepConfigs) {
        config.prisonersDilemmaExpectedPlayerIds = [...expectedPlayerIds];
      }

      createPrisonersDilemmaChoiceBatch(state, {
        id: batchId,
        controller: String(controller),
        sourceId,
        sourceName: effectiveCard?.name || "Prisoner's Dilemma",
        expectedPlayerIds,
      });

      try {
        const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, stepConfigs as any, turnOrder as any, activePlayerId as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
          sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
          queuedResolutionSteps: steps as any[],
        });
        debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || "Prisoner's Dilemma"} queued ${steps.length} secret choice step(s)`);
      } catch (err) {
        clearPrisonersDilemmaChoiceBatch(state, batchId);
        debugWarn(1, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || "Prisoner's Dilemma"} failed to queue secret choices:`, err);
      }
    } else {
      clearPrisonersDilemmaChoiceBatch(state, batchId);
      debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || "Prisoner's Dilemma"} had no opponents to choose`);
    }
  }

  if (options.isSummonsOfSarumanStyle) {
    applySummonsOfSarumanEffect(
      ctx,
      controller,
      effectiveCard?.name || 'Summons of Saruman',
      String(item?.id || card?.id || ''),
      effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
      typeof spellXValue === 'number' && Number.isFinite(spellXValue) ? spellXValue : 0,
    );
  }
}

export function applyInstantSorceryNibelheimAflameEffect(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    targets: any[];
    isNibelheimAflameStyleSweep: boolean;
    hasNibelheimGraveyardRider: boolean;
  },
): void {
  if (!options.isNibelheimAflameStyleSweep || options.targets.length === 0) {
    return;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const targets = options.targets;

  const targetCreatureId = typeof targets[0] === 'string'
    ? String(targets[0])
    : String(targets[0]?.id || '');
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const targetCreature = battlefield.find((permanent: any) => String(permanent?.id || '') === targetCreatureId);

  if (
    !targetCreature
    || String(targetCreature?.controller || '') !== String(controller)
    || !isCreatureNow(targetCreature)
    || !canPermanentBeTargetedByPlayer(targetCreature, state, controller)
  ) {
    return;
  }

  const sourcePower = Math.max(0, Number(getEffectivePower(targetCreature) || 0));
  const stateAny = state as any;
  const queueDamageTrigger = (perm: any, damageAmount: number) => {
    processDamageReceivedTriggers(ctx, perm, damageAmount, (triggerInfo) => {
      if (dispatchDamageReceivedTrigger(ctx, triggerInfo)) {
        return;
      }

      stateAny.pendingDamageTriggers = stateAny.pendingDamageTriggers || {};
      stateAny.pendingDamageTriggers[triggerInfo.triggerId] = {
        sourceId: triggerInfo.sourceId,
        sourceName: triggerInfo.sourceName,
        controller: triggerInfo.controller,
        damageAmount: triggerInfo.damageAmount,
        triggerType: 'dealt_damage',
        targetType: triggerInfo.targetType,
        effect: triggerInfo.effect,
        ...(triggerInfo.effectMode ? { effectMode: triggerInfo.effectMode } : {}),
        ...(triggerInfo.attackingPlayerId ? { attackingPlayerId: triggerInfo.attackingPlayerId } : {}),
        ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
      };
    });
  };

  for (const otherCreature of battlefield) {
    if (!otherCreature || String(otherCreature?.id || '') === targetCreatureId || !isCreatureNow(otherCreature)) {
      continue;
    }

    const damageResult = applyDamageToPermanentWithCounterEffects(otherCreature, sourcePower, 'damageMarked');
    const appliedDamage = Math.max(0, Number(damageResult?.appliedAmount || 0));
    if (appliedDamage <= 0) {
      continue;
    }

    otherCreature.damageThisTurn = Number(otherCreature.damageThisTurn || 0) + appliedDamage;
    otherCreature.tookDamageThisTurn = true;

    stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
    stateAny.creaturesDamagedByThisCreatureThisTurn[targetCreatureId] = stateAny.creaturesDamagedByThisCreatureThisTurn[targetCreatureId] || {};
    stateAny.creaturesDamagedByThisCreatureThisTurn[targetCreatureId][String(otherCreature?.id || '')] = true;

    queueDamageTrigger(otherCreature, appliedDamage);
  }

  debug(2, `[applyInstantSorceryNibelheimAflameEffect] ${effectiveCard?.name}: ${targetCreature.card?.name || targetCreatureId} dealt ${sourcePower} damage to each other creature`);

  if (!options.hasNibelheimGraveyardRider || !wasSpellCastFromGraveyard(item)) {
    return;
  }

  const zones = (stateAny.zones || {})[controller];
  const handCards = Array.isArray(zones?.hand) ? zones.hand : [];
  const graveyard = Array.isArray(zones?.graveyard) ? zones.graveyard : (zones.graveyard = []);
  const discardedCards = handCards.splice(0, handCards.length).map((cardInHand: any) => ({
    ...cardInHand,
    zone: 'graveyard',
    discardedByPlayerId: String(controller),
    discardedOnTurn: Number(stateAny.turnNumber ?? stateAny.turn ?? 0) || 0,
  }));

  for (const discardedCard of discardedCards) {
    pushCardToPlayerGraveyardWithReplacements(ctx, String(controller), discardedCard, graveyard, {
      extraFields: {
        discardedByPlayerId: String(controller),
        discardedOnTurn: Number(stateAny.turnNumber ?? stateAny.turn ?? 0) || 0,
      },
    });
  }

  if (zones) {
    zones.handCount = handCards.length;
    zones.graveyardCount = graveyard.length;
  }

  if (discardedCards.length > 0) {
    stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
    stateAny.discardedCardThisTurn[String(controller)] = true;
    stateAny.anyPlayerDiscardedCardThisTurn = true;
  }

  try {
    const drawn = drawCardsFromZone(ctx, controller, 4);
    debug(2, `[applyInstantSorceryNibelheimAflameEffect] ${effectiveCard?.name}: ${controller} discarded ${discardedCards.length} card(s) and drew ${drawn.length} card(s) from its graveyard rider`);
  } catch (err) {
    debugWarn(1, `[applyInstantSorceryNibelheimAflameEffect] Failed to draw cards for ${effectiveCard?.name}:`, err);
  }
}
