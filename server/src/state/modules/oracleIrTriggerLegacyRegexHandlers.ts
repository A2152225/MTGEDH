import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { addEnergyCounters, addTokenCounters, calculateAllPTBonuses, parsePT } from '../utils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { debug } from '../../utils/debug.js';
import {
  applyTriggerOpponentDamageFromPermanent,
  modifyTriggerEffectLife,
  queueDealsDamageToPlayerTriggersFromPermanent,
} from './triggerLifeDamageUtils.js';

export interface TriggerLegacyDrawLifeParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly isKynaiosEffect: boolean;
}

export interface TriggerLegacyOpponentEffectParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly triggerCard?: any;
  readonly state: any;
  readonly opponents: readonly any[];
  readonly battlefield: readonly any[];
}
const DRAW_WORD_TO_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const ENERGY_WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

export function matchesDealEachOpponentAndGainLifePattern(desc: string): boolean {
  return /deals? (\d+) damage to each opponent.*you gain (\d+) life/i.test(desc);
}

function parseEnergyAmountFromEnergyGroups(
  wordOrDigit: string | undefined,
  symbolGroup: string | undefined,
): number {
  let amount = (String(symbolGroup || '').match(/\{e\}/gi) || []).length || 1;
  if (wordOrDigit) {
    amount = ENERGY_WORD_TO_NUMBER[wordOrDigit.toLowerCase()] || parseInt(wordOrDigit, 10) || 1;
  }
  return amount;
}

function parseDrawCountFromDesc(desc: string): number | undefined {
  const drawCountMatch = desc.match(/draw (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) cards?/i);
  if (!drawCountMatch) {
    if (desc.includes('draw a card') || desc.includes('draw 1 card')) {
      return 1;
    }
    return undefined;
  }

  const rawDrawCount = String(drawCountMatch[1] || '').toLowerCase();
  return DRAW_WORD_TO_NUMBER[rawDrawCount] || parseInt(rawDrawCount, 10) || 1;
}

/**
 * Legacy combined draw / gain-life / lose-life regex handlers retired under IR primary.
 */
export function applyRetiredTriggerLegacyDrawAndLifeCombinedEffects(
  params: TriggerLegacyDrawLifeParams,
): boolean {
  const {
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    isKynaiosEffect,
  } = params;

  let handled = false;

  const drawCount = !isKynaiosEffect ? parseDrawCountFromDesc(desc) : undefined;
  if (drawCount !== undefined) {
    drawCardsFromZone(ctx, controller, drawCount);
    debug(2, `[executeTriggerEffect] ${controller} draws ${drawCount} card(s) from ${sourceName}`);
    handled = true;
  }

  const youLoseLifeMatch = desc.match(/you lose (\d+) life/i);
  if (youLoseLifeMatch) {
    const amount = parseInt(youLoseLifeMatch[1], 10);
    modifyTriggerEffectLife(params.state, controller, -amount);
    debug(2, `[executeTriggerEffect] ${controller} loses ${amount} life from ${sourceName}`);
    handled = true;
  }

  const youGainLifeMatch = desc.match(/you gain (\d+) life/i);
  if (youGainLifeMatch && !matchesDealEachOpponentAndGainLifePattern(desc)) {
    const amount = parseInt(youGainLifeMatch[1], 10);
    modifyTriggerEffectLife(params.state, controller, amount);
    debug(2, `[executeTriggerEffect] ${controller} gains ${amount} life from ${sourceName}`);
    handled = true;
  }

  const youGainThatMuchLifeMatch = desc.match(/you gain that much life/i);
  if (youGainThatMuchLifeMatch) {
    const amount = Number((triggerItem as any)?.effectData?.lifeLost || (triggerItem as any)?.effectData?.amount || 0);
    if (Number.isFinite(amount) && amount > 0) {
      modifyTriggerEffectLife(params.state, controller, amount);
      debug(2, `[executeTriggerEffect] ${controller} gains ${amount} life from ${sourceName}`);
      handled = true;
    }
  }

  return handled;
}

export function applyRetiredTriggerLegacySingleGainLife(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'state'>,
): boolean {
  const gainLifeMatch = params.desc.match(/you gain (\d+) life/i);
  if (!gainLifeMatch) return false;

  const amount = parseInt(gainLifeMatch[1], 10);
  modifyTriggerEffectLife(params.state, params.controller, amount);
  return true;
}

export function applyRetiredTriggerLegacySingleDraw(
  params: Pick<TriggerLegacyDrawLifeParams, 'ctx' | 'controller' | 'desc' | 'isKynaiosEffect'>,
): boolean {
  const drawMatch = params.desc.match(/draw (?:a card|(\d+) cards?)/i);
  if (!drawMatch || params.isKynaiosEffect) return false;

  const count = drawMatch[1] ? parseInt(drawMatch[1], 10) : 1;
  drawCardsFromZone(params.ctx, params.controller, count);
  debug(2, `[executeTriggerEffect] ${params.controller} draws ${count} card(s)`);
  return true;
}

