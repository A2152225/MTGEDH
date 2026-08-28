// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: leftover evaluateExtendedConditionalClause starting at
//   `its prowl cost was paid` through graveyard-has-flying.
// Public entry symbol: tryEvaluateExtendedProwlClause.

import type { PlayerID } from '../../shared/src';
import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import { EXILE_THIS_WAY_STEP_KINDS } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  antecedentApplied,
  controlledCreatures,
  controllerCastBothCreatureAndNoncreatureThisTurn,
  countBasicLandTypesAmongLandsYouControl,
  countControlledMatchingDescriptor,
  getConditionalSubjectCard,
  getControlledTypeEnteredThisTurnCount,
  getControllerLife,
  getCreaturePower,
  getCreatureToughness,
  getEnchantedCreatureFromAura,
  getGraveyardCards,
  getPlayerHandCount,
  getReferencedObject,
  getStackSpellCard,
  getStackSpellPower,
  isPermanentModified,
  movedCardsFrom,
  objectHasType,
  parseSmallNumberWord,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';

export function tryEvaluateExtendedProwlClause(params: ExtendedConditionalParams): boolean | null {
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

  if (normalizedRaw === 'its prowl cost was paid' || normalizedRaw === "this spell's prowl cost was paid") {
    const readProwlPaid = (candidate: any): boolean | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const altId =
        candidate?.alternateCostId ??
        candidate?.alternativeCost ??
        candidate?.card?.alternateCostId ??
        candidate?.card?.alternativeCost;
      if (typeof altId === 'string' && altId.length > 0) {
        return String(altId).toLowerCase() === 'prowl';
      }
      const raw =
        candidate?.prowlCostWasPaid ??
        candidate?.paidProwlCost ??
        candidate?.prowlPaid ??
        candidate?.castWithProwl ??
        candidate?.card?.prowlCostWasPaid ??
        candidate?.card?.paidProwlCost ??
        candidate?.card?.prowlPaid ??
        candidate?.card?.castWithProwl;
      return typeof raw === 'boolean' ? raw : null;
    };
    const source = getReferencedObject(nextState, ctx);
    const fromSource = readProwlPaid(source);
    if (typeof fromSource === 'boolean') return fromSource;
    const stackSpell = getStackSpellCard(nextState, ctx);
    const fromStack = readProwlPaid(stackSpell);
    if (typeof fromStack === 'boolean') return fromStack;
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    if (targetSpellId) {
      const stackItem = ((nextState as any)?.stack || []).find(
        (entry: any) => String(entry?.id || '').trim() === targetSpellId
      );
      const fromItem = readProwlPaid(stackItem);
      if (typeof fromItem === 'boolean') return fromItem;
    }
    if (typeof (ctx as any).prowlCostWasPaid === 'boolean') return (ctx as any).prowlCostWasPaid;
    return false;
  }
  if (normalizedRaw === 'the gift wasn\'t promised') {
    return ctx.giftPromised === true ? false : true;
  }
  if (normalizedRaw === 'they guessed right') {
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? guessCorrect : false;
  }
  if (normalizedRaw === 'they lose the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? !ctx.wonCoinFlip : false;
  }
  if (normalizedRaw === 'they match') {
    return false;
  }

  {
    const xThresholdMatch = normalizedRaw.match(/^x is (three|[a-z0-9]+) or more$/i);
    if (xThresholdMatch) {
      const threshold = parseSmallNumberWord(String(xThresholdMatch[1] || ''));
      const xValue = Number(ctx.xValue);
      if (threshold !== null && Number.isFinite(xValue)) return xValue >= threshold;
      return false;
    }
  }

  {
    const spellPowerMatch = normalizedRaw.match(/^that spell(?:'s)? power is (\d+) or greater$/i);
    if (spellPowerMatch) {
      const threshold = Number.parseInt(String(spellPowerMatch[1] || ''), 10);
      const power = getStackSpellPower(nextState, ctx);
      return Number.isFinite(threshold) && power !== null ? power >= threshold : false;
    }
  }

  {
    const permPowerMatch = normalizedRaw.match(/^this permanent(?:'s)? power is (\d+) or greater$/i);
    if (permPowerMatch) {
      const threshold = Number.parseInt(String(permPowerMatch[1] || ''), 10);
      const source = getReferencedObject(nextState, ctx);
      return source && Number.isFinite(threshold) ? getCreaturePower(source) >= threshold : false;
    }
  }
  if (normalizedRaw === 'this permanent has power 7 or greater') {
    const source = getReferencedObject(nextState, ctx);
    return source ? getCreaturePower(source) >= 7 : false;
  }

  if (normalizedRaw === 'its power is greater than each other creature\'s power') {
    const subject = getReferencedObject(nextState, ctx);
    if (!subject) return false;
    const subjectPower = getCreaturePower(subject);
    const others = (getProcessedBattlefield(nextState) as any[]).filter(
      (perm: any) => String(perm?.id || '') !== String((subject as any)?.id || '') && objectHasType(perm, 'creature')
    );
    return others.every((perm: any) => subjectPower > getCreaturePower(perm));
  }

  if (normalizedRaw === 'it has the greatest power or is tied for greatest power among creatures on the battlefield') {
    const subject = getReferencedObject(nextState, ctx);
    if (!subject) return false;
    const subjectPower = getCreaturePower(subject);
    const creatures = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => objectHasType(perm, 'creature'));
    const maxPower = Math.max(...creatures.map(getCreaturePower));
    return subjectPower >= maxPower;
  }

  if (normalizedRaw === 'you control the creature with the greatest toughness or tied for the greatest toughness') {
    const yours = controlledCreatures(nextState, controllerId);
    if (yours.length === 0) return false;
    const all = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => objectHasType(perm, 'creature'));
    const maxToughness = Math.max(...all.map(getCreatureToughness));
    return yours.some((perm: any) => getCreatureToughness(perm) >= maxToughness);
  }

  {
    const totalPowerMatch = normalizedRaw.match(/^creatures you control have total power (\d+) or greater$/i);
    if (totalPowerMatch) {
      const threshold = Number.parseInt(String(totalPowerMatch[1] || ''), 10);
      const total = controlledCreatures(nextState, controllerId).reduce((sum, perm) => sum + getCreaturePower(perm), 0);
      return Number.isFinite(threshold) ? total >= threshold : false;
    }
    const totalToughnessMatch = normalizedRaw.match(/^creatures you control have total toughness (\d+) or greater$/i);
    if (totalToughnessMatch) {
      const threshold = Number.parseInt(String(totalToughnessMatch[1] || ''), 10);
      const total = controlledCreatures(nextState, controllerId).reduce((sum, perm) => sum + getCreatureToughness(perm), 0);
      return Number.isFinite(threshold) ? total >= threshold : false;
    }
  }

  if (normalizedRaw === 'a creature died under your control this turn') {
    const byController = (nextState as any)?.creaturesDiedThisTurnByController?.[controllerId];
    return typeof byController === 'number' ? byController > 0 : Boolean((nextState as any)?.creatureDiedThisTurn);
  }
  if (normalizedRaw === 'they lost life this turn') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim();
    if (!targetId) return false;
    return Number(((nextState as any)?.lifeLostThisTurn || {})?.[targetId] || 0) > 0;
  }
  if (normalizedRaw === 'you lost life last turn') {
    const stateAny = nextState as any;
    const candidates = [
      stateAny?.lifeLostLastTurnByPlayerCounts,
      stateAny?.lifeLostLastTurnByPlayer,
      stateAny?.lifeLostLastTurn,
    ].filter((entry) => entry && typeof entry === 'object');
    for (const counts of candidates) {
      const raw = (counts as any)[controllerId];
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw > 0;
    }
    return null;
  }
  {
    const playerLostLifeMatch = normalizedRaw.match(/^a player lost ([a-z0-9]+) or more life this turn$/i);
    if (playerLostLifeMatch) {
      const threshold = parseSmallNumberWord(String(playerLostLifeMatch[1] || '').trim());
      if (threshold === null) return null;
      const map = (nextState as any)?.lifeLostThisTurn;
      if (!map || typeof map !== 'object') return null;
      return Object.values(map as Record<string, unknown>).some(
        (value) => typeof value === 'number' && value >= threshold
      );
    }
  }
  if (normalizedRaw === 'a player other than you lost life this turn') {
    const map = (nextState as any)?.lifeLostThisTurn || {};
    return Object.entries(map).some(([playerId, amount]) => playerId !== controllerId && Number(amount) > 0);
  }
  if (
    normalizedRaw === "you've cast a spell from a graveyard or activated an ability of a card in a graveyard this turn" ||
    normalizedRaw === "you've cast another blue spell this turn" ||
    normalizedRaw === "you've cast another spell this turn" ||
    normalizedRaw === 'you cast another spell this turn'
  ) {
    return Boolean((nextState as any)?.castFromGraveyardThisTurn?.[controllerId]) ||
      Number(((nextState as any)?.spellsCastThisTurn || {})?.[controllerId] ?? ctx.spellCastCountThisTurn ?? 0) > 1;
  }
  if (
    normalizedRaw === "you've cast both a creature spell and a noncreature spell this turn" ||
    normalizedRaw === 'you cast both a creature spell and a noncreature spell this turn' ||
    normalizedRaw === 'you have cast both a creature spell and a noncreature spell this turn'
  ) {
    return controllerCastBothCreatureAndNoncreatureThisTurn(nextState, controllerId);
  }
  if (normalizedRaw === 'a food entered under your control this turn') {
    return Boolean(((nextState as any)?.foodEnteredThisTurn || {})?.[controllerId]);
  }
  {
    const enteredThisTurnMatch = normalizedRaw.match(
      /^(a|an|another) (artifact|creature|enchantment|planeswalker|land|battle) entered the battlefield under your control this turn$/i
    );
    if (enteredThisTurnMatch) {
      const article = String(enteredThisTurnMatch[1] || '').trim().toLowerCase();
      const typeLower = String(enteredThisTurnMatch[2] || '').trim().toLowerCase();
      const excludeId = article === 'another' ? String(ctx.sourceId || '').trim() : undefined;
      const count = getControlledTypeEnteredThisTurnCount(nextState, controllerId, typeLower, excludeId);
      return count === null ? null : count > 0;
    }
  }
  if (normalizedRaw === 'it entered under your control') {
    const moved = Array.isArray(lastMovedCards) && lastMovedCards.length > 0
      ? lastMovedCards
      : Array.isArray(ctx.lastMovedCards)
        ? ctx.lastMovedCards
        : [];
    if (moved.length === 0) return null;
    const movedId = String((moved[0] as any)?.id || '').trim();
    if (!movedId) return null;
    const onBattlefield = ((nextState.battlefield || []) as any[]).find(
      (perm) =>
        String((perm as any)?.id || '').trim() === movedId ||
        String((perm as any)?.card?.id || '').trim() === movedId
    );
    if (onBattlefield) {
      return String((onBattlefield as any)?.controller || '').trim() === controllerId;
    }
    const owner = String((moved[0] as any)?.owner || controllerId).trim();
    return owner === controllerId;
  }
  if (normalizedRaw === 'you had two or more creatures enter the battlefield under your control this turn') {
    const count = Number(((nextState as any)?.creaturesEnteredThisTurn || {})?.[controllerId] || 0);
    return count >= 2;
  }
  if (normalizedRaw === 'you\'ve gained 3 or more life this turn') {
    return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) >= 3;
  }
  if (normalizedRaw === 'this permanent has dealt 3 or more damage this turn') {
    const source = getReferencedObject(nextState, ctx);
    const dealt = Number((source as any)?.damageDealtThisTurn ?? (nextState as any)?.damageDealtThisTurnBySource?.[String((source as any)?.id || ctx.sourceId || '')]);
    return Number.isFinite(dealt) ? dealt >= 3 : false;
  }

  if (normalizedRaw === 'you have 10 or less life') {
    const life = getControllerLife(nextState, controllerId);
    return life === null ? false : life <= 10;
  }
  if (normalizedRaw === 'you have nine or more cards in hand') {
    return getPlayerHandCount(nextState, controllerId) >= 9;
  }
  {
    const handThresholdMatch = normalizedRaw.match(
      /^you have (seven|nine|ten|eight|six|five|four|three|two|one|\d+) or more cards in hand$/i
    );
    if (handThresholdMatch) {
      const threshold = parseSmallNumberWord(String(handThresholdMatch[1] || ''));
      if (threshold !== null) {
        return getPlayerHandCount(nextState, controllerId) >= threshold;
      }
    }
  }
  if (normalizedRaw === 'you have fewer than three cards in hand') {
    return getPlayerHandCount(nextState, controllerId) < 3;
  }
  {
    const handFewerMatch = normalizedRaw.match(
      /^you have fewer than (seven|nine|ten|eight|six|five|four|three|two|one|\d+) cards in hand$/i
    );
    if (handFewerMatch) {
      const threshold = parseSmallNumberWord(String(handFewerMatch[1] || ''));
      if (threshold !== null) {
        return getPlayerHandCount(nextState, controllerId) < threshold;
      }
    }
  }
  if (normalizedRaw === 'you put a counter on a creature this turn') {
    const tracked =
      (nextState as any)?.putCounterOnCreatureThisTurn?.[controllerId] ??
      (nextState as any)?.placedCounterOnCreatureThisTurn?.[controllerId] ??
      (nextState as any)?.countersPlacedOnCreaturesThisTurn?.[controllerId] ??
      (ctx as any).putCounterOnCreatureThisTurn;
    return typeof tracked === 'boolean' ? tracked : false;
  }
  if (normalizedRaw === 'your library has no cards in it') {
    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
    return Array.isArray(player?.library) ? player.library.length === 0 : false;
  }
  if (normalizedRaw === 'there are twenty or more cards in your graveyard') {
    return getGraveyardCards(nextState, controllerId).length >= 20;
  }

  {
    const landControlMatch = normalizedRaw.match(
      /^you control (four|five|six|seven|eight|nine|ten|\d+|zero|one|two|three|eleven|twelve) or more lands$/i
    );
    if (landControlMatch) {
      const threshold = parseSmallNumberWord(String(landControlMatch[1] || ''));
      if (threshold === null) return null;
      const landCount = (nextState.battlefield || []).filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== controllerId) return false;
        return hasExecutorClass(perm, 'land');
      }).length;
      return landCount >= threshold;
    }
  }

  {
    const gyCreatureMatch = normalizedRaw.match(
      /^there are (three|four|five|six|seven|eight|nine|ten|\d+|zero|one|two) or more creature cards in your graveyard$/i
    );
    if (gyCreatureMatch) {
      const threshold = parseSmallNumberWord(String(gyCreatureMatch[1] || ''));
      if (threshold === null) return null;
      const creatureCards = getGraveyardCards(nextState, controllerId).filter((card: any) =>
        /\bcreature\b/i.test(String(card?.type_line || ''))
      );
      return creatureCards.length >= threshold;
    }
  }

  if (normalizedRaw === 'no life is lost this way') {
    const lost = Number(
      (ctx as any).lifeLostThisResolution ??
        (nextState as any).lifeLostThisResolution ??
        ((nextState as any).lifeLostThisTurn || {})?.[controllerId] ??
        -1
    );
    if (Number.isFinite(lost) && lost >= 0) return lost === 0;
    return false;
  }

  if (normalizedRaw === "you've done all four this turn") {
    const completed = Number(
      (nextState as any).modalActionsCompletedThisTurn?.[controllerId] ??
        (ctx as any).modalActionsCompletedCount ??
        0
    );
    return completed >= 4;
  }

  {
    const exchangeFailMatch = normalizedRaw.match(
      /^you don'?t or can'?t make an exchange(?:,\s*sacrifice .*)?$/i
    );
    if (exchangeFailMatch) {
      if (
        lastActionOutcome?.stepKind === 'exchange_control' &&
        lastActionOutcome?.kind === 'applied'
      ) {
        return false;
      }
      return Boolean((ctx as any).exchangeFailed);
    }
  }

  if (normalizedRaw === 'the creature deals damage to a creature this turn') {
    const sourceId = String(ctx.sourceId || '').trim();
    const dealtMap = (nextState as any)?.creatureDealtDamageToCreatureThisTurn;
    if (sourceId && typeof dealtMap?.[sourceId] === 'boolean') return dealtMap[sourceId];
    return false;
  }

  {
    const lifeCompareMatch = normalizedRaw.match(/^you have (\d+) or less life$/i);
    if (lifeCompareMatch) {
      const threshold = Number.parseInt(String(lifeCompareMatch[1] || ''), 10);
      const life = getControllerLife(nextState, controllerId);
      return life === null || !Number.isFinite(threshold) ? false : life <= threshold;
    }
  }

  {
    const lifeAtLeastMatch = normalizedRaw.match(/^you have ([\d,]+) or more life$/i);
    if (lifeAtLeastMatch) {
      const threshold = Number.parseInt(String(lifeAtLeastMatch[1] || '').replace(/,/g, ''), 10);
      const life = getControllerLife(nextState, controllerId);
      return life === null || !Number.isFinite(threshold) ? false : life >= threshold;
    }
  }

  if (normalizedRaw === 'your life total is greater than or equal to the last noted life total for this enchantment') {
    const life = getControllerLife(nextState, controllerId);
    const noted = Number((nextState as any)?.lastNotedLifeTotal?.[String(ctx.sourceId || 'bf-source')] ?? life);
    return life !== null && Number.isFinite(noted) ? life >= noted : false;
  }
  if (normalizedRaw === 'your life total is greater than your starting life total') {
    const life = getControllerLife(nextState, controllerId);
    const starting = Number((nextState as any)?.startingLife ?? 40);
    return life !== null ? life > starting : false;
  }
  if (normalizedRaw === 'your life total is less than or equal to half your starting life total') {
    const life = getControllerLife(nextState, controllerId);
    const starting = Number((nextState as any)?.startingLife ?? 40);
    return life !== null ? life <= starting / 2 : false;
  }

  {
    const lifeMoreThanStartingMatch = normalizedRaw.match(
      /^you have at least (\d+|fifteen|fourteen|thirteen|twelve|eleven|ten|[a-z]+) life more than your starting life total$/i
    );
    if (lifeMoreThanStartingMatch) {
      const threshold = parseSmallNumberWord(String(lifeMoreThanStartingMatch[1] || ''));
      const life = getControllerLife(nextState, controllerId);
      const starting = Number((nextState as any)?.startingLife ?? 40);
      if (life === null || threshold === null) return false;
      return life - starting >= threshold;
    }
  }

  {
    const opponentHandMatch = normalizedRaw.match(
      /^the player is your opponent and has (four|[a-z0-9]+) or more cards in hand$/
    );
    if (opponentHandMatch) {
      const threshold = parseSmallNumberWord(String(opponentHandMatch[1] || ''));
      const targetId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
      return threshold !== null ? getPlayerHandCount(nextState, targetId as PlayerID) >= threshold : false;
    }
  }

  {
    const controlCountMatch = normalizedRaw.match(/^you control (thirty|[a-z0-9]+) or more ([a-z0-9' -]+)$/i);
    if (controlCountMatch) {
      const threshold = parseSmallNumberWord(String(controlCountMatch[1] || ''));
      const descriptor = String(controlCountMatch[2] || '').trim();
      if (threshold !== null) return countControlledMatchingDescriptor(nextState, controllerId, descriptor) >= threshold;
    }
    if (normalizedRaw === 'you control all three') {
      return countControlledMatchingDescriptor(nextState, controllerId, 'permanent') >= 3;
    }
    const exactControlMatch = normalizedRaw.match(/^you control exactly (thirteen|[a-z0-9]+) permanents$/i);
    if (exactControlMatch) {
      const threshold = parseSmallNumberWord(String(exactControlMatch[1] || ''));
      const count = (getProcessedBattlefield(nextState) as any[]).filter(
        (perm: any) => String(perm?.controller || '').trim() === controllerId
      ).length;
      return threshold !== null ? count === threshold : false;
    }
  }

  if (normalizedRaw === 'there are five basic land types among lands you control') {
    return countBasicLandTypesAmongLandsYouControl(nextState, controllerId) >= 5;
  }
  {
    const basicLandTypesMatch = normalizedRaw.match(
      /^there are (three|four|five|six|seven|eight|nine|ten|\d+|zero|one|two) or more basic land types among lands you control$/i
    );
    if (basicLandTypesMatch) {
      const threshold = parseSmallNumberWord(String(basicLandTypesMatch[1] || ''));
      if (threshold === null) return null;
      return countBasicLandTypesAmongLandsYouControl(nextState, controllerId) >= threshold;
    }
  }
  {
    const landsOrTreefolkMatch = normalizedRaw.match(
      /^you control (seven|eight|nine|ten|\d+|zero|one|two|three|four|five|six|eleven|twelve) or more lands and\/or treefolk$/i
    );
    if (landsOrTreefolkMatch) {
      const threshold = parseSmallNumberWord(String(landsOrTreefolkMatch[1] || ''));
      if (threshold === null) return null;
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const count = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== controllerId) return false;
        return objectHasType(perm, 'land') || objectHasType(perm, 'treefolk');
      }).length;
      return count >= threshold;
    }
  }
  if (normalizedRaw === 'excess damage was dealt this way') {
    const excess = Number(params.lastExcessDamageDealtThisWay ?? (params.ctx as any)?.lastExcessDamageDealtThisWay ?? 0);
    return excess > 0;
  }
  if (normalizedRaw === 'that creature was dealt excess damage this turn') {
    const thatId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.targetPermanentId ||
        (ctx as any).thatCreatureId ||
        ''
    ).trim();
    if (thatId) {
      const perm = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, thatId);
      if (perm) {
        const onPerm = (perm as any)?.wasDealtExcessDamageThisTurn ?? (perm as any)?.excessDamageThisTurn;
        if (typeof onPerm === 'boolean') return onPerm;
        if (typeof onPerm === 'number') return onPerm > 0;
      }
      const map =
        (nextState as any)?.excessDamageThisTurnByCreatureId ??
        (nextState as any)?.excessDamageThisTurnByPermanentId;
      if (map && typeof map === 'object') {
        const tracked = (map as any)[thatId];
        if (typeof tracked === 'boolean') return tracked;
        if (typeof tracked === 'number') return tracked > 0;
        if (Object.prototype.hasOwnProperty.call(map, thatId)) return false;
      }
    }
    if (typeof (ctx as any)?.thatCreatureDealtExcessDamageThisTurn === 'boolean') {
      return (ctx as any).thatCreatureDealtExcessDamageThisTurn;
    }
    return null;
  }
  if (normalizedRaw === "you don't control a faerie") {
    return countControlledMatchingDescriptor(nextState, controllerId, 'faerie') === 0;
  }
  if (normalizedRaw === 'the creature you control has trample') {
    const sourceId = String(
      params.ctx.targetCreatureId ||
        params.ctx.selectorContext?.targetCreatureId ||
        params.ctx.sourceId ||
        ''
    ).trim();
    const perm = sourceId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, sourceId)
      : getContextSourceObject(params.ctx, (idRaw: string) =>
          findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
        );
    if (!perm) return false;
    const keywords = String((perm as any)?.keywords || (perm as any)?.card?.keywords || '').toLowerCase();
    if (keywords.includes('trample')) return true;
    return hasExecutorClass(perm, 'trample');
  }
  if (normalizedRaw === 'a pirate was exiled this way') {
    const moved = movedCardsFrom(params);
    if (moved.length > 0) {
      return moved.some((card: any) => objectHasType(card, 'pirate'));
    }
    return antecedentApplied(params.lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS);
  }
  if (normalizedRaw === 'an opponent controls more creatures than you') {
    const yours = controlledCreatures(nextState, controllerId).length;
    const opponentIds = (nextState.players || [])
      .map((p: any) => String(p?.id || '').trim())
      .filter((id: string) => id && id !== controllerId);
    return opponentIds.some(id => controlledCreatures(nextState, id as PlayerID).length > yours);
  }
  if (normalizedRaw === 'you have the city\'s blessing') {
    // Live game state uses cityBlessing (shared GameState / client UI). citysBlessing is a
    // leftover executor-only key kept as a fallback for older fixtures.
    const blessing = (nextState as any)?.cityBlessing || (nextState as any)?.citysBlessing || {};
    return Boolean(blessing?.[controllerId]);
  }

  if (
    normalizedRaw === 'this creature is still on the battlefield' ||
    normalizedRaw === 'this permanent is still on the battlefield'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return Boolean(source);
  }

  if (normalizedRaw === 'that creature is legendary' || normalizedRaw === 'that card is legendary' || normalizedRaw === 'that spell is legendary') {
    const ref = getReferencedObject(nextState, ctx);
    return ref ? objectHasType(ref, 'legendary') : false;
  }

  {
    const wasTypeMatch = normalizedRaw.match(/^that creature was (?:a|an) ([a-z0-9' -]+)$/i);
    if (wasTypeMatch) {
      const moved = movedCardsFrom(params);
      const typeName = String(wasTypeMatch[1] || '').trim();
      return moved.length > 0
        ? moved.some(card => objectHasType(card, typeName))
        : antecedentApplied(lastActionOutcome, ['destroy', 'exile', 'exile_top', 'impulse_exile_top', 'move_zone', 'sacrifice']);
    }
  }

  {
    const isOrTypesMatch = normalizedRaw.match(/^that creature is (?:a|an) (.+)$/i);
    if (isOrTypesMatch) {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      const types = String(isOrTypesMatch[1] || '')
        .split(/\s*,\s*|\s+or\s+/)
        .map(part => part.trim().toLowerCase())
        .filter(Boolean);
      return types.some(typeName => objectHasType(ref, typeName.replace(/^an?\s+/, '')));
    }
  }

  if (normalizedRaw === "it's a land or double-faced card" || normalizedRaw === "it's an artifact or creature card" || normalizedRaw === "it's an artifact, creature, or land card") {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    if (/double-faced/.test(normalizedRaw)) {
      return objectHasType(ref, 'land') || Boolean((ref as any)?.doubleFaced ?? (ref as any)?.card?.card_faces?.length);
    }
    const types = normalizedRaw.includes('artifact') ? ['artifact', 'creature', 'land'] : ['artifact', 'creature'];
    return types.some(typeName => objectHasType(ref, typeName));
  }

  {
    const typedCardMatch = normalizedRaw.match(/^it'?s an? (.+?) cards?$/i);
    if (typedCardMatch && !/\bshares a (?:creature|card) type\b/i.test(String(typedCardMatch[1] || ''))) {
      const ref = getConditionalSubjectCard(params);
      if (!ref) {
        const ownerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
        const player = (nextState.players || []).find(
          (entry: any) => String(entry?.id || '').trim() === ownerId
        ) as any;
        const library = Array.isArray(player?.library) ? player.library : [];
        const topCard = library.length > 0 ? library[0] : null;
        if (!topCard) return false;
        const typeName = String(typedCardMatch[1] || '')
          .trim()
          .toLowerCase()
          .replace(/\s+cards?$/, '');
        return objectHasType(topCard, typeName);
      }
      const typeName = String(typedCardMatch[1] || '')
        .trim()
        .toLowerCase()
        .replace(/\s+cards?$/, '');
      return objectHasType(ref, typeName);
    }
  }

  if (normalizedRaw === 'equipped creature is a vampire') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const attachedTo = String((source as any)?.attachedTo || '').trim();
    if (!attachedTo) return false;
    const equipped = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
    return equipped ? objectHasType(equipped, 'vampire') : false;
  }

  {
    const enchantedPowerMatch = normalizedRaw.match(
      /^enchanted creature'?s power is (four|[a-z0-9]+) or greater$/i
    );
    if (enchantedPowerMatch) {
      const threshold = parseSmallNumberWord(String(enchantedPowerMatch[1] || ''));
      if (threshold === null) return null;
      const enchanted = getEnchantedCreatureFromAura(nextState, ctx);
      if (!enchanted) return null;
      if (!objectHasType(enchanted, 'creature')) return false;
      return getCreaturePower(enchanted) >= threshold;
    }
  }

  if (normalizedRaw === "it's equipped" || normalizedRaw === 'it is equipped') {
    const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!subject) return null;
    if (Boolean((subject as any)?.isEquipped)) return true;
    const attachedEquipment = (subject as any)?.attachedEquipment;
    if (Array.isArray(attachedEquipment) && attachedEquipment.length > 0) return true;
    return false;
  }

  if (
    normalizedRaw === "it's modified" ||
    normalizedRaw === 'it is modified' ||
    normalizedRaw === 'this creature is modified'
  ) {
    const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!subject) return null;
    return isPermanentModified(nextState, subject);
  }

  if (normalizedRaw === 'it was enchanted or equipped') {
    const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!subject) return null;
    if (
      Boolean((subject as any)?.wasEnchanted) ||
      Boolean((subject as any)?.wasEquipped) ||
      Boolean((subject as any)?.isEquipped)
    ) {
      return true;
    }
    const attachedEquipment = (subject as any)?.attachedEquipment;
    if (Array.isArray(attachedEquipment) && attachedEquipment.length > 0) return true;
    const subjectId = String((subject as any)?.id || '').trim();
    if (subjectId) {
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const hasAuraAttached = battlefield.some((perm: any) => {
        if (String(perm?.attachedTo || '').trim() !== subjectId) return false;
        const typeLine = getExecutorTypeLineLower(perm);
        return typeLine.includes('enchantment') || typeLine.includes('aura');
      });
      if (hasAuraAttached) return true;
    }
    if ((subject as any)?.wasEnchanted === false && (subject as any)?.wasEquipped === false) return false;
    return false;
  }

  if (normalizedRaw === "this enchantment isn't a creature" || normalizedRaw === 'this enchantment is not a creature') {
    const source = getReferencedObject(nextState, ctx);
    return source ? !objectHasType(source, 'creature') : false;
  }

  if (normalizedRaw === 'a creature card in your graveyard has flying') {
    return getGraveyardCards(nextState, controllerId).some(
      card => objectHasType(card, 'creature') && objectHasType(card, 'flying')
    );
  }
  return null;
}
