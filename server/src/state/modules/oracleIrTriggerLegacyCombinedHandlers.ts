import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import { debug } from '../../utils/debug.js';
import { queueLandPlayFromHandPrompt, queueControllerLandPlayOrDrawPrompt } from './triggerLandPlayPromptUtils.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { modifyTriggerEffectLife } from './triggerLifeDamageUtils.js';
import { queueLifeLossTriggers } from './triggers/life-loss.js';
import {
  applyRetiredTriggerLegacyDrawAndLifeCombinedEffects,
  applyRetiredTriggerLegacyPutThatManyCountersOnSelf,
} from './oracleIrTriggerLegacyRegexHandlers.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

const WORD_TO_NUMBER: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseNumberWord(word: string | undefined, defaultValue = 1): number {
  if (!word) return defaultValue;
  const lower = word.toLowerCase();
  if (WORD_TO_NUMBER[lower] !== undefined) {
    return WORD_TO_NUMBER[lower];
  }
  const num = parseInt(lower, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

export interface TriggerLegacyCombinedParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacyOptionalDiscardThenDraw(
  params: TriggerLegacyCombinedParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const optionalDiscardThenDrawMatch = String(params.desc || '').trim().match(
    /^you may discard a card\. if you do, draw a card(?:\. if a land card (?:is|was) discarded this way, draw an additional card)?\.?$/i,
  );
  if (!optionalDiscardThenDrawMatch) {
    return false;
  }

  const hasLandDiscardRider = /if a land card (?:is|was) discarded this way, draw an additional card/i.test(String(params.desc || ''));
  queueResolveTopOfStackPrompt(params.ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: params.controller as any,
    description: `${params.sourceName}: You may discard a card. If you do, draw a card.${hasLandDiscardRider ? ' If a land card is discarded this way, draw an additional card.' : ''}`,
    mandatory: true,
    sourceId: String(params.triggerItem?.source || params.triggerItem?.permanentId || '').trim() || undefined,
    sourceName: params.sourceName,
    options: [
      { id: 'discard', label: 'Discard a card' },
      { id: 'dont', label: "Don't discard" },
    ],
    minSelections: 1,
    maxSelections: 1,
    optionalDiscardThenDrawChoice: true,
    optionalDiscardThenDrawPlayerId: params.controller,
    optionalDiscardThenDrawSourceName: params.sourceName,
    optionalDiscardThenDrawCount: 1,
    ...(hasLandDiscardRider ? { optionalDiscardThenDrawCountIfDiscardedLand: 1 } : null),
  } as any);
  debug(2, `[executeTriggerEffect] Queued optional discard-then-draw choice for ${params.sourceName}`);
  return true;
}

export function applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit(
  params: TriggerLegacyCombinedParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const sacrificeAnotherPermanentForBenefitMatch = String(params.desc || '').trim().match(
    /^you may sacrifice another permanent\. if you do, you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and draw a card\.?$/i,
  );
  if (!sacrificeAnotherPermanentForBenefitMatch) {
    return false;
  }

  const lifeGain = parseNumberWord(sacrificeAnotherPermanentForBenefitMatch[1], 1);
  const sourcePermanentId = String(
    params.triggerItem?.source || params.triggerItem?.permanentId || params.triggerItem?.sourceId || params.triggerItem?.sourcePermanentId || '',
  ).trim() || undefined;

  queueResolveTopOfStackPrompt(params.ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: params.controller as any,
    description: `${params.sourceName}: You may sacrifice another permanent. If you do, you gain ${lifeGain} life and draw a card.`,
    mandatory: true,
    sourceId: sourcePermanentId,
    sourceName: params.sourceName,
    options: [
      { id: 'sac', label: 'Sacrifice a permanent' },
      { id: 'dont', label: "Don't sacrifice" },
    ],
    minSelections: 1,
    maxSelections: 1,
    sacrificeAnotherPermanentForBenefitChoice: true,
    sacrificeAnotherPermanentForBenefitStage: 'ask',
    sacrificeAnotherPermanentForBenefitController: params.controller,
    sacrificeAnotherPermanentForBenefitSourceName: params.sourceName,
    sacrificeAnotherPermanentForBenefitSourcePermanentId: sourcePermanentId,
    sacrificeAnotherPermanentForBenefitLifeGain: lifeGain,
    sacrificeAnotherPermanentForBenefitDrawCount: 1,
  } as any);
  debug(2, `[executeTriggerEffect] Queued sacrifice-another-permanent benefit choice for ${params.sourceName}`);
  return true;
}