export function applyRetiredTriggerLegacyScry(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'state'>,
): boolean {
  const scryMatch = params.desc.match(/scry (\d+)/i);
  if (!scryMatch) return false;

  const scryCount = parseInt(scryMatch[1], 10);
  debug(2, `[executeTriggerEffect] ${params.controller} scries ${scryCount}`);
  params.state.pendingScry = params.state.pendingScry || {};
  params.state.pendingScry[params.controller] = scryCount;
  return true;
}

export function applyRetiredTriggerLegacyEachOpponentLosesLife(
  params: TriggerLegacyOpponentEffectParams,
): boolean {
  const opponentsLoseMatch = params.desc.match(/each opponent loses (\d+) life/i);
  const shouldDeferOptionalPaymentLifeDrain =
    /\byou may pay\b/i.test(params.desc) &&
    /\bif you do\b/i.test(params.desc) &&
    /\bextort\b/i.test(String(params.triggerCard?.oracle_text || params.sourceName || ''));
  if (!opponentsLoseMatch || shouldDeferOptionalPaymentLifeDrain) {
    return false;
  }

  const amount = parseInt(opponentsLoseMatch[1], 10);
  for (const opp of params.opponents) {
    modifyTriggerEffectLife(params.state, opp.id, -amount);
  }

  const alsoGainMatch = params.desc.match(/you gain (\d+) life/i);
  if (alsoGainMatch) {
    const gainAmount = parseInt(alsoGainMatch[1], 10);
    modifyTriggerEffectLife(params.state, params.controller, gainAmount);
  }

  return true;
}

export function applyRetiredTriggerLegacyDealsDamageToEachOpponent(
  params: TriggerLegacyOpponentEffectParams,
): boolean {
  const dealsToEachOpponentMatch = params.desc.match(/deals? (\d+) damage to each opponent/i);
  if (!dealsToEachOpponentMatch) {
    return false;
  }

  const damage = parseInt(dealsToEachOpponentMatch[1], 10);
  const sourcePermanentId = String((params.triggerItem as any)?.source || (params.triggerItem as any)?.permanentId || '');

  for (const opp of params.opponents) {
    const actualDamage = applyTriggerOpponentDamageFromPermanent(
      params.ctx,
      params.controller,
      params.state,
      params.battlefield,
      String(opp.id),
      damage,
      sourcePermanentId || undefined,
    );
    if (actualDamage > 0) {
      debug(2, `[executeTriggerEffect] ${params.sourceName} deals ${actualDamage} damage to ${opp.id}`);
    }

    try {
      if (sourcePermanentId && actualDamage > 0) {
        queueDealsDamageToPlayerTriggersFromPermanent(
          params.ctx,
          sourcePermanentId,
          String(opp.id),
          actualDamage,
        );
      }
    } catch {
      // Defensive: do not block resolution on trigger queue failure.
    }
  }

  const alsoGainMatch = params.desc.match(/you gain (\d+) life/i);
  if (alsoGainMatch) {
    const gainAmount = parseInt(alsoGainMatch[1], 10);
    modifyTriggerEffectLife(params.state, params.controller, gainAmount);
  }

  return true;
}

export function applyRetiredTriggerLegacyEachOpponentDiscards(
  params: Pick<TriggerLegacyOpponentEffectParams, 'desc' | 'state' | 'opponents'>,
): boolean {
  const discardOpponentsMatch = params.desc.match(/each opponent discards? (?:a card|(\d+) cards?)/i);
  if (!discardOpponentsMatch) {
    return false;
  }

  const discardCount = discardOpponentsMatch[1] ? parseInt(discardOpponentsMatch[1], 10) : 1;
  debug(2, `[executeTriggerEffect] Each opponent discards ${discardCount} card(s)`);

  params.state.pendingDiscard = params.state.pendingDiscard || {};
  for (const opp of params.opponents) {
    params.state.pendingDiscard[opp.id] = (params.state.pendingDiscard[opp.id] || 0) + discardCount;
  }

  return true;
}

export function applyRetiredTriggerLegacyTargetPlayerLoseYouGainLife(
  params: Pick<TriggerLegacyOpponentEffectParams, 'desc' | 'controller' | 'triggerItem' | 'opponents' | 'state'>,
): boolean {
  const targetLosesYouGainMatch = params.desc.match(/target player loses (\d+) life.*you gain (\d+) life/i);
  if (!targetLosesYouGainMatch) {
    return false;
  }

  const loseAmount = parseInt(targetLosesYouGainMatch[1], 10);
  const gainAmount = parseInt(targetLosesYouGainMatch[2], 10);
  const targets = params.triggerItem?.targets || [];
  const targetPlayer = targets[0]?.id || targets[0] || params.opponents[0]?.id;

  if (targetPlayer) {
    modifyTriggerEffectLife(params.state, String(targetPlayer), -loseAmount);
  }
  modifyTriggerEffectLife(params.state, params.controller, gainAmount);
  return true;
}

