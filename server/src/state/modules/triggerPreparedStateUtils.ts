import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { getEffectivePower } from '../../socket/util.js';
import { clearPreparedPermanent, setPermanentPrepared } from './prepared.js';
import { resolvePreparedTargetPermanent } from './triggerSourceUtils.js';

function parsePreparedConditionCountToken(token: string): number | null {
  const normalizedToken = String(token || '').trim().toLowerCase();
  if (!normalizedToken) {
    return null;
  }

  if (/^\d+$/.test(normalizedToken)) {
    return parseInt(normalizedToken, 10);
  }

  const words: Record<string, number> = {
    zero: 0,
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
  return words[normalizedToken] ?? null;
}

function getPreparedHandCount(state: any, playerId: string): number {
  const zone = state?.zones?.[playerId];
  if (!zone) {
    return 0;
  }
  if (typeof zone.handCount === 'number') {
    return zone.handCount;
  }
  return Array.isArray(zone.hand) ? zone.hand.length : 0;
}

function getPreparedCreaturesDiedThisTurn(state: any): number {
  const perController = state?.creaturesDiedThisTurnByController;
  if (perController && typeof perController === 'object') {
    return (Object.values(perController as Record<string, any>) as any[]).reduce((total: number, value: any) => {
      const numericValue = Number(value || 0);
      return total + (Number.isFinite(numericValue) ? numericValue : 0);
    }, 0);
  }

  return state?.creatureDiedThisTurn ? 1 : 0;
}

function isPreparedStateChangeConditionSatisfied(
  state: any,
  controller: PlayerID,
  description: string,
  referencedPermanent: any | null,
): boolean {
  const normalizedDescription = String(description || '').replace(/[â€™]/g, "'").toLowerCase();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  if (normalizedDescription.includes('if an opponent controls more creatures than you')) {
    const yourCreatureCount = battlefield.filter((entry: any) =>
      entry &&
      String(entry?.controller || '') === String(controller) &&
      String(entry?.card?.type_line || '').toLowerCase().includes('creature')
    ).length;

    return (Array.isArray(state?.players) ? state.players : []).some((player: any) => {
      const playerId = String(player?.id || '');
      if (!playerId || playerId === String(controller) || player?.hasLost) {
        return false;
      }
      const opponentCreatureCount = battlefield.filter((entry: any) =>
        entry &&
        String(entry?.controller || '') === playerId &&
        String(entry?.card?.type_line || '').toLowerCase().includes('creature')
      ).length;
      return opponentCreatureCount > yourCreatureCount;
    });
  }

  if (normalizedDescription.includes('if there are three or more creature cards in your graveyard')) {
    const graveyard = Array.isArray(state?.zones?.[controller]?.graveyard) ? state.zones[controller].graveyard : [];
    const creatureCards = graveyard.filter((card: any) => String(card?.type_line || '').toLowerCase().includes('creature'));
    return creatureCards.length >= 3;
  }

  if (normalizedDescription.includes('if there are three or more artifact and/or creature cards in your graveyard')) {
    const graveyard = Array.isArray(state?.zones?.[controller]?.graveyard) ? state.zones[controller].graveyard : [];
    const relevantCards = graveyard.filter((card: any) => {
      const typeLine = String(card?.type_line || '').toLowerCase();
      return typeLine.includes('artifact') || typeLine.includes('creature');
    });
    return relevantCards.length >= 3;
  }

  if (normalizedDescription.includes('if that creature has power 7 or greater')) {
    return Boolean(referencedPermanent) && getEffectivePower(referencedPermanent) >= 7;
  }

  const lifeGainThresholdMatch = normalizedDescription.match(/if you(?:'ve| have)? gained ([a-z0-9]+) or more life this turn/);
  if (lifeGainThresholdMatch) {
    const threshold = parsePreparedConditionCountToken(lifeGainThresholdMatch[1]);
    if (threshold === null) {
      return true;
    }
    const lifeGainedThisTurn = Number(state?.lifeGainedThisTurn?.[controller] || 0);
    return lifeGainedThisTurn >= threshold;
  }

  if (normalizedDescription.includes('if you gained life this turn')) {
    return Number(state?.lifeGainedThisTurn?.[controller] || 0) > 0;
  }

  const landsThresholdMatch = normalizedDescription.match(/if you control ([a-z0-9]+) or more lands/);
  if (landsThresholdMatch) {
    const threshold = parsePreparedConditionCountToken(landsThresholdMatch[1]);
    if (threshold === null) {
      return true;
    }

    const controlledLands = battlefield.filter((entry: any) =>
      entry &&
      String(entry?.controller || '') === String(controller) &&
      String(entry?.card?.type_line || '').toLowerCase().includes('land')
    ).length;
    return controlledLands >= threshold;
  }

  const handThresholdMatch = normalizedDescription.match(/if a player has ([a-z0-9]+) or (?:fewer|less) cards? in hand/);
  if (handThresholdMatch) {
    const threshold = parsePreparedConditionCountToken(handThresholdMatch[1]);
    if (threshold === null) {
      return true;
    }

    const playerIds = Array.from(new Set([
      ...(Array.isArray(state?.players) ? state.players.map((player: any) => String(player?.id || '')).filter(Boolean) : []),
      ...Object.keys(state?.zones || {}),
    ]));
    return playerIds.some((playerId) => getPreparedHandCount(state, playerId) <= threshold);
  }

  if (normalizedDescription.includes('if an opponent has more cards in hand than you')) {
    const yourHandCount = getPreparedHandCount(state, String(controller));
    return (Array.isArray(state?.players) ? state.players : []).some((player: any) => {
      const playerId = String(player?.id || '');
      if (!playerId || playerId === String(controller) || player?.hasLost) {
        return false;
      }
      return getPreparedHandCount(state, playerId) > yourHandCount;
    });
  }

  const creaturesDiedThresholdMatch = normalizedDescription.match(/if ([a-z0-9]+) or more creatures died this turn/);
  if (creaturesDiedThresholdMatch) {
    const threshold = parsePreparedConditionCountToken(creaturesDiedThresholdMatch[1]);
    if (threshold === null) {
      return true;
    }
    return getPreparedCreaturesDiedThisTurn(state) >= threshold;
  }

  return true;
}

export function maybeApplyPreparedStateChange(
  ctx: GameContext,
  controller: PlayerID,
  description: string,
  triggerItem: any,
  sourcePermanent?: any,
): boolean {
  const state = (ctx as any)?.state;
  if (!state) {
    return false;
  }

  const normalizedDescription = String(description || '').replace(/[â€™]/g, "'").toLowerCase();
  if (!normalizedDescription.includes('becomes prepared') && !normalizedDescription.includes('becomes unprepared')) {
    return false;
  }

  const affectedPermanent = resolvePreparedTargetPermanent(state, normalizedDescription, triggerItem, sourcePermanent);
  if (!affectedPermanent) {
    return true;
  }

  if (normalizedDescription.includes('becomes unprepared')) {
    clearPreparedPermanent(state, affectedPermanent);
    return true;
  }

  if (!isPreparedStateChangeConditionSatisfied(state, controller, normalizedDescription, affectedPermanent)) {
    return true;
  }

  setPermanentPrepared(state, affectedPermanent);
  return true;
}
