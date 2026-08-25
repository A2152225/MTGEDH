/**
 * Origin: oracleIRExecutorConditionalStepSupport.ts
 * Cluster: evaluateConditionalWrapperCondition creatures-died / suspected / attacking / hand-size / legendary clauses
 * Public: tryEvaluateConditionalCreaturesDiedThisTurn
 */
import type { EvaluateConditionalWrapperConditionParams } from './oracleIRExecutorConditionalStepSupportHelpers.js';
import {
  battlefieldObjectHasType,
  cardHasType,
  cardWasToken,
  controllerAttackedWithPowerAtLeast,
  controllerControlsCreatureWithPowerAtLeast,
  controllerControlsGreatestPowerCreature,
  controllerHasFullParty,
  countCreaturesThatDiedThisTurn,
  getBattlefieldCreaturePower,
  getControllerExperienceCounters,
  getLastDieRollTotal,
  getPlayerPoisonCounters,
  getReferencedConditionalObject,
  getSingleChosenObjectId,
  getSourceCounterCount,
  getYourGraveyardCards,
  getYourHandCount,
  matchesCardTypeDescriptor,
  matchesTypeLine,
  movedCardsFromCtx,
  opponentHasMoreCardsInHandThanYou,
  parseSmallNumberWord,
  resolveReferencedCardManaValue,
  resolveTargetSpellManaValue,
  youHaveMoreCardsInHandThanEachOpponent,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function tryEvaluateConditionalCreaturesDiedThisTurn(
  params: EvaluateConditionalWrapperConditionParams,
): boolean | null | undefined {
  const {
    condition,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastMovedCards,
    lastDiscardedCards,
    lastCreatedTokenIds,
  } = params;

  if (condition.kind !== 'if' && condition.kind !== 'as_long_as') return undefined;

  const raw = String(condition.raw || '').trim().toLowerCase();
  let normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
  if (normalizedRaw.startsWith('then ')) {
    normalizedRaw = normalizedRaw.replace(/^then\s+(?:if\s+)?/i, '').trim();
  }
  if (normalizedRaw.startsWith('if ')) {
    normalizedRaw = normalizedRaw.replace(/^if\s+/i, '').trim();
  }

  {
    const creaturesDiedMatch = normalizedRaw.match(/^(three|[a-z0-9]+) or more creatures died this turn$/i);
    if (creaturesDiedMatch) {
      const threshold = parseSmallNumberWord(String(creaturesDiedMatch[1] || '').trim());
      if (threshold !== null) {
        return countCreaturesThatDiedThisTurn(nextState) >= threshold;
      }
    }
  }

  {
    const attackedWithPowerMatch = normalizedRaw.match(
      /^you attacked this turn with a creature with power (\d+) or greater$/
    );
    if (attackedWithPowerMatch) {
      const threshold = Number.parseInt(String(attackedWithPowerMatch[1] || ''), 10);
      return Number.isFinite(threshold)
        ? controllerAttackedWithPowerAtLeast(nextState, controllerId, threshold)
        : null;
    }
  }

  if (normalizedRaw === 'you control the creature with the greatest power or tied for the greatest power') {
    return controllerControlsGreatestPowerCreature(nextState, controllerId);
  }

  if (
    normalizedRaw === "you didn't put a card into your hand this way" ||
    normalizedRaw === 'you did not put a card into your hand this way'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (
      lastActionOutcome?.stepKind === 'look_choose_from_top' ||
      lastActionOutcome?.stepKind === 'move_zone' ||
      lastActionOutcome?.stepKind === 'search_library'
    ) {
      if (lastActionOutcome.kind === 'applied') {
        const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
        return movedCards.length === 0;
      }
      return true;
    }
    return null;
  }

  if (
    normalizedRaw === 'this creature would die' ||
    normalizedRaw === 'this permanent would die' ||
    normalizedRaw === 'it would die'
  ) {
    return true;
  }

  if (
    normalizedRaw === "it isn't a creature" ||
    normalizedRaw === 'it is not a creature' ||
    normalizedRaw === "this permanent isn't a creature" ||
    normalizedRaw === 'this permanent is not a creature'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return !battlefieldObjectHasType(referencedObject, 'creature');
  }

  if (normalizedRaw === "it's suspected" || normalizedRaw === 'it is suspected' || normalizedRaw === 'this creature is suspected') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return Boolean(
      (referencedObject as any)?.suspected ??
        (referencedObject as any)?.isSuspected ??
        (referencedObject as any)?.card?.suspected ??
        (referencedObject as any)?.card?.isSuspected
    );
  }

  if (normalizedRaw === "it's not suspected" || normalizedRaw === 'it is not suspected' || normalizedRaw === "it isn't suspected") {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    const suspected = Boolean(
      (referencedObject as any)?.suspected ??
        (referencedObject as any)?.isSuspected ??
        (referencedObject as any)?.card?.suspected ??
        (referencedObject as any)?.card?.isSuspected
    );
    return !suspected;
  }

  if (
    normalizedRaw === "this creature didn't enter the battlefield this turn" ||
    normalizedRaw === 'this creature did not enter the battlefield this turn'
  ) {
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState), idRaw)
    );
    if (!sourceRef) return null;
    if ((sourceRef as any)?.enteredThisTurn === true) return false;
    if ((sourceRef as any)?.enteredThisTurn === false) return true;
    return null;
  }

  if (
    normalizedRaw === "it doesn't have an indestructible counter on it" ||
    normalizedRaw === 'it does not have an indestructible counter on it'
  ) {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    const count = Number(((referencedObject as any)?.counters || {}).indestructible ?? 0);
    return (Number.isFinite(count) ? count : 0) === 0;
  }

  if (normalizedRaw === 'it was attacking' || normalizedRaw === 'this creature was attacking') {
    let referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) {
      const moved = movedCardsFromCtx(ctx, lastMovedCards);
      referencedObject = moved.length > 0 ? moved[0] : null;
    }
    if (!referencedObject) return null;
    return (
      (referencedObject as any)?.attackedThisTurn === true ||
      Boolean((referencedObject as any)?.attacking) ||
      (referencedObject as any)?.isAttacking === true
    );
  }

  if (
    normalizedRaw === "this creature didn't attack this turn" ||
    normalizedRaw === 'this creature did not attack this turn'
  ) {
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState), idRaw)
    );
    if (!sourceRef) return null;
    return !(
      (sourceRef as any)?.attackedThisTurn === true ||
      Boolean((sourceRef as any)?.attacking) ||
      (sourceRef as any)?.isAttacking === true
    );
  }

  if (
    normalizedRaw === "this creature didn't attack or come under your control this turn" ||
    normalizedRaw === 'this creature did not attack or come under your control this turn'
  ) {
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState), idRaw)
    );
    if (!sourceRef) return null;
    const attacked =
      (sourceRef as any)?.attackedThisTurn === true ||
      Boolean((sourceRef as any)?.attacking) ||
      (sourceRef as any)?.isAttacking === true ||
      Boolean((sourceRef as any)?.defendingPlayerId);
    const cameUnderControl =
      (sourceRef as any)?.cameUnderYourControlThisTurn === true ||
      (sourceRef as any)?.gainedControlThisTurn === true ||
      (sourceRef as any)?.enteredThisTurn === true;
    if (attacked || cameUnderControl) return false;
    if (
      (sourceRef as any)?.attackedThisTurn === false &&
      (sourceRef as any)?.cameUnderYourControlThisTurn === false &&
      (sourceRef as any)?.gainedControlThisTurn === false &&
      (sourceRef as any)?.enteredThisTurn === false
    ) {
      return true;
    }
    return null;
  }

  {
    const spellMvMatch = normalizedRaw.match(/^that spell(?:'s)? (?:has )?mana value (?:is )?(\d+) or greater$/);
    if (spellMvMatch) {
      const threshold = Number.parseInt(String(spellMvMatch[1] || ''), 10);
      const manaValue = resolveTargetSpellManaValue(nextState, ctx);
      if (!Number.isFinite(threshold) || manaValue === null) return null;
      return manaValue >= threshold;
    }
  }

  {
    const cardMvExperienceMatch = normalizedRaw.match(
      /^that card(?:'s)? mana value is less than or equal to the number of experience counters you have$/i
    );
    if (cardMvExperienceMatch) {
      const manaValue = resolveReferencedCardManaValue(nextState, ctx);
      if (manaValue === null) return null;
      return manaValue <= getControllerExperienceCounters(nextState, controllerId);
    }
  }

  {
    const cardHasMvLteMatch = normalizedRaw.match(/^that card has mana value (\d+) or less$/i);
    if (cardHasMvLteMatch) {
      const threshold = Number.parseInt(String(cardHasMvLteMatch[1] || ''), 10);
      const manaValue = resolveReferencedCardManaValue(nextState, ctx);
      if (!Number.isFinite(threshold) || manaValue === null) return null;
      return manaValue <= threshold;
    }
  }

  {
    const cardMvThresholdMatch = normalizedRaw.match(
      /^that card(?:'s)? mana value is (less than or equal to|greater than or equal to|equal to|less than|greater than) (\d+)$/i
    );
    if (cardMvThresholdMatch) {
      const operator = String(cardMvThresholdMatch[1] || '').trim().toLowerCase();
      const threshold = Number.parseInt(String(cardMvThresholdMatch[2] || ''), 10);
      const manaValue = resolveReferencedCardManaValue(nextState, ctx);
      if (!Number.isFinite(threshold) || manaValue === null) return null;
      if (operator === 'less than or equal to') return manaValue <= threshold;
      if (operator === 'greater than or equal to') return manaValue >= threshold;
      if (operator === 'equal to') return manaValue === threshold;
      if (operator === 'less than') return manaValue < threshold;
      if (operator === 'greater than') return manaValue > threshold;
    }
  }

  {
    const powerThresholdMatch = normalizedRaw.match(
      /^(?:that creature(?:'s)?|that permanent(?:'s)?|its) power is (\d+) or (?:greater|more)$/i
    );
    if (powerThresholdMatch) {
      const threshold = Number.parseInt(String(powerThresholdMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
      if (!referencedObject) return null;
      return getBattlefieldCreaturePower(referencedObject) >= threshold;
    }
  }

  {
    const hasPowerThresholdMatch = normalizedRaw.match(
      /^(?:that creature|that permanent|it) has power (\d+) or (?:greater|more)$/i
    );
    if (hasPowerThresholdMatch) {
      const threshold = Number.parseInt(String(hasPowerThresholdMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
      if (!referencedObject) return null;
      return getBattlefieldCreaturePower(referencedObject) >= threshold;
    }
  }

  {
    const powerAtMostMatch = normalizedRaw.match(
      /^(?:that creature(?:'s)?|its) power is (\d+) or less$/i
    );
    if (powerAtMostMatch) {
      const threshold = Number.parseInt(String(powerAtMostMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
      if (!referencedObject) return null;
      return getBattlefieldCreaturePower(referencedObject) <= threshold;
    }
  }

  if (normalizedRaw === 'that player has more cards in hand than you') {
    const thatPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || ''
    ).trim();
    if (!thatPlayerId) return null;
    const youPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === String(controllerId || '').trim()
    ) as any;
    const thatPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === thatPlayerId
    ) as any;
    const yourHandCount = Array.isArray(youPlayer?.hand) ? youPlayer.hand.length : 0;
    const theirHandCount = Array.isArray(thatPlayer?.hand) ? thatPlayer.hand.length : 0;
    return theirHandCount > yourHandCount;
  }

  if (normalizedRaw === 'that player has no cards in hand') {
    const thatPlayerId = String(
      ctx.selectorContext?.targetOpponentId ||
        ctx.selectorContext?.targetPlayerId ||
      (ctx as any).targetOpponentId ||
        ''
    ).trim();
    if (!thatPlayerId) return null;
    const thatPlayer = (nextState.players || []).find(
      (player: any) => String(player?.id || '').trim() === thatPlayerId
    ) as any;
    return Array.isArray(thatPlayer?.hand) ? thatPlayer.hand.length === 0 : true;
  }

  if (normalizedRaw === 'an opponent has more cards in hand than you') {
    return opponentHasMoreCardsInHandThanYou(nextState, controllerId);
  }

  if (normalizedRaw === 'an opponent discarded a card this turn') {
    const map = (nextState as any)?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    const opponentIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
    if (opponentIds.length === 0) return false;
    for (const opponentId of opponentIds) {
      if (!Object.prototype.hasOwnProperty.call(map, opponentId)) return null;
      const value = (map as Record<string, unknown>)[opponentId];
      if (typeof value === 'boolean') {
        if (value) return true;
        continue;
      }
      if (typeof value === 'number') {
        if (value > 0) return true;
        continue;
      }
      return null;
    }
    return false;
  }

  if (normalizedRaw === 'you have more cards in hand than each opponent') {
    return youHaveMoreCardsInHandThanEachOpponent(nextState, controllerId);
  }

  if (normalizedRaw === 'you have no cards in hand' || normalizedRaw === 'you have no cards in your hand') {
    return getYourHandCount(nextState, controllerId) === 0;
  }

  {
    const graveyardTypeMatch = normalizedRaw.match(/^there is an? ([a-z0-9' -]+) card in your graveyard$/i);
    if (graveyardTypeMatch) {
      const descriptor = String(graveyardTypeMatch[1] || '').trim().toLowerCase();
      const graveyard = getYourGraveyardCards(nextState, controllerId);
      return graveyard.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  if (normalizedRaw === 'that creature is legendary' || normalizedRaw === 'that permanent is legendary') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return (
      battlefieldObjectHasType(referencedObject, 'legendary') ||
      matchesTypeLine(getExecutorTypeLineLower(referencedObject), 'legendary')
    );
  }

  if (normalizedRaw === "it's legendary" || normalizedRaw === 'it is legendary') {
    const battlefield = getProcessedBattlefield(nextState);
    const referencedId =
      String(ctx.targetPermanentId || '').trim() ||
      getSingleChosenObjectId(ctx) ||
      String(ctx.sourceId || '').trim();
    if (!referencedId) return null;
    const referencedObject = findObjectByIdInState(nextState, battlefield as any, referencedId);
    if (!referencedObject) return false;
    return (
      battlefieldObjectHasType(referencedObject, 'legendary') ||
      matchesTypeLine(getExecutorTypeLineLower(referencedObject), 'legendary') ||
      cardHasType(referencedObject, 'legendary')
    );
  }

  if (normalizedRaw === 'you controlled it') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return true;
    return String((referencedObject as any)?.controller || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === 'a creature an opponent controls would die') {
    return true;
  }

  if (normalizedRaw === "each opponent who didn't discard a nonland card this way") {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'discard' && lastActionOutcome.kind === 'applied') return true;
    return true;
  }

  if (
    normalizedRaw === 'a card or token would be put into your graveyard from anywhere' ||
    normalizedRaw === 'a card or token would be put into a graveyard from anywhere' ||
    normalizedRaw === 'a spell cast this way would be put into a graveyard'
  ) {
    return true;
  }

  if (normalizedRaw === 'this is the first time this ability has resolved this turn') {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 1 : true;
  }

  if (normalizedRaw === 'they guessed wrong') {
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? !guessCorrect : false;
  }

  if (normalizedRaw === 'you do and your opponent guessed wrong') {
    const youDo =
      (ctx as any)?.youDoChoice ??
      (ctx.selectorContext as any)?.youDoChoice ??
      (ctx as any)?.youDo;
    if (youDo !== true) return false;
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? !guessCorrect : false;
  }

  if (normalizedRaw === 'you control that creature' || normalizedRaw === 'you control that permanent') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return String((referencedObject as any)?.controller || '').trim() === String(controllerId || '').trim();
  }

  if (
    normalizedRaw === 'that creature would die this turn' ||
    normalizedRaw === 'that permanent would die this turn'
  ) {
    return true;
  }

  if (normalizedRaw === 'that spell is countered this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'counter_spell' && lastActionOutcome.kind === 'applied') return true;
    if (lastActionOutcome?.stepKind === 'counter_spell') return false;
    return null;
  }

  if (
    normalizedRaw === "a permanent's ability is countered this way" ||
    normalizedRaw === 'an ability is countered this way'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'counter_spell' && lastActionOutcome.kind === 'applied') return true;
    if (lastActionOutcome?.stepKind === 'counter_spell') return false;
    return null;
  }

  if (normalizedRaw === 'an opponent created a token this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'create_token' && lastActionOutcome.kind === 'applied') return true;
    const createdIds = Array.isArray(lastCreatedTokenIds) ? lastCreatedTokenIds : [];
    return createdIds.length > 0 ? true : lastActionOutcome?.stepKind === 'create_token' ? false : null;
  }

  if (normalizedRaw === 'that creature was a token' || normalizedRaw === 'that permanent was a token') {
    const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
    if (movedCards.length > 0) return movedCards.some(cardWasToken);
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (
      lastActionOutcome?.kind === 'applied' &&
      (lastActionOutcome.stepKind === 'exile' ||
        lastActionOutcome.stepKind === 'move_zone' ||
        lastActionOutcome.stepKind === 'destroy')
    ) {
      return false;
    }
    if (lastActionOutcome?.stepKind === 'exile' || lastActionOutcome?.stepKind === 'move_zone') return false;
    return null;
  }

  if (normalizedRaw === "it's not a token" || normalizedRaw === 'it is not a token' || normalizedRaw === "it isn't a token") {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return !cardWasToken(referencedObject);
  }

  if (normalizedRaw === 'those auras would leave the battlefield' || normalizedRaw === 'that aura would leave the battlefield') {
    return true;
  }

  if (normalizedRaw === 'a player would gain life') {
    return true;
  }

  if (normalizedRaw === 'damage is prevented this way') {
    if (lastActionOutcome?.kind === 'impossible') return false;
    if (lastActionOutcome?.stepKind === 'prevent_damage' && lastActionOutcome.kind === 'applied') return true;
    if (lastActionOutcome?.stepKind === 'prevent_damage') return false;
    return null;
  }

  if (
    normalizedRaw === "you didn't put a card onto the battlefield this way" ||
    normalizedRaw === 'you did not put a card onto the battlefield this way'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.stepKind === 'move_zone' && lastActionOutcome.kind === 'applied') {
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      return movedCards.length === 0;
    }
    if (lastActionOutcome?.stepKind === 'move_zone') return true;
    return null;
  }

  if (
    normalizedRaw === "this creature's sneak cost was paid" ||
    normalizedRaw === "this permanent's sneak cost was paid" ||
    normalizedRaw === 'its sneak cost was paid' ||
    normalizedRaw === 'his sneak cost was paid'
  ) {
    const battlefield = getProcessedBattlefield(nextState);
    const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, battlefield as any, idRaw)
    );
    if (!sourceRef) return null;
    return Boolean(
      (sourceRef as any)?.sneakCostPaid ??
        (sourceRef as any)?.paidSneakCost ??
        (sourceRef as any)?.alternateCostKind === 'sneak'
    );
  }

  {
    const hadCountersMatch = normalizedRaw.match(/^it had (three|[a-z0-9]+) or more ([a-z0-9/+ -]+) counters on it$/i);
    if (hadCountersMatch) {
      const threshold = parseSmallNumberWord(String(hadCountersMatch[1] || '').trim());
      const counterName = String(hadCountersMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && counterName) {
        const count = getSourceCounterCount(nextState, ctx, counterName);
        return count === null ? null : count >= threshold;
      }
    }
  }

  {
    const resultAtMostMatch = normalizedRaw.match(/^the result is (three|[a-z0-9]+) or less$/i);
    if (resultAtMostMatch) {
      const threshold = parseSmallNumberWord(String(resultAtMostMatch[1] || '').trim());
      if (threshold !== null) {
        const rolled = getLastDieRollTotal(nextState, controllerId);
        return rolled === null ? null : rolled <= threshold;
      }
    }
  }

  {
    const youControlPowerMatch = normalizedRaw.match(/^you control a creature with power (\d+) or greater$/i);
    if (youControlPowerMatch) {
      const threshold = Number.parseInt(String(youControlPowerMatch[1] || ''), 10);
      return Number.isFinite(threshold) ? controllerControlsCreatureWithPowerAtLeast(nextState, controllerId, threshold) : null;
    }
  }

  if (normalizedRaw === 'you have a full party') {
    return controllerHasFullParty(nextState, controllerId);
  }

  {
    const poisonMatch = normalizedRaw.match(/^an opponent has (three|[a-z0-9]+) or more poison counters$/);
    if (poisonMatch) {
      const threshold = parseSmallNumberWord(String(poisonMatch[1] || '').trim());
      if (threshold === null) return null;
      const opponentIds = (nextState.players || [])
        .map((player: any) => String(player?.id || '').trim())
        .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
      return opponentIds.some((opponentId: string) => getPlayerPoisonCounters(nextState, opponentId) >= threshold);
    }
  }

  if (
    normalizedRaw === 'a nonland permanent left the battlefield this turn or a spell was warped this turn'
  ) {
    const leftMap = (nextState as any)?.permanentLeftBattlefieldThisTurn;
    const leftBattlefield =
      typeof leftMap?.[controllerId] === 'boolean' ? leftMap[controllerId] : false;
    const warpedMap = (nextState as any)?.spellWarpedThisTurn;
    const warped =
      typeof warpedMap?.[controllerId] === 'boolean'
        ? warpedMap[controllerId]
        : Boolean((nextState as any)?.spellWarpedThisTurn);
    return leftBattlefield || warped;
  }

  {
    const genericCounterThresholdMatch = normalizedRaw.match(
      /^it has (three|[a-z0-9]+) or more ([a-z0-9/+ -]+) counters on it$/i
    );
    if (genericCounterThresholdMatch) {
      const threshold = parseSmallNumberWord(String(genericCounterThresholdMatch[1] || '').trim());
      const counterName = String(genericCounterThresholdMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && counterName) {
        const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
        if (!referencedObject) return null;
        const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
        const count = Number(counters[counterName] ?? 0);
        return (Number.isFinite(count) ? count : 0) >= threshold;
      }
    }

    const thatCreatureCounterThresholdMatch = normalizedRaw.match(
      /^that creature has (three|[a-z0-9]+) or more ([a-z0-9/+ -]+) counters on it$/i
    );
    if (thatCreatureCounterThresholdMatch) {
      const threshold = parseSmallNumberWord(String(thatCreatureCounterThresholdMatch[1] || '').trim());
      const counterName = String(thatCreatureCounterThresholdMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && counterName) {
        const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
        if (!referencedObject) return null;
        const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
        const count = Number(counters[counterName] ?? 0);
        return (Number.isFinite(count) ? count : 0) >= threshold;
      }
    }
  }
  return undefined;
}
