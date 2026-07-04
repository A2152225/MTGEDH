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
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

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
 * Only compound patterns not expressible as single IR steps remain.
 */
export function applyRetiredTriggerLegacyDrawAndLifeCombinedEffects(
  params: TriggerLegacyDrawLifeParams,
): boolean {
  const {
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  } = params;

  if (skipRetiredTriggerLegacyHandler(desc, sourceName)) {
    return false;
  }

  const youGainThatMuchLifeMatch = desc.match(/you gain that much life/i);
  if (youGainThatMuchLifeMatch) {
    const amount = Number((triggerItem as any)?.effectData?.lifeLost || (triggerItem as any)?.effectData?.amount || 0);
    if (Number.isFinite(amount) && amount > 0) {
      modifyTriggerEffectLife(state, controller, amount);
      debug(2, `[executeTriggerEffect] ${controller} gains ${amount} life from ${sourceName}`);
      return true;
    }
  }

  return false;
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