export function applyRetiredTriggerLegacyEachPlayerDraws(
  params: Pick<TriggerLegacyDrawLifeParams, 'ctx' | 'sourceName' | 'desc'> & {
    readonly players: readonly any[];
  },
): boolean {
  const eachDrawMatch = params.desc.match(/each player draws? (?:a card|(\d+) cards?)/i);
  if (!eachDrawMatch) {
    return false;
  }

  const count = eachDrawMatch[1] ? parseInt(eachDrawMatch[1], 10) : 1;
  for (const player of params.players) {
    if (!player?.hasLost) {
      const drawn = drawCardsFromZone(params.ctx, player.id as PlayerID, count);
      debug(2, `[executeTriggerEffect] ${params.sourceName}: ${player.id} drew ${drawn.length} card(s)`);
    }
  }

  return true;
}

export function applyRetiredTriggerLegacyDealEachOpponentAndGainLife(
  params: Pick<TriggerLegacyOpponentEffectParams, 'desc' | 'opponents' | 'controller' | 'state' | 'ctx' | 'battlefield' | 'triggerItem'>,
): boolean {
  const match = params.desc.match(/deals? (\d+) damage to each opponent.*you gain (\d+) life/i);
  if (!match) {
    return false;
  }

  const damageAmount = parseInt(match[1], 10);
  const gainAmount = parseInt(match[2], 10);
  const sourcePermanentId = String((params.triggerItem as any)?.source || (params.triggerItem as any)?.permanentId || '');
  for (const opp of params.opponents) {
    applyTriggerOpponentDamageFromPermanent(
      params.ctx,
      params.controller,
      params.state,
      params.battlefield,
      String(opp.id),
      damageAmount,
      sourcePermanentId || undefined,
    );
  }
  modifyTriggerEffectLife(params.state, params.controller, gainAmount);
  return true;
}

export function applyRetiredTriggerLegacyMayGainLife(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'state'>,
): boolean {
  const mayGainLifeMatch = params.desc.match(/you may gain (\d+) life/i);
  if (!mayGainLifeMatch) {
    return false;
  }

  const amount = parseInt(mayGainLifeMatch[1], 10);
  modifyTriggerEffectLife(params.state, params.controller, amount);
  return true;
}

export function applyRetiredTriggerLegacyCreatureControllerLosesLife(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'triggerItem' | 'state'>,
): boolean {
  const creatureControllerLosesMatch = params.desc.match(/creature's controller loses (\d+) life/i);
  if (!creatureControllerLosesMatch) {
    return false;
  }

  const amount = parseInt(creatureControllerLosesMatch[1], 10);
  const triggeringController = (params.triggerItem as any).triggeringController;
  if (triggeringController && triggeringController !== params.controller) {
    modifyTriggerEffectLife(params.state, triggeringController, -amount);
  }
  return true;
}

/**
 * Legacy energy gain patterns (Guide of Souls, etc.). Returns true when applied;
 * caller may continue for follow-up effects in the same description.
 */
export function applyRetiredTriggerLegacyEnergyEffects(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'sourceName' | 'state'> & {
    readonly skipIfAlreadyHandled?: boolean;
  },
): boolean {
  if (params.skipIfAlreadyHandled) {
    return false;
  }

  const lifeAndEnergyMatch = params.desc.match(/you gain (\d+) life and get (?:(\d+|one|two|three|four|five) )?((?:\{e\}\s*)+|energy)/i);
  if (lifeAndEnergyMatch) {
    const lifeAmount = parseInt(lifeAndEnergyMatch[1], 10);
    const energyAmount = parseEnergyAmountFromEnergyGroups(lifeAndEnergyMatch[2], lifeAndEnergyMatch[3]);

    modifyTriggerEffectLife(params.state, params.controller, lifeAmount);
    debug(2, `[executeTriggerEffect] ${params.sourceName}: ${params.controller} gains ${lifeAmount} life`);
    addEnergyCounters(params.state, params.controller, energyAmount, params.sourceName);
    return true;
  }

  const energyMatch = params.desc.match(/you get (?:(\d+|one|two|three|four|five) )?((?:\{e\}\s*)+|energy)/i);
  if (!energyMatch) {
    return false;
  }

  const amount = parseEnergyAmountFromEnergyGroups(energyMatch[1], energyMatch[2]);
  addEnergyCounters(params.state, params.controller, amount, params.sourceName);
  return true;
}

export function applyRetiredTriggerLegacyEachOpponentDraws(
  params: Pick<TriggerLegacyDrawLifeParams, 'ctx' | 'desc'> & {
    readonly opponents: readonly any[];
  },
): boolean {
  const eachOpponentDrawsMatch = params.desc.match(/each opponent draws? (\d+|a|an|one|two) cards?/i);
  if (!eachOpponentDrawsMatch) {
    return false;
  }

  const count = DRAW_WORD_TO_NUMBER[eachOpponentDrawsMatch[1].toLowerCase()]
    || parseInt(eachOpponentDrawsMatch[1], 10)
    || 1;

  for (const opp of params.opponents) {
    drawCardsFromZone(params.ctx, opp.id as PlayerID, count);
  }
  debug(2, `[executeTriggerEffect] Each opponent draws ${count} card(s)`);
  return true;
}

export function applyRetiredTriggerLegacyCounterAndDealsOpponentDamage(
  params: Pick<TriggerLegacyOpponentEffectParams, 'ctx' | 'controller' | 'sourceName' | 'desc' | 'triggerItem' | 'state' | 'opponents' | 'battlefield'>,
): boolean {
  const match = params.desc.match(/put a \+1\/\+1 counter on (?:~|vivi ornitier|this creature|this permanent|it).*and (?:it|~)?\s*deals? (\d+) damage to each opponent/i);
  if (!match) {
    return false;
  }

  const damage = parseInt(match[1], 10);
  const sourcePermId = params.triggerItem?.source || params.triggerItem?.permanentId;
  const battlefield = params.state.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);

  if (sourcePerm) {
    sourcePerm.counters = sourcePerm.counters || {};
    sourcePerm.counters['+1/+1'] = (sourcePerm.counters['+1/+1'] || 0) + 1;
    debug(2, `[executeTriggerEffect] Added +1/+1 counter to ${sourcePerm.card?.name || sourcePerm.id}`);
  }

  for (const opp of params.opponents) {
    const actualDamage = applyTriggerOpponentDamageFromPermanent(
      params.ctx,
      params.controller,
      params.state,
      params.battlefield,
      String(opp.id),
      damage,
      sourcePermId,
    );
    if (actualDamage > 0) {
      debug(2, `[executeTriggerEffect] ${params.sourceName} deals ${actualDamage} damage to opponent ${opp.id}`);
    }
    try {
      if (sourcePermId && actualDamage > 0) {
        queueDealsDamageToPlayerTriggersFromPermanent(
          params.ctx,
          sourcePermId,
          String(opp.id),
          actualDamage,
        );
      }
    } catch {
      // Defensive
    }
  }

  return true;
}

