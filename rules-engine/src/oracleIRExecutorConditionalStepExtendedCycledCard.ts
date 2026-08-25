// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: leftover evaluateExtendedConditionalClause starting at
//   `you've cycled a card named this permanent four or more times this game`.
// Public entry symbol: tryEvaluateExtendedCycledCardClause.

import type { PlayerID } from '../../shared/src';
import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  anyCreatureAttackedThisTurn,
  antecedentApplied,
  contextualCardsFrom,
  controlledCreatures,
  countBasicLandTypesAmongLandsYouControl,
  countControlledMatchingDescriptor,
  countCreaturesControlledBy,
  countExiledCardsWithSource,
  discardedCardsFrom,
  evaluateAlternateCostPaidCondition,
  getConditionalSubjectCard,
  getCreaturePower,
  getDieRollResult,
  getLastAntecedentCreaturePower,
  getPlayerHandCount,
  getPlayerPoisonCount,
  getReferencedObject,
  getSourceCounterCount,
  getStackItemTargetCount,
  isNonbasicLand,
  isPermanentAttacking,
  milledCardsFrom,
  movedCardsFrom,
  objectHasType,
  parseSmallNumberWord,
  permanentHasExiledCards,
  sourceDealtDamageToOpponentThisTurn,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState, getCounterCountOnObject } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';

