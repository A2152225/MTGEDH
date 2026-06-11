import type { PlayerID } from '../../../../shared/src/index.js';
import { debug } from '../../utils/debug.js';
import { applyTriggerLifeGain, getTriggerEffectHandSize } from './triggerLifeDamageUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyLifeAndGameParams {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly battlefield?: readonly any[];
}

export function applyRetiredTriggerLegacyThousandLifeLoseGame(
  params: TriggerLegacyLifeAndGameParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/then, if you have 1,000 or more life, you lose the game/i.test(String(params.desc || ''))) {
    return false;
  }

  const lifeTotal = Number(params.state.life?.[params.controller] ?? 0);
  if (lifeTotal >= 1000) {
    params.state.life[params.controller] = 0;
    debug(2, `[executeTriggerEffect] ${params.sourceName}: ${params.controller} lost the game at ${lifeTotal} life`);
  }
  return true;
}

export function applyRetiredTriggerLegacyUpkeepEffectDoubling(
  params: TriggerLegacyLifeAndGameParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/double the amount of life you lose and cards you draw for the rest of the game from this ability/i.test(String(params.desc || ''))) {
    return false;
  }

  const sourcePermanentId = String(params.triggerItem?.source || params.triggerItem?.permanentId || '').trim();
  const battlefield = params.battlefield || params.state.battlefield || [];
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourcePermanentId);
  if (sourcePermanent) {
    sourcePermanent.upkeepEffectDoubling = true;
    debug(2, `[executeTriggerEffect] ${params.sourceName}: enabled upkeep effect doubling`);
  }
  return true;
}

export function applyRetiredTriggerLegacyLoseGameReplacement(
  params: TriggerLegacyLifeAndGameParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/the next time you would lose the game this turn, instead draw three cards and your life total becomes 5/i.test(String(params.desc || ''))) {
    return false;
  }

  params.state.pendingLoseGameReplacements = Array.isArray(params.state.pendingLoseGameReplacements)
    ? params.state.pendingLoseGameReplacements
    : [];
  params.state.pendingLoseGameReplacements.push({
    playerId: params.controller,
    drawCount: 3,
    lifeTotal: 5,
    sourceName: params.sourceName,
    expiresAt: 'end_of_turn',
  });
  debug(2, `[executeTriggerEffect] ${params.sourceName}: registered lose-the-game replacement for ${params.controller}`);
  return true;
}

export function applyRetiredTriggerLegacyHandSizeLifeGain(
  params: TriggerLegacyLifeAndGameParams & {
    readonly sourceNameLower: string;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (params.sourceNameLower.includes("venser's journal") || String(params.desc || '').includes('gain life equal to cards in hand')) {
    const cardsInHand = getTriggerEffectHandSize(params.state, String(params.controller));
    applyTriggerLifeGain(params.state, String(params.controller), cardsInHand, params.sourceName);
    return true;
  }

  if (params.sourceNameLower.includes('ivory tower') || String(params.desc || '').includes('gain 1 life for each card in hand above 4')) {
    const cardsInHand = getTriggerEffectHandSize(params.state, String(params.controller));
    const amount = Math.max(0, cardsInHand - 4);
    applyTriggerLifeGain(params.state, String(params.controller), amount, params.sourceName);
    return true;
  }

  return false;
}