export function applyRetiredTriggerLegacyPutThatManyCountersOnSelf(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'triggerItem' | 'state'>,
): boolean {
  const match = params.desc.match(/put that many ([a-z0-9/+\- ]+?) counters? on (?:this enchantment|this permanent|~|it)/i);
  if (!match) {
    return false;
  }

  const amount = Number((params.triggerItem as any)?.effectData?.countersPlaced || (params.triggerItem as any)?.effectData?.amount || 0);
  const counterType = String(match[1] || '').trim().toLowerCase();
  const sourceId = params.triggerItem.source || params.triggerItem.permanentId;
  const sourcePermanent = sourceId
    ? (params.state.battlefield || []).find((permanent: any) => permanent?.id === sourceId)
    : null;

  if (!sourcePermanent || !Number.isFinite(amount) || amount <= 0 || !counterType) {
    return false;
  }

  sourcePermanent.counters = sourcePermanent.counters || {};
  sourcePermanent.counters[counterType] = Number(sourcePermanent.counters[counterType] || 0) + amount;
  debug(2, `[executeTriggerEffect] Added ${amount} ${counterType} counter(s) to ${sourcePermanent.card?.name || sourcePermanent.id}`);
  return true;
}

export function applyRetiredTriggerLegacyTokenCounters(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'sourceName' | 'state'> & {
    readonly skipIfAlreadyHandled?: boolean;
  },
): boolean {
  if (params.skipIfAlreadyHandled) {
    return false;
  }

  const tokenMatch = params.desc.match(/you get (?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten) )?token counters?/i);
  if (!tokenMatch) {
    return false;
  }

  const amount = DRAW_WORD_TO_NUMBER[tokenMatch[1]?.toLowerCase() || '']
    || parseInt(tokenMatch[1] || '', 10)
    || 1;

  addTokenCounters(params.state, params.controller, amount, params.sourceName);
  return true;
}

export function applyRetiredTriggerLegacyTargetPlayerDraws(
  params: Pick<TriggerLegacyDrawLifeParams, 'ctx' | 'controller' | 'desc' | 'triggerItem'>,
): boolean {
  const targetDrawMatch = params.desc.match(/(?:target|that) player draws? (\d+|a|an|one|two|three) cards?/i);
  if (!targetDrawMatch) {
    return false;
  }

  const count = DRAW_WORD_TO_NUMBER[targetDrawMatch[1].toLowerCase()]
    || parseInt(targetDrawMatch[1], 10)
    || 1;
  const targets = params.triggerItem?.targets || [];
  const targetPlayer = targets[0]?.id || targets[0] || params.controller;

  drawCardsFromZone(params.ctx, targetPlayer as PlayerID, count);
  debug(2, `[executeTriggerEffect] ${targetPlayer} draws ${count} card(s)`);
  return true;
}