export function applyRetiredTriggerLegacyPutLandFromHand(
  params: TriggerLegacyCombinedParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/you may put a land card from your hand onto the battlefield/i.test(String(params.desc || ''))) {
    return false;
  }

  const hasDrawFallback = /if you don(?:'|’)?t,?\s*draw a card/i.test(String(params.desc || ''));
  if (hasDrawFallback) {
    queueControllerLandPlayOrDrawPrompt(params.ctx, params.controller, params.sourceName, params.triggerItem);
    return true;
  }

  queueLandPlayFromHandPrompt(params.ctx, params.controller, params.sourceName, params.triggerItem);
  return true;
}

export function applyRetiredTriggerLegacyCombinedEffectsRegexBatch(
  params: TriggerLegacyCombinedParams & {
    readonly isKynaiosEffect: boolean;
    readonly opponents: readonly any[];
    readonly battlefield: readonly any[];
  },
): boolean {
  let handled = false;

  handled = applyRetiredTriggerLegacyDrawAndLifeCombinedEffects({
    ctx: params.ctx,
    controller: params.controller,
    sourceName: params.sourceName,
    desc: params.desc,
    triggerItem: params.triggerItem,
    state: params.state,
    isKynaiosEffect: params.isKynaiosEffect,
  }) || handled;

  if (applyRetiredTriggerLegacyPutThatManyCountersOnSelf({
    desc: params.desc,
    triggerItem: params.triggerItem,
    state: params.state,
  })) {
    handled = true;
  }

  return handled;
}

export function applyRetiredTriggerLegacyThatPlayerSacrificesAndLosesLife(
  params: TriggerLegacyCombinedParams & {
    readonly triggerCard: any;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const thatPlayerSacrificesAndLosesMatch = params.desc.match(/that player sacrifices a creature(?: of their choice)? and loses (\d+) life/i);
  if (!thatPlayerSacrificesAndLosesMatch) {
    return false;
  }

  const affectedPlayerId = String(
    params.triggerItem?.effectData?.searchingPlayerId ||
    params.triggerItem?.targetPlayer ||
    params.triggerItem?.triggeringPlayer ||
    '',
  ).trim();
  const lossAmount = parseInt(thatPlayerSacrificesAndLosesMatch[1], 10);
  if (!affectedPlayerId || !Number.isFinite(lossAmount) || lossAmount <= 0) {
    return true;
  }

  const gameId = String((params.ctx as any).gameId || (params.ctx as any).id || params.triggerItem?.gameId || 'unknown');
  const sourceIdForStep = String(params.triggerItem?.source || params.triggerItem?.permanentId || params.triggerItem?.sourceId || '');
  const affectedCreatures = (params.state.battlefield || []).filter((permanent: any) => {
    if (!permanent || String(permanent.controller || '') !== affectedPlayerId) return false;
    const typeLine = String(permanent.card?.type_line || '').toLowerCase();
    return typeLine.includes('creature') || isCreatureNow(permanent);
  });

  if (affectedCreatures.length > 0 && gameId && gameId !== 'unknown' && !(params.ctx as any).isReplaying) {
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.UPKEEP_SACRIFICE,
      playerId: affectedPlayerId,
      description: `${params.sourceName}: Choose a creature to sacrifice, then lose ${lossAmount} life.`,
      mandatory: true,
      sourceId: sourceIdForStep,
      sourceName: params.sourceName,
      sourceImage: params.triggerCard?.image_uris?.small || params.triggerCard?.image_uris?.normal,
      hasCreatures: true,
      creatures: affectedCreatures.map((permanent: any) => ({
        id: permanent.id,
        name: permanent.card?.name || 'Creature',
        imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
        power: permanent.card?.power || permanent.basePower,
        toughness: permanent.card?.toughness || permanent.baseToughness,
      })),
      allowSourceSacrifice: false,
      edictSacrifice: true,
      sourceController: params.controller,
      reason: 'trigger_effect',
      lifeLossAfterSacrifice: lossAmount,
      lifeLossAfterSacrificePlayerId: affectedPlayerId,
      lifeLossAfterSacrificeSourceController: params.controller,
    } as any);
  } else {
    modifyTriggerEffectLife(params.state, affectedPlayerId, -lossAmount);
    queueLifeLossTriggers(params.ctx, affectedPlayerId, lossAmount, params.controller, { trackLifeLost: false });
  }
  return true;
}
