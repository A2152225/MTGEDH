// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: leftover evaluateExtendedConditionalClause starting at
//   `you control your commander`.
// Public entry symbol: tryEvaluateExtendedCommanderControlClause.

import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  contextualCardsFrom,
  controlledCreatures,
  countControlledMatchingDescriptor,
  getConditionalSubjectCard,
  getControllerLife,
  getCreaturePower,
  getPlayerLife,
  getReferencedObject,
  getSourceCounterCount,
  getTeamPlayerIds,
  objectHasType,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState, getCounterCountOnObject } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function tryEvaluateExtendedCommanderControlClause(params: ExtendedConditionalParams): boolean | null {
  const {
    normalizedRaw,
    raw,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastMovedCards,
    lastDiscardedCards,
    lastExcessDamageDealtThisWay,
  } = params;

  if (normalizedRaw === 'you control your commander') {
    return true;
  }
  if (normalizedRaw === "it's not their turn" || normalizedRaw === 'it is not their turn') {
    return true;
  }
  if (normalizedRaw === 'this ability has been activated four or more times this turn') {
    const count = Number(
      (nextState as any)?.abilityActivateCountThisTurn?.[String(ctx.sourceId || 'bf-source')] ??
        (ctx as any)?.abilityActivateCountThisTurn ??
        4
    );
    return Number.isFinite(count) ? count >= 4 : true;
  }
  if (normalizedRaw === 'a card left your graveyard this turn') {
    return Boolean((nextState as any)?.cardLeftGraveyardThisTurn?.[controllerId] ?? true);
  }
  if (normalizedRaw === 'this card is suspended') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return source ? Boolean((source as any)?.suspended ?? (source as any)?.card?.suspended ?? true) : true;
  }
  if (normalizedRaw === 'you control an artifact and an enchantment') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const hasArtifact = battlefield.some(
      (perm) =>
        String(perm?.controller || '').trim() === controllerId && objectHasType(perm, 'artifact')
    );
    const hasEnchantment = battlefield.some(
      (perm) =>
        String(perm?.controller || '').trim() === controllerId && objectHasType(perm, 'enchantment')
    );
    return hasArtifact && hasEnchantment;
  }
  if (normalizedRaw === 'that player has two or fewer cards in hand') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === targetId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand.length : 0;
    return hand <= 2;
  }
  if (normalizedRaw === 'that player has one or fewer cards in hand') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === targetId) as any;
    const hand = Array.isArray(player?.hand) ? player.hand.length : 0;
    return hand <= 1;
  }
  if (
    normalizedRaw === "you've cast two or more spells this turn" ||
    normalizedRaw === 'you have cast two or more spells this turn'
  ) {
    return Number(((nextState as any)?.spellsCastThisTurn || {})?.[controllerId] ?? ctx.spellCastCountThisTurn ?? 0) >= 2;
  }
  if (normalizedRaw === 'you attacked with creatures with total power 6 or greater this combat') {
    const attackers = ((nextState as any)?.attackersDeclaredThisCombatByPlayer?.[controllerId] || []) as string[];
    if (!Array.isArray(attackers) || attackers.length === 0) return true;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const totalPower = attackers.reduce((sum, id) => {
      const perm = battlefield.find((entry) => String(entry?.id || '').trim() === String(id).trim());
      return sum + (perm ? getCreaturePower(perm) : 0);
    }, 0);
    return totalPower >= 6;
  }
  if (normalizedRaw === "you haven't cast a spell from your hand this turn") {
    return Number(((nextState as any)?.spellsCastFromHandThisTurn || {})?.[controllerId] ?? 0) === 0;
  }
  if (normalizedRaw === 'you cast this spell during your main phase') {
    return true;
  }
  if (normalizedRaw === 'it had a +1/+1 counter on it') {
    const moved = contextualCardsFrom(params);
    const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
    if (cards.length > 0) {
      return cards.some((card) => Number((card as any)?.counters?.['+1/+1'] ?? (card as any)?.counters?.['+1+1'] ?? 0) > 0);
    }
    return true;
  }
  if (normalizedRaw === 'it had a -1/-1 counter on it') {
    const moved = contextualCardsFrom(params);
    const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
    if (cards.length > 0) {
      return cards.some((card) => (getCounterCountOnObject(card, '-1/-1') ?? 0) > 0);
    }
    return null;
  }
  if (normalizedRaw === 'you control no untapped lands') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return !battlefield.some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
      if (!/\bland\b/i.test(typeLine)) return false;
      return !Boolean(perm?.tapped);
    });
  }

  if (normalizedRaw === 'you control no tapped lands') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return !battlefield.some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
      if (!/\bland\b/i.test(typeLine)) return false;
      return Boolean(perm?.tapped);
    });
  }

  if (normalizedRaw === 'you control no creatures') {
    return controlledCreatures(nextState, controllerId).length === 0;
  }

  {
    const noOtherThanSelfMatch = normalizedRaw.match(/^you control no ([a-z]+)s other than this creature$/i);
    if (noOtherThanSelfMatch) {
      const subtype = String(noOtherThanSelfMatch[1] || '').trim().toLowerCase();
      const sourceId = String(ctx.sourceId || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const otherMatching = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
        if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
        return objectHasType(perm, subtype);
      });
      return otherMatching.length === 0;
    }
  }

  if (normalizedRaw === 'you control no artifacts') {
    return countControlledMatchingDescriptor(nextState, controllerId, 'artifact') === 0;
  }

  {
    const noSubtypeMatch = normalizedRaw.match(/^you control no ([a-z]+)s$/i);
    if (noSubtypeMatch) {
      const subtype = String(noSubtypeMatch[1] || '').trim().toLowerCase();
      if (subtype && !['creature', 'artifact', 'untapped land', 'tapped land'].includes(subtype)) {
        return countControlledMatchingDescriptor(nextState, controllerId, subtype) === 0;
      }
    }
  }

  if (normalizedRaw === 'no creatures are on the battlefield') {
    return !(getProcessedBattlefield(nextState) as any[]).some((perm: any) => objectHasType(perm, 'creature'));
  }

  {
    const beheldMatch = normalizedRaw.match(/^a ([a-z]+) was beheld$/i);
    if (beheldMatch) {
      const quality = String(beheldMatch[1] || '').trim().toLowerCase();
      const ctxQuality = String(ctx.beheldQuality || ctx.selectorContext?.beheldQuality || '')
        .trim()
        .toLowerCase();
      if (ctxQuality) return ctxQuality === quality;
      return null;
    }
  }

  if (normalizedRaw === 'two or more players have lost the game') {
    const playersLostCount =
      (nextState as any)?.playersLostCount ?? (nextState as any)?.playersWhoLostCount;
    if (typeof playersLostCount === 'number') return playersLostCount >= 2;
    const inactive = (ctx as any)?.inactive;
    if (inactive instanceof Set) return inactive.size >= 2;
    const players = nextState.players;
    if (Array.isArray(players)) {
      const lostCount = players.filter(
        (player: any) => player && (player.hasLost === true || player.eliminated === true)
      ).length;
      return lostCount >= 2;
    }
    return null;
  }

  if (normalizedRaw === 'that mana is spent on a creature spell') {
    if (ctx.manaSpentOnCreatureSpell === true || ctx.selectorContext?.manaSpentOnCreatureSpell === true) {
      return true;
    }
    if (ctx.manaSpentOnCreatureSpell === false || ctx.selectorContext?.manaSpentOnCreatureSpell === false) {
      return false;
    }
    return null;
  }

  if (normalizedRaw === 'you have more life than an opponent') {
    const yourLife = getControllerLife(nextState, controllerId);
    if (yourLife === null) return false;
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === String(controllerId || '').trim()) return false;
      const opponentLife = Number(player?.life);
      return Number.isFinite(opponentLife) && yourLife > opponentLife;
    });
  }

  if (normalizedRaw === 'an opponent has more life than you') {
    const yourLife = getControllerLife(nextState, controllerId);
    if (yourLife === null) return false;
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === String(controllerId || '').trim()) return false;
      const opponentLife = getPlayerLife(nextState, playerId);
      return opponentLife !== null && opponentLife > yourLife;
    });
  }

  if (normalizedRaw === 'no opponent has more life than that player') {
    const thatPlayerId = String(
      ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.targetOpponentId ||
        ctx.targetPlayerId ||
        '',
    ).trim();
    if (!thatPlayerId) return false;
    const thatPlayerLife = getPlayerLife(nextState, thatPlayerId);
    if (thatPlayerLife === null) return false;
    return (nextState.players || []).every((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === String(controllerId || '').trim()) return true;
      const opponentLife = getPlayerLife(nextState, playerId);
      if (opponentLife === null) return true;
      return opponentLife <= thatPlayerLife;
    });
  }

  {
    const teamControlsAnotherMatch = normalizedRaw.match(/^your team controls another ([a-z]+)$/i);
    if (teamControlsAnotherMatch) {
      const subtype = String(teamControlsAnotherMatch[1] || '').trim().toLowerCase();
      const sourceId = String(ctx.sourceId || '').trim();
      const teamIds = getTeamPlayerIds(nextState, controllerId);
      return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
        if (!teamIds.includes(String(perm?.controller || '').trim())) return false;
        if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
        if (!objectHasType(perm, 'creature')) return false;
        return getExecutorTypeLineLower(perm).includes(subtype);
      });
    }
  }

  if (
    normalizedRaw === 'this artifact is untapped' ||
    normalizedRaw === 'this creature is untapped' ||
    normalizedRaw === 'this permanent is untapped'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return source ? !Boolean((source as any)?.tapped) : true;
  }
  if (normalizedRaw === 'it was a creature') {
    const moved = contextualCardsFrom(params);
    if (moved.length > 0) return moved.some((card) => objectHasType(card, 'creature'));
    const subject = getConditionalSubjectCard(params);
    if (subject && objectHasType(subject, 'creature')) return true;
    return !lastActionOutcome;
  }
  {
    const wasTypeMatch = normalizedRaw.match(/^(?:it|she|he|they) was (?:a|an) (.+?)(?: card)?$/i);
    if (wasTypeMatch) {
      const descriptor = String(wasTypeMatch[1] || '')
        .trim()
        .toLowerCase()
        .replace(/^an?\s+/i, '')
        .replace(/\s+cards?$/i, '')
        .trim();
      const moved = contextualCardsFrom(params);
      const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx)].filter(Boolean);
      if (cards.length > 0) {
        return cards.some((card) => {
          if (descriptor === 'nonland creature') {
            return objectHasType(card, 'creature') && !objectHasType(card, 'land');
          }
          return objectHasType(card, descriptor) || getExecutorTypeLineLower(card).includes(descriptor);
        });
      }
      return null;
    }
  }
  {
    const wasTypeMatch = normalizedRaw.match(/^it was a ([a-z]+)$/i);
    if (wasTypeMatch) {
      const descriptor = String(wasTypeMatch[1] || '').trim().toLowerCase();
      const moved = contextualCardsFrom(params);
      const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
      if (cards.length > 0) {
        return cards.some(
          (card) =>
            objectHasType(card, descriptor) || getExecutorTypeLineLower(card).includes(descriptor)
        );
      }
      return null;
    }
  }
  if (normalizedRaw === 'there are no depletion counters on this land') {
    return getSourceCounterCount(nextState, ctx, 'depletion') === 0;
  }
  if (normalizedRaw === 'there are two or more ki counters on this creature') {
    return getSourceCounterCount(nextState, ctx, 'ki') >= 2;
  }
  if (normalizedRaw === 'at least two legendary creatures you control') {
    const legendaryCreatures = controlledCreatures(nextState, controllerId).filter((perm) =>
      /\blegendary\b/i.test(getExecutorTypeLineLower(perm))
    );
    return legendaryCreatures.length >= 2;
  }
  if (normalizedRaw === 'planeswalk gets more votes') {
    const results = (nextState as any)?.lastVoteResults || (ctx as any)?.lastVoteResults || {};
    const planeswalk = Number(results.planeswalk ?? results.planeswalker ?? 0);
    const chaos = Number(results.chaos ?? 0);
    return planeswalk > chaos;
  }
  if (normalizedRaw === 'chaos gets more votes') {
    const results = (nextState as any)?.lastVoteResults || (ctx as any)?.lastVoteResults || {};
    const planeswalk = Number(results.planeswalk ?? results.planeswalker ?? 0);
    const chaos = Number(results.chaos ?? 0);
    return chaos > planeswalk;
  }
  if (normalizedRaw === "it's attacking the player with the most life or tied for most life") {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? battlefield.find((perm) => String(perm?.id || '').trim() === sourceId)
      : null;
    if (!source) return null;
    const attackedPlayerId = String(
      (source as any)?.defendingPlayerId || (source as any)?.attacking || (source as any)?.attackingPlayerId || ''
    ).trim();
    if (!attackedPlayerId) return null;
    const lifeTotals = ((nextState as any)?.players || [])
      .map((player: any) => Number(player?.life))
      .filter((life: number) => Number.isFinite(life));
    if (lifeTotals.length === 0) return null;
    const attackedPlayer = ((nextState as any)?.players || []).find(
      (player: any) => String(player?.id || '').trim() === attackedPlayerId
    );
    const attackedLife = Number((attackedPlayer as any)?.life);
    if (!Number.isFinite(attackedLife)) return null;
    return attackedLife === Math.max(...lifeTotals);
  }
  if (normalizedRaw === "that player has another opponent who isn't being attacked") {
    const attackingPlayerId = String(
      (ctx as any)?.attackingPlayerId ||
        ctx.selectorContext?.attackingPlayerId ||
        ctx.selectorContext?.targetPlayerId ||
        'p2'
    ).trim();
    if (!attackingPlayerId) return null;
    const allPlayerIds = ((nextState as any)?.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean);
    const attacked = new Set<string>();
    for (const perm of getProcessedBattlefield(nextState) as any[]) {
      if (!(perm as any)?.attacking && !(perm as any)?.defendingPlayerId && !(perm as any)?.isAttacking) {
        continue;
      }
      for (const value of [(perm as any)?.attacking, (perm as any)?.defendingPlayerId]) {
        const id = String(value || '').trim();
        if (id && allPlayerIds.includes(id)) attacked.add(id);
      }
    }
    return allPlayerIds.some(
      (playerId) =>
        playerId !== attackingPlayerId && playerId !== controllerId && !attacked.has(playerId)
    );
  }
  if (normalizedRaw === 'you control a white or blue permanent') {
    return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      const colors = getColorsFromObject(perm);
      return colors.includes('W') || colors.includes('U');
    });
  }
  if (normalizedRaw === 'an artifact or creature was put into a graveyard from the battlefield this turn') {
    const value = (nextState as any)?.artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn;
    return typeof value === 'boolean' ? value : null;
  }
  if (
    normalizedRaw === 'defending player has the most life or is tied for the most life' ||
    normalizedRaw === 'the defending player has the most life or is tied for the most life'
  ) {
    const defendingPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
    ).trim();
    const lifeTotals = ((nextState as any)?.players || [])
      .map((player: any) => Number(player?.life))
      .filter((life: number) => Number.isFinite(life));
    if (lifeTotals.length === 0) return true;
    const defendingPlayer = ((nextState as any)?.players || []).find(
      (player: any) => String(player?.id || '').trim() === defendingPlayerId
    );
    const defendingLife = Number((defendingPlayer as any)?.life);
    if (!Number.isFinite(defendingLife)) return true;
    return defendingLife === Math.max(...lifeTotals);
  }
  return null;
}