export function tryEvaluateExtendedCycledCardClause(params: ExtendedConditionalParams): boolean | null {
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

  if (normalizedRaw === "you've cycled a card named this permanent four or more times this game") {
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const cyclesByName = (nextState as any)?.cyclesByCardName?.[controllerId] as Record<string, number> | undefined;
    const count = Number(cyclesByName?.[sourceName] ?? (nextState as any)?.cyclesThisGame?.[controllerId] ?? 0);
    return Number.isFinite(count) ? count >= 4 : false;
  }

  if (normalizedRaw === 'a player does either') {
    return Boolean((ctx as any)?.playerChoseEither ?? (nextState as any)?.playerChoseEither);
  }

  if (normalizedRaw === 'that creature shares a color with the mana that land produced') {
    const ref = getReferencedObject(nextState, ctx);
    const produced = String((ctx as any)?.lastManaProducedColors?.[0] || ctx.selectorContext?.chosenMana || 'R')
      .replace(/[{}]/g, '')
      .trim()
      .toUpperCase();
    const colorMap: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
    const producedColor = colorMap[produced] || produced.toLowerCase();
    const colors = ((ref as any)?.colors || (ref as any)?.card?.colors || []) as string[];
    return colors.some(color => String(color).toLowerCase() === producedColor);
  }

  if (normalizedRaw === "that creature's power is 2 or less or if you control another lizard") {
    const ref = getReferencedObject(nextState, ctx);
    const lowPower = ref ? getCreaturePower(ref) <= 2 : false;
    const lizards = countControlledMatchingDescriptor(nextState, controllerId, 'lizard');
    return lowPower || lizards >= 2;
  }

  if (normalizedRaw === 'you reveal a card named hammer of this permanent this way') {
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const hammerName = sourceName ? `hammer of ${sourceName}` : '';
    const revealed = contextualCardsFrom(params);
    return hammerName
      ? revealed.some(
          card => String(card?.name || card?.card?.name || '').trim().toLowerCase() === hammerName
        )
      : false;
  }

  if (normalizedRaw === 'the result is greater than the damage dealt or the result is 12') {
    const rolled = getDieRollResult(nextState, controllerId);
    const damage = Number(ctx.referenceAmount ?? (nextState as any)?.lastDamageDealtThisWay ?? 0);
    return rolled !== null ? rolled > damage || rolled === 12 : false;
  }

  if (normalizedRaw === 'none of those creatures attacked you') {
    const attackedYou = (nextState as any)?.attackedDefendingPlayersThisCombatByPlayer as
      | Record<string, string[]>
      | undefined;
    if (!attackedYou) return true;
    return !Object.values(attackedYou).some(defenders =>
      Array.isArray(defenders) && defenders.includes(controllerId)
    );
  }

  if (normalizedRaw === 'a dinosaur is dealt damage this way') {
    const damaged = (ctx as any)?.lastDamagedCards ?? movedCardsFrom(params);
    const cards = Array.isArray(damaged) ? damaged : [];
    return cards.some(card => objectHasType(card, 'dinosaur'));
  }

  if (normalizedRaw === 'each opponent who has three or more poison counters') {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      return playerId && playerId !== controllerId && getPlayerPoisonCount(nextState, playerId) >= 3;
    });
  }

  if (normalizedRaw === 'that player has more cards in hand than each other player') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const targetHand = getPlayerHandCount(nextState, targetId as PlayerID);
    return (nextState.players || []).every((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === targetId) return true;
      return targetHand > getPlayerHandCount(nextState, playerId as PlayerID);
    });
  }


  if (normalizedRaw === 'a rat is attacking') {
    return (getProcessedBattlefield(nextState) as any[]).some(
      (perm: any) =>
        isPermanentAttacking(perm) &&
        (getExecutorTypeLineLower(perm).includes('rat') || objectHasType(perm, 'rat'))
    );
  }

  if (normalizedRaw === 'no creatures attacked this turn') {
    return !anyCreatureAttackedThisTurn(nextState);
  }

  if (normalizedRaw === "it hasn't dealt damage yet" || normalizedRaw === 'it has not dealt damage yet') {
    const source =
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      ) ?? getReferencedObject(nextState, ctx);
    if (!source) return null;
    if ((source as any)?.hasDealtDamage === true || (source as any)?.dealtDamageThisTurn === true) {
      return false;
    }
    if ((source as any)?.hasDealtDamage === false) return true;
    const sourceId = String((source as any)?.id || ctx.sourceId || '').trim();
    const damage = Number(
      (source as any)?.damageDealtThisTurn ??
        (sourceId ? (nextState as any)?.damageDealtThisTurnBySource?.[sourceId] : NaN) ??
        0
    );
    return Number.isFinite(damage) && damage > 0 ? false : true;
  }

  if (
    normalizedRaw === 'this creature dealt damage to an opponent this turn' ||
    normalizedRaw === 'this permanent dealt damage to an opponent this turn'
  ) {
    const source =
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      ) ?? getReferencedObject(nextState, ctx);
    const sourceId = String((source as any)?.id || ctx.sourceId || '').trim();
    if (!sourceId) return null;
    if ((source as any)?.dealtDamageToOpponentThisTurn === true) return true;
    if ((source as any)?.dealtDamageToOpponentThisTurn === false) return false;
    const tracked = sourceDealtDamageToOpponentThisTurn(nextState, controllerId, sourceId);
    if (tracked !== null) return tracked;
    return Boolean((source as any)?.dealtDamageThisTurn);
  }

  if (normalizedRaw === 'that player had another land enter the battlefield under their control this turn') {
    const targetId = String(
      ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim();
    const map = (nextState as any)?.landsEnteredBattlefieldThisTurn;
    if (map && typeof map === 'object') {
      return Number((map as Record<string, unknown>)[targetId] ?? 0) >= 2;
    }
    const enteredCount = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => {
      if (String(perm?.controller || '').trim() !== targetId) return false;
      const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
      if (!/\bland\b/i.test(typeLine)) return false;
      return Boolean(perm?.enteredThisTurn);
    }).length;
    if (enteredCount >= 2) return true;
    return enteredCount === 0 ? false : null;
  }

  {
    const mvLteTotalPowerMatch = normalizedRaw.match(
      /^its mana value is less than or equal to their total power$/
    );
    if (mvLteTotalPowerMatch) {
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      const totalPower = controlledCreatures(nextState, controllerId).reduce(
        (sum, perm) => sum + getCreaturePower(perm),
        0
      );
      return mv !== null ? mv <= totalPower : false;
    }
  }

  if (normalizedRaw === 'it exploited that creature') {
    return Boolean((ctx as any)?.exploitedThisResolution ?? (nextState as any)?.lastExploitedThisResolution);
  }

  if (normalizedRaw === 'this permanent has three or more lore counters on it') {
    return getSourceCounterCount(nextState, ctx, 'lore') >= 3;
  }

  if (normalizedRaw === 'this enchantment has three or more invitation counters on it') {
    return getSourceCounterCount(nextState, ctx, 'invitation') >= 3;
  }

  if (normalizedRaw === 'this is the fourth time this ability has resolved this turn') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const count = Number(
      (nextState as any)?.abilityResolveCountThisTurn?.[sourceId] ??
        (ctx as any)?.abilityResolveCountThisTurn ??
        0
    );
    return Number.isFinite(count) ? count >= 4 : false;
  }

  {
    const toughnessGteMatch = normalizedRaw.match(/^that creature has toughness (\d+) or greater$/);
    if (toughnessGteMatch) {
      const threshold = Number.parseInt(String(toughnessGteMatch[1] || ''), 10);
      const ref = getReferencedObject(nextState, ctx);
      const toughnessValue = Number((ref as any)?.effectiveToughness ?? (ref as any)?.toughness ?? (ref as any)?.card?.toughness);
      const toughness = Number.isFinite(toughnessValue) ? toughnessValue : null;
      return toughness !== null && Number.isFinite(threshold) ? toughness >= threshold : false;
    }
  }

  if (normalizedRaw === 'those creatures have total power 8 or greater') {
    const totalPower = controlledCreatures(nextState, controllerId).reduce(
      (sum, perm) => sum + getCreaturePower(perm),
      0
    );
    return totalPower >= 8;
  }

  if (normalizedRaw === 'if no one does' || normalizedRaw === 'no one does') {
    return false;
  }

  if (normalizedRaw === 'the exploited creature had power 3 or greater') {
    const power = Number((ctx as any)?.lastExploitedCreaturePower ?? getLastAntecedentCreaturePower(params));
    return Number.isFinite(power) ? power >= 3 : false;
  }

  if (
    normalizedRaw ===
    'its mana value is less than or equal to the number of basic land types among lands you control'
  ) {
    const card = getConditionalSubjectCard(params);
    const mv = card ? getCardManaValue((card as any)?.card || card) : null;
    const landTypes = countBasicLandTypesAmongLandsYouControl(nextState, controllerId);
    return mv !== null ? mv <= landTypes : false;
  }

  if (normalizedRaw === "you can't sacrifice a creature") {
    return countCreaturesControlledBy(nextState, controllerId) === 0;
  }

  if (normalizedRaw === "that creature wasn't dealt damage this turn") {
    const ref = getReferencedObject(nextState, ctx);
    const refId = String((ref as any)?.id || ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const damagedMap = (nextState as any)?.damageDealtToPermanentThisTurn as Record<string, number> | undefined;
    return refId ? Number(damagedMap?.[refId] || 0) === 0 : false;
  }

  if (normalizedRaw === 'the creature had power 4 or greater') {
    const power = getLastAntecedentCreaturePower(params);
    return power !== null ? power >= 4 : false;
  }

  {
    const anotherPowerMatch = normalizedRaw.match(
      /^you control another creature with power (four|[a-z0-9]+) or greater$/i
    );
    if (anotherPowerMatch) {
      const threshold = parseSmallNumberWord(String(anotherPowerMatch[1] || ''));
      if (threshold === null) return null;
      const sourceId = String(ctx.sourceId || '').trim();
      return controlledCreatures(nextState, controllerId).some((perm) => {
        if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
        return getCreaturePower(perm) >= threshold;
      });
    }
  }

  if (normalizedRaw === 'you control another creature with a +1/+1 counter on it') {
    const sourceId = String(ctx.sourceId || '').trim();
    return controlledCreatures(nextState, controllerId).some((perm) => {
      if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
      return (getCounterCountOnObject(perm, '+1/+1') ?? 0) > 0;
    });
  }

  {
    const namedCreaturesAndMatch = normalizedRaw.match(/^you control creatures named (.+?) and (.+?)$/i);
    if (namedCreaturesAndMatch) {
      const nameA = String(namedCreaturesAndMatch[1] || '').trim().toLowerCase();
      const nameB = String(namedCreaturesAndMatch[2] || '').trim().toLowerCase();
      if (!nameA || !nameB) return null;
      const controlled = controlledCreatures(nextState, controllerId);
      const hasNamed = (targetName: string): boolean =>
        controlled.some(
          (perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === targetName
        );
      return hasNamed(nameA) && hasNamed(nameB);
    }
  }

  if (normalizedRaw === "it's attacking a battle") {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref || !isPermanentAttacking(ref)) return false;
    const attackedId = String((ref as any)?.attackingPermanentId || (ref as any)?.attackedPermanentId || '').trim();
    if (!attackedId) return false;
    const attacked = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attackedId);
    return attacked ? objectHasType(attacked, 'battle') : false;
  }

  if (normalizedRaw === 'the player mills at least one creature card this way') {
    const milled = milledCardsFrom(ctx);
    return milled.some(card => objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'a spell or ability an opponent controls causes you to discard this card') {
    return Boolean((ctx as any)?.discardedByOpponentControlledSource ?? (nextState as any)?.discardedByOpponent);
  }

  if (normalizedRaw === 'a creature card was discarded this way') {
    const discarded = discardedCardsFrom(params);
    return discarded.some(card => objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'a noncreature card was discarded this way') {
    const discarded = discardedCardsFrom(params);
    return discarded.some(card => !objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'that creature had power 2 or less') {
    const power = getLastAntecedentCreaturePower(params);
    return power !== null ? power <= 2 : false;
  }

  {
    const mvLteMatch = normalizedRaw.match(/^its mana value is (\d+) or less$/);
    if (mvLteMatch) {
      const threshold = Number.parseInt(String(mvLteMatch[1] || ''), 10);
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      return mv !== null && Number.isFinite(threshold) ? mv <= threshold : false;
    }
    const mvWasLteMatch = normalizedRaw.match(/^its mana value was (\d+) or less$/);
    if (mvWasLteMatch) {
      const threshold = Number.parseInt(String(mvWasLteMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      if (params.lastActionOutcome?.stepKind !== 'destroy' || params.lastActionOutcome?.kind !== 'applied') {
        return false;
      }
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      return mv !== null ? mv <= threshold : false;
    }
  }

  if (normalizedRaw === 'any of those results was 10 or higher') {
    const results = (nextState as any)?.lastDieRollResults?.[controllerId];
    if (Array.isArray(results) && results.length > 0) {
      return results.some((value: unknown) => Number(value) >= 10);
    }
    const rolled = getDieRollResult(nextState, controllerId);
    return rolled !== null ? rolled >= 10 : false;
  }

  if (normalizedRaw === 'the card a player revealed has the name they chose') {
    const chosen = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
    const revealed = movedCardsFrom(params);
    return chosen
      ? revealed.some(card => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosen)
      : false;
  }

  if (normalizedRaw === 'a counter was put on this permanent this turn') {
    return Boolean(
      (nextState as any)?.counterPutOnSourceThisTurn?.[String(ctx.sourceId || 'bf-source')] ??
        getSourceCounterCount(nextState, ctx, '+1/+1') > 0
    );
  }

  if (normalizedRaw === 'two creatures are put onto the battlefield this way') {
    const moved = movedCardsFrom(params);
    const creatureCount = moved.filter(card => objectHasType(card, 'creature')).length;
    return antecedentApplied(lastActionOutcome, ['move_zone', 'create_token'])
      ? creatureCount >= 2 || Number(lastActionOutcome?.count || 0) >= 2
      : false;
  }

  if (normalizedRaw === 'there are no cards exiled with this enchantment') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    return countExiledCardsWithSource(nextState, sourceId) === 0;
  }

  if (normalizedRaw === 'a card is exiled with it') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId && countExiledCardsWithSource(nextState, sourceId) > 0) return true;
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!source) return sourceId ? false : null;
    const resolvedSourceId = String((source as any)?.id || sourceId).trim();
    return permanentHasExiledCards(source, nextState, resolvedSourceId);
  }

  if (normalizedRaw === 'it has a single target') {
    const count = getStackItemTargetCount(nextState, ctx);
    return count === null ? null : count === 1;
  }

  if (normalizedRaw === 'that land was nonbasic') {
    const moved = movedCardsFrom(params);
    const land =
      getReferencedObject(nextState, ctx) ??
      moved.find((card) => objectHasType(card, 'land')) ??
      moved[0];
    if (!land) return null;
    return isNonbasicLand(land);
  }

  {
    const alternateCostPaid = evaluateAlternateCostPaidCondition(normalizedRaw, ctx);
    if (alternateCostPaid !== null) return alternateCostPaid;
  }

  if (normalizedRaw === 'this spell was foretold' || normalizedRaw === 'it was foretold') {
    if ((ctx as any)?.foretold === true || (ctx as any)?.spellWasForetold === true) return true;
    return false;
  }

  if (normalizedRaw === 'the buyback cost was paid') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return Boolean(
      (source as any)?.buybackPaid ??
        (source as any)?.paidBuyback ??
        (nextState as any)?.buybackPaid?.[controllerId]
    );
  }
  return null;
}