export function applyRetiredTriggerLegacyUntapTapLands(
  params: Pick<TriggerLegacyDrawLifeParams, 'sourceName' | 'desc' | 'controller' | 'triggerItem' | 'state'>,
): boolean {
  const descLower = params.desc.toLowerCase();
  const untapAllControlledLands = descLower.includes('untap all lands you control');
  const tapAllDamagedPlayerLands =
    descLower.includes('tap all lands that player controls') ||
    descLower.includes('tap all lands defending player controls');

  if (!untapAllControlledLands && !tapAllDamagedPlayerLands) {
    return false;
  }

  const battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
  let untappedCount = 0;
  let tappedCount = 0;

  if (untapAllControlledLands) {
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== params.controller || !permanent.tapped) continue;
      const typeLine = String(permanent.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('land')) continue;
      permanent.tapped = false;
      untappedCount++;
    }
  }

  if (tapAllDamagedPlayerLands) {
    const damagedPlayerId = String(
      params.triggerItem?.effectData?.damagedPlayerId ||
      params.triggerItem?.damagedPlayerId ||
      params.triggerItem?.defendingPlayer ||
      params.triggerItem?.targetPlayer ||
      '',
    ).trim();

    if (damagedPlayerId) {
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== damagedPlayerId || permanent.tapped) continue;
        const typeLine = String(permanent.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('land')) continue;
        permanent.tapped = true;
        tappedCount++;
      }
    }
  }

  if (tapAllDamagedPlayerLands) {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: untapped ${untappedCount} land(s) for ${params.controller} and tapped ${tappedCount} land(s) for the damaged player`);
  } else {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: untapped ${untappedCount} land(s) for ${params.controller}`);
  }

  return true;
}

export function applyRetiredTriggerLegacyElspethCounterFromAmong(
  params: Pick<TriggerLegacyDrawLifeParams, 'ctx' | 'controller' | 'sourceName' | 'desc' | 'triggerItem' | 'state'>,
): boolean {
  const counterFromAmongMatch = params.desc.match(/\+1\/\+1 counter and a counter from among ([^.]+) on it/i);
  if (!counterFromAmongMatch) {
    return false;
  }

  const gameId = (params.ctx as any).gameId || 'unknown';
  const isReplaying = !!(params.ctx as any).isReplaying;
  const targets = (params.triggerItem as any).targets || [];

  const counterOptionsText = counterFromAmongMatch[1];
  const counterOptions = counterOptionsText
    .replace(/,?\s*or\s+/g, ', ')
    .split(/,\s*/)
    .map((opt: string) => opt.trim())
    .filter((opt: string) => opt.length > 0);

  debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Counter options: ${JSON.stringify(counterOptions)}, targets: ${JSON.stringify(targets)}`);

  if (targets.length === 0) {
    debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: No targets selected, effect fizzles`);
    return true;
  }

  if (isReplaying) {
    debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Skipping resolution step during replay`);
    return true;
  }

  const battlefield = params.state.battlefield || [];
  const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
  const targetCreature = battlefield.find((p: any) => p.id === targetId);

  if (!targetCreature) {
    debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Target creature ${targetId} not found`);
    return true;
  }

  if (gameId !== 'unknown') {
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODAL_CHOICE,
      playerId: params.controller,
      description: `${params.sourceName}: Choose a counter type to put on ${targetCreature.card?.name || 'the creature'}`,
      mandatory: true,
      sourceName: params.sourceName,
      sourceImage: params.triggerItem?.card?.image_uris?.small || params.triggerItem?.card?.image_uris?.normal,
      promptTitle: 'Choose Counter Type',
      promptDescription: `Put a +1/+1 counter and which keyword counter on ${targetCreature.card?.name || 'the creature'}?`,
      options: counterOptions.map((opt: string) => ({
        id: opt.toLowerCase().replace(/\s+/g, '_'),
        label: opt.charAt(0).toUpperCase() + opt.slice(1),
      })),
      minSelections: 1,
      maxSelections: 1,
      keywordCounterChoiceData: {
        targetPermanentId: targetId,
        targetName: targetCreature.card?.name || 'the creature',
        allowedKeywords: counterOptions,
        extraCounters: { '+1/+1': 1 },
        sourceName: params.sourceName,
      },
    });

    debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Created counter choice modal for ${targetCreature.card?.name}`);
  } else {
    targetCreature.counters = targetCreature.counters || {};
    targetCreature.counters['+1/+1'] = (targetCreature.counters['+1/+1'] || 0) + 1;
    if (counterOptions.length > 0) {
      const defaultCounter = counterOptions[0].toLowerCase();
      targetCreature.counters[defaultCounter] = (targetCreature.counters[defaultCounter] || 0) + 1;
    }
    debug(2, `[executeTriggerEffect] Elspeth Resplendent +1: Fallback - added counters to ${targetCreature.card?.name}`);
  }

  return true;
}

function addCreatureTypeToPermanent(creature: any, typeToAdd: string): void {
  if (!creature?.card) {
    creature.card = creature.card || {};
  }
  const currentTypeLine = creature.card.type_line || '';
  const typeToAddLower = typeToAdd.toLowerCase();

  if (currentTypeLine.toLowerCase().includes(typeToAddLower)) {
    return;
  }

  if (currentTypeLine.includes('—')) {
    creature.card.type_line = currentTypeLine + ' ' + typeToAdd;
  } else {
    creature.card.type_line = currentTypeLine + ' — ' + typeToAdd;
  }

  creature.addedTypes = creature.addedTypes || [];
  if (!creature.addedTypes.includes(typeToAdd)) {
    creature.addedTypes.push(typeToAdd);
  }
}

function grantFlyingToPermanent(targetCreature: any): void {
  const currentOracle = targetCreature.card?.oracle_text || '';
  if (!currentOracle.toLowerCase().includes('flying')) {
    targetCreature.card.oracle_text = currentOracle ? `Flying\n${currentOracle}` : 'Flying';
  }
  targetCreature.card.keywords = targetCreature.card.keywords || [];
  if (!targetCreature.card.keywords.includes('Flying')) {
    targetCreature.card.keywords.push('Flying');
  }
  targetCreature.grantedAbilities = targetCreature.grantedAbilities || [];
  if (!targetCreature.grantedAbilities.includes('flying')) {
    targetCreature.grantedAbilities.push('flying');
  }
}

function resolveTargetPermanentId(triggerItem: any): string | undefined {
  const targets = triggerItem?.targets || [];
  if (targets.length === 0) {
    return undefined;
  }
  return typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
}

export function applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'triggerItem' | 'state'>,
): boolean {
  const match = params.desc.match(/put two \+1\/\+1 counters on (?:target creature|it)/i);
  if (!match || !(params.triggerItem as any).targets?.length) {
    return false;
  }

  const targetId = resolveTargetPermanentId(params.triggerItem);
  const battlefield = params.state.battlefield || [];
  const targetCreature = battlefield.find((p: any) => p.id === targetId);

  if (targetCreature) {
    targetCreature.counters = targetCreature.counters || {};
    targetCreature.counters['+1/+1'] = (targetCreature.counters['+1/+1'] || 0) + 2;

    const descLower = params.desc.toLowerCase();
    if (descLower.includes('becomes an angel') || descLower.includes('angel in addition')) {
      addCreatureTypeToPermanent(targetCreature, 'Angel');
      grantFlyingToPermanent(targetCreature);
      debug(2, `[executeTriggerEffect] Archangel Elspeth -2: Added 2 +1/+1 counters, Angel type, and Flying to ${targetCreature.card?.name}`);
    } else {
      debug(2, `[executeTriggerEffect] Put two +1/+1 counters on ${targetCreature.card?.name}`);
    }
  }

  return true;
}

export function applyRetiredTriggerLegacyPowerBasedCountersEachCreatureYouControl(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'triggerItem' | 'state'>,
): boolean {
  if (!(params.desc.includes('+1/+1 counter') && params.desc.includes('each creature you control'))) {
    return false;
  }
  if (!(params.desc.includes('power') || params.desc.includes('where x'))) {
    return false;
  }

  const sourcePermId = params.triggerItem?.source || params.triggerItem?.permanentId;
  const battlefield = params.state.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);

  if (sourcePerm) {
    let sourcePower: number;
    if (typeof sourcePerm.effectivePower === 'number') {
      sourcePower = sourcePerm.effectivePower;
    } else {
      let basePower = sourcePerm.basePower || 0;
      if (!basePower && sourcePerm.card?.power) {
        basePower = parsePT(sourcePerm.card.power) ?? 0;
      }
      const plusCounters = sourcePerm.counters?.['+1/+1'] || 0;
      const minusCounters = sourcePerm.counters?.['-1/-1'] || 0;
      const counterDelta = plusCounters - minusCounters;
      const allBonuses = calculateAllPTBonuses(sourcePerm, params.state);
      sourcePower = Math.max(0, basePower + counterDelta + allBonuses.power);
    }

    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== params.controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;

      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + sourcePower;
      debug(2, `[executeTriggerEffect] Added ${sourcePower} +1/+1 counter(s) to ${perm.card?.name || perm.id}`);
    }
  }

  return true;
}

export function applyRetiredTriggerLegacyPlusOneCounterEachCreatureYouControl(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'state'>,
): boolean {
  if (!(params.desc.includes('+1/+1 counter') && params.desc.includes('each creature you control'))) {
    return false;
  }
  if (params.desc.includes('power') || params.desc.includes('where x')) {
    return false;
  }

  const battlefield = params.state.battlefield || [];
  for (const perm of battlefield) {
    if (!perm) continue;
    if (perm.controller !== params.controller) continue;
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;

    perm.counters = perm.counters || {};
    perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
    debug(2, `[executeTriggerEffect] Added +1/+1 counter to ${perm.card?.name || perm.id}`);
  }

  return true;
}

export function applyRetiredTriggerLegacyPlusOneCounterEachOtherType(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'controller' | 'triggerItem' | 'state'>,
): boolean {
  const match = params.desc.match(/\+1\/\+1 counter on each other (\w+) you control/i);
  if (!match) {
    return false;
  }

  const creatureType = match[1].toLowerCase();
  const battlefield = params.state.battlefield || [];
  const sourcePermId = params.triggerItem?.source || params.triggerItem?.permanentId;

  for (const perm of battlefield) {
    if (!perm) continue;
    if (perm.controller !== params.controller) continue;
    if (perm.id === sourcePermId) continue;

    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    if (!typeLine.includes(creatureType)) continue;

    perm.counters = perm.counters || {};
    perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
    debug(2, `[executeTriggerEffect] Added +1/+1 counter to ${perm.card?.name || perm.id} (${creatureType})`);
  }

  return true;
}

export function applyRetiredTriggerLegacyPlusOneCounterOnSelf(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'triggerItem' | 'state'>,
): boolean {
  const match = params.desc.match(/\+1\/\+1 counter on (?:~|this creature|it)/i);
  if (!match) {
    return false;
  }

  const sourcePermId = params.triggerItem?.source || params.triggerItem?.permanentId;
  const battlefield = params.state.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);

  if (sourcePerm) {
    sourcePerm.counters = sourcePerm.counters || {};
    sourcePerm.counters['+1/+1'] = (sourcePerm.counters['+1/+1'] || 0) + 1;
    debug(2, `[executeTriggerEffect] Added +1/+1 counter to ${sourcePerm.card?.name || sourcePerm.id}`);
  }

  return true;
}

export function applyRetiredTriggerLegacyIndestructibleCounterOnSelf(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'sourceName' | 'triggerItem' | 'state'>,
): boolean {
  if (!/put an? indestructible counter on/i.test(params.desc)) {
    return false;
  }

  const sourcePermId = params.triggerItem?.source || params.triggerItem?.permanentId;
  const battlefield = params.state.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);
  const normalizedDesc = String(params.desc || '').toLowerCase();
  const normalizedSourceName = String(params.sourceName || sourcePerm?.card?.name || '').toLowerCase();
  const targetsSelf =
    normalizedDesc.includes('on this creature') ||
    normalizedDesc.includes('on this permanent') ||
    normalizedDesc.includes('on it') ||
    normalizedDesc.includes('on ~') ||
    (normalizedSourceName.length > 0 && normalizedDesc.includes(`on ${normalizedSourceName}`));

  if (!sourcePerm || !targetsSelf) {
    return false;
  }

  sourcePerm.counters = sourcePerm.counters || {};
  sourcePerm.counters.indestructible = (sourcePerm.counters.indestructible || 0) + 1;
  debug(2, `[executeTriggerEffect] Added indestructible counter to ${sourcePerm.card?.name || sourcePerm.id}`);
  return true;
}

export function applyRetiredTriggerLegacyDoublePlusOneCountersOnSelf(
  params: Pick<TriggerLegacyDrawLifeParams, 'desc' | 'triggerItem' | 'state'>,
): boolean {
  if (!(params.desc.includes('double') && params.desc.includes('+1/+1 counter')
    && (params.desc.includes('this creature') || params.desc.includes('on it') || params.desc.includes('on ~')))) {
    return false;
  }

  const sourcePermId = params.triggerItem?.source || params.triggerItem?.permanentId;
  const battlefield = params.state.battlefield || [];
  const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);

  if (sourcePerm) {
    sourcePerm.counters = sourcePerm.counters || {};
    const currentCounters = sourcePerm.counters['+1/+1'] || 0;
    const newCounters = currentCounters * 2;
    sourcePerm.counters['+1/+1'] = newCounters;
    debug(2, `[executeTriggerEffect] Doubled +1/+1 counters on ${sourcePerm.card?.name || sourcePerm.id}: ${currentCounters} -> ${newCounters}`);
  }

  return true;
}

export function applyRetiredTriggerLegacyLootStyleTopLibrary(
  params: Pick<TriggerLegacyDrawLifeParams, 'ctx' | 'controller' | 'sourceName' | 'desc' | 'state'>,
): boolean {
  const lootStyleTopLibraryMatch = params.desc.match(
    /look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\..*creature card with mana value less than or equal to the number of lands you control.*put it onto the battlefield.*put the rest on the bottom(?: of your library)? in a random order/i,
  );
  if (!lootStyleTopLibraryMatch) {
    return false;
  }

  const rawCount = String(lootStyleTopLibraryMatch[1] || '').toLowerCase();
  const revealCount = DRAW_WORD_TO_NUMBER[rawCount] || Number.parseInt(rawCount, 10) || 0;
  const lib = ((params.ctx as any).libraries as Map<string, any[]>)?.get(params.controller) || [];
  const battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
  const landCount = battlefield.filter((permanent: any) => {
    if (!permanent || permanent.controller !== params.controller) return false;
    return String(permanent.card?.type_line || '').toLowerCase().includes('land');
  }).length;
  const topCards = lib.slice(0, revealCount);
  const availableCards: any[] = [];
  const nonSelectableCards: any[] = [];

  for (const card of topCards) {
    const summary = {
      id: card.id,
      name: card.name,
      type_line: card.type_line,
      oracle_text: card.oracle_text,
      image_uris: card.image_uris,
      imageUrl: card.image_uris?.normal || card.image_uris?.small,
      mana_cost: card.mana_cost,
      cmc: card.cmc,
      colors: card.colors,
      power: card.power,
      toughness: card.toughness,
      loyalty: card.loyalty,
    };
    const typeLine = String(card.type_line || '').toLowerCase();
    const manaValue = Number(card.cmc || 0);
    const isEligibleCreature = typeLine.includes('creature') && manaValue <= landCount;
    if (isEligibleCreature) {
      availableCards.push(summary);
    } else {
      nonSelectableCards.push(summary);
    }
  }

  const gameId = (params.ctx as any).gameId || 'unknown';
  if (!(params.ctx as any).isReplaying) {
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: params.controller,
      description: `${params.sourceName}: Look at the top ${revealCount} cards of your library. You may put a creature card with mana value ${landCount} or less from among them onto the battlefield. Put the rest on the bottom in a random order.`,
      mandatory: false,
      sourceName: params.sourceName,
      searchCriteria: `Top ${revealCount} cards - creature card with mana value ${landCount} or less`,
      minSelections: 0,
      maxSelections: 1,
      destination: 'battlefield',
      reveal: true,
      shuffleAfter: false,
      availableCards,
      nonSelectableCards,
      remainderDestination: 'bottom',
      remainderRandomOrder: true,
      contextValue: landCount,
    });
  }

  debug(2, `[executeTriggerEffect] ${params.sourceName}: queued Loot-style top-library selection with ${availableCards.length} eligible card(s) out of ${topCards.length}`);
  return true;
}

function resolveCounterPlacementConditionalText(
  triggerDescription: string,
  item: any,
  field: readonly any[],
): string {
  const parts = [
    String(triggerDescription || ''),
    String(item?.effect || ''),
    String(item?.description || ''),
    String(item?.card?.oracle_text || ''),
  ];
  const sourceId = String(item?.permanentId || item?.source || item?.sourceId || '').trim();
  if (sourceId) {
    const sourcePerm = field.find((perm: any) => String(perm?.id || '') === sourceId);
    if (sourcePerm?.card?.oracle_text) {
      parts.push(String(sourcePerm.card.oracle_text));
    }
  }
  return parts.join(' ').replace(/['']/g, "'").toLowerCase();
}

export function applyRetiredTriggerLegacyEachPlayerCounterPlacement(
  params: Pick<TriggerLegacyDrawLifeParams, 'ctx' | 'controller' | 'sourceName' | 'desc' | 'triggerItem' | 'state'> & {
    readonly players: readonly any[];
  },
): boolean {
  const eachPlayerCountersPattern = /each player may put (?:two|\d+) \+1\/\+1 counters? on a creature (?:they|that player) controls?/i;
  if (!eachPlayerCountersPattern.test(params.desc)) {
    return false;
  }

  const turnOrder = params.players.map((p: any) => p.id);
  const activePlayerId = params.state.activePlayer || params.controller;
  const gameId = (params.ctx as any).gameId || (params.ctx as any).id || params.triggerItem?.gameId || 'unknown';
  const battlefield = params.state.battlefield || [];

  if ((params.ctx as any).isReplaying) {
    debug(2, `[executeTriggerEffect] Agitator Ant: skipping resolution steps during replay`);
    return true;
  }

  const conditionalText = resolveCounterPlacementConditionalText(params.desc, params.triggerItem, battlefield);
  const counterEffectType = conditionalText.includes('goad') ? 'goad'
    : (conditionalText.includes("can't attack") || conditionalText.includes('cannot attack')) ? 'cant_attack'
    : 'none';
  const counterOnAccept = counterEffectType === 'goad' ? 'goad'
    : counterEffectType === 'cant_attack' ? 'cant_attack_controller'
    : null;

  const stepConfigs = params.players.map((p: any) => {
    const playerId = p.id;
    const playerCreatures = battlefield.filter((perm: any) => {
      if (perm.controller !== playerId) return false;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });

    return {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: `${params.sourceName}: You may put two +1/+1 counters on a creature you control`,
      mandatory: false,
      sourceId: params.triggerItem?.permanentId || params.triggerItem?.sourceId,
      sourceName: params.sourceName,
      sourceImage: params.triggerItem?.card?.image_uris?.small,
      counterPlacementTrigger: true,
      sourceController: params.controller,
      effectType: counterEffectType,
      conditionalEffect: {
        trigger: 'counter_placement',
        onAccept: counterOnAccept,
      },
      triggerDescription: params.desc,
      availableCreatures: playerCreatures.map((perm: any) => ({
        permanentId: perm.id,
        cardName: perm.card?.name || 'Creature',
        imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      })),
      options: [
        { id: 'decline', label: 'Decline' },
        ...playerCreatures.map((perm: any) => ({
          id: perm.id,
          label: perm.card?.name || 'Creature',
        })),
      ],
      minSelections: 0,
      maxSelections: 1,
    };
  });

  ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    stepConfigs,
    turnOrder,
    activePlayerId,
  );

  debug(2, `[executeTriggerEffect] ${params.sourceName} (counter placement effect): created ${params.players.length} resolution steps for counter placement (gameId: ${gameId})`);
  return true;
}