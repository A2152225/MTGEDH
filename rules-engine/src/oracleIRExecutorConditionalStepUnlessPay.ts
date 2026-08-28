/**
 * Origin: oracleIRExecutorConditionalStepSupport.ts
 * Cluster: evaluateConditionalWrapperCondition unless-pay / you-do / otherwise / enters-this-way / graveyard-count / lands / first-combat
 * Public: tryEvaluateConditionalUnlessPayYouDoOtherwise
 */
import type {
  EvaluateConditionalWrapperConditionParams,
  LastActionOutcome,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import {
  battlefieldObjectHasType,
  controllerAttackedThisTurn,
  getHandCountAtBeginningOfTurn,
  getReferencedConditionalObject,
  hasRecentExileOutcome,
  matchesCardTypeDescriptor,
  movedCardsFromCtx,
  playerHandHasMatchingDescriptor,
  readCreaturePowerForUnless,
  resolveUnlessPayInnerCondition,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield, getSourceBattlefieldPermanent } from './oracleIRExecutorCreatureStepUtils';
import { getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { evaluateExtendedConditionalClause } from './oracleIRExecutorConditionalStepSupportExtended';
import {
  collectContextualCardsLedgerFirst,
  collectRevealedThisWayCardsLedgerFirst,
  resolveAntecedentDiscardedCards,
  resolveAntecedentMilledCards,
} from './oracleIRLedgerCardAccess';

export function tryEvaluateConditionalUnlessPayYouDoOtherwise(
  params: EvaluateConditionalWrapperConditionParams,
): boolean | null | undefined {
  const {
    condition,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastStepOutcome = null,
    lastConditionalEvaluation,
    pendingSteps,
    lastMovedCards,
    lastDiscardedCards,
    lastCreatedTokenIds,
    lastExcessDamageDealtThisWay,
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

  const getAffirmativeAntecedentOutcome = (): LastActionOutcome =>
    lastActionOutcome ?? lastStepOutcome;

  const evaluateConditionalWrapperCondition = params.evaluateRecursive as NonNullable<
    EvaluateConditionalWrapperConditionParams['evaluateRecursive']
  >;

  {
    const unlessResolved = resolveUnlessPayInnerCondition(normalizedRaw, ctx, nextState, controllerId);
    if (unlessResolved !== undefined) return unlessResolved;
  }

  if (normalizedRaw.startsWith('you do, ')) {
    return evaluateConditionalWrapperCondition({
      ...params,
      condition: { ...condition, raw: 'you do' },
    });
  }

  if (normalizedRaw === 'otherwise') {
    return typeof lastConditionalEvaluation === 'boolean' ? !lastConditionalEvaluation : null;
  }

  {
    const movedCardTypeMatch = normalizedRaw.match(/^it was (?:a|an)\s+(.+?)(?:\s+card)?$/i);
    if (movedCardTypeMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const descriptor = String(movedCardTypeMatch[1] || '').trim().toLowerCase();
      const movedFromOutcome =
        lastActionOutcome?.stepKind === 'discard'
          ? (Array.isArray(lastDiscardedCards) ? lastDiscardedCards : [])
          : Array.isArray(lastMovedCards)
            ? lastMovedCards
            : [];
      const movedCards = collectContextualCardsLedgerFirst(ctx, {
        lastMovedCards: movedFromOutcome,
        lastDiscardedCards,
      });
      if (movedCards.length > 0) {
        return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
      }
      if (
        lastActionOutcome?.stepKind !== 'move_zone' &&
        lastActionOutcome?.stepKind !== 'discard' &&
        lastActionOutcome?.stepKind !== 'look_top' &&
        lastActionOutcome?.stepKind !== 'look_choose_from_top' &&
        lastActionOutcome?.stepKind !== 'search_library'
      ) {
        if (!lastActionOutcome && descriptor === 'creature') return true;
        return null;
      }
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  if (normalizedRaw === 'a creature enters this way') {
    const moveStep = params.step;
    if (!moveStep || moveStep.kind !== 'move_zone' || moveStep.to !== 'battlefield') return null;
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const player = nextState.players.find((entry) => entry.id === controllerId) as any;
    if (!player) return null;
    for (const zone of ['graveyard', 'hand', 'exile'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      const selected =
        chosenIds.length > 0
          ? cards.filter((card: any) => chosenIds.includes(String(card?.id || '').trim()))
          : cards;
      if (selected.length > 0) {
        return selected.some((card: any) => matchesCardTypeDescriptor(card, 'creature'));
      }
    }
    return null;
  }

  {
    const movedCardTypeNegatedMatch = normalizedRaw.match(/^it was not (?:a|an)\s+(.+?)(?:\s+card)?$/i);
    if (movedCardTypeNegatedMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'move_zone' && lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(movedCardTypeNegatedMatch[1] || '').trim().toLowerCase();
      const movedCards = lastActionOutcome?.stepKind === 'discard'
        ? resolveAntecedentDiscardedCards(ctx, { lastDiscardedCards }) as any[]
        : collectContextualCardsLedgerFirst(ctx, { lastMovedCards }) as any[];
      return movedCards.length > 0 && movedCards.every((card: any) => !matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const discardedThisWayMatch = normalizedRaw.match(/^a[n]?\s+(.+?)\s+card\s+was\s+discarded\s+this\s+way$/i);
    if (discardedThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const descriptor = String(discardedThisWayMatch[1] || '').trim().toLowerCase();
      const discardedCards = resolveAntecedentDiscardedCards(ctx, { lastDiscardedCards }) as any[];
      if (discardedCards.length > 0) {
        return discardedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
      }
      if (lastActionOutcome?.stepKind !== 'discard') return false;
      return false;
    }
  }

  {
    const youDiscardThisWayMatch = normalizedRaw.match(/^you discard (?:a|an) (.+?) card this way$/i);
    if (youDiscardThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      if (lastActionOutcome?.stepKind !== 'discard') return null;

      const descriptor = String(youDiscardThisWayMatch[1] || '').trim().toLowerCase();
      const discardedCards = resolveAntecedentDiscardedCards(ctx, { lastDiscardedCards }) as any[];
      return discardedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const putIntoExileThisWayMatch = normalizedRaw.match(/^(?:a|an)\s+(.+?)\s+is put into exile this way$/i);
    if (putIntoExileThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      const hasRecentExile = hasRecentExileOutcome(lastActionOutcome, movedCards);
      if (!hasRecentExile) return null;

      const descriptor = String(putIntoExileThisWayMatch[1] || '').trim().toLowerCase();
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const exiledThisWayMatch = normalizedRaw.match(/^(.*?)\s+card\s+(?:was exiled|is exiled|is put into exile)\s+this way$/i);
    if (exiledThisWayMatch) {
      if (lastActionOutcome?.kind === 'impossible') return false;
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      const hasRecentExile = hasRecentExileOutcome(lastActionOutcome, movedCards);
      if (!hasRecentExile) return null;

      const rawDescriptor = String(exiledThisWayMatch[1] || '').trim().toLowerCase();
      const descriptor = rawDescriptor.replace(/^an?\s+/i, '').trim();
      if (!descriptor || rawDescriptor === 'a' || rawDescriptor === 'an') return movedCards.length > 0;
      return movedCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const milledThisWayMatch = normalizedRaw.match(/^(?:a|an)\s+(.+?)\s+card\s+was\s+milled\s+this\s+way$/i);
    if (milledThisWayMatch) {
      const descriptor = String(milledThisWayMatch[1] || '').trim().toLowerCase();
      const milledCards = resolveAntecedentMilledCards(ctx) as any[];
      return milledCards.some((card: any) => matchesCardTypeDescriptor(card, descriptor));
    }
  }

  {
    const unlessNotMatch = normalizedRaw.match(/^not \((.+)\)$/i);
    if (unlessNotMatch) {
      const inner = String(unlessNotMatch[1] || '').trim().toLowerCase();
      const unlessPayResolved = resolveUnlessPayInnerCondition(inner, ctx, nextState, controllerId);
      if (unlessPayResolved !== undefined) {
        if (unlessPayResolved === null) return null;
        return !unlessPayResolved;
      }

      const manaSpentUnlessMatch = inner.match(/^\{([wubrgcs])\} was spent to cast it$/);
      const satisfied = manaSpentUnlessMatch
        ? (() => {
            const sourceRef = getContextSourceObject(ctx, (idRaw: string) =>
              findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
            );
            const spent = getAmountOfSpecificManaSymbolSpent(sourceRef, manaSpentUnlessMatch[1]);
            return spent === null ? null : spent > 0;
          })()
        : /^you discard (?:a|an) /.test(inner) ||
            /^you exile (?:a|an) card from your graveyard/.test(inner) ||
            /^you exile the top creature card of your graveyard/.test(inner) ||
            /^you return (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) /.test(inner) ||
            /^you return another creature you control to its owner's hand/.test(inner) ||
            /^you sacrifice (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) /.test(inner) ||
            /^you remove a \+1\/\+1 counter from it$/.test(inner) ||
            /^you gained life this turn$/.test(inner) ||
            /^an opponent was dealt damage this turn$/.test(inner) ||
            /^you discard two cards$/.test(inner)
          ? true
          : null;
      if (satisfied === null) {
        const extendedNegated = evaluateExtendedConditionalClause({
          normalizedRaw,
          raw,
          nextState,
          controllerId,
          ctx,
          lastActionOutcome,
          lastMovedCards,
          lastDiscardedCards,
          lastExcessDamageDealtThisWay,
          step: params.step,
        });
        if (extendedNegated !== null) return extendedNegated;
        return null;
      }
      return !satisfied;
    }
  }

  if (/^(?:her|his|its|this spell's) additional cost was paid$/.test(normalizedRaw)) {
    const paid =
      ctx.waterbendWasPaid ??
      ctx.optionalAdditionalCostWasPaid ??
      ctx.teamworkWasPaid ??
      ctx.selectorContext?.waterbendWasPaid ??
      ctx.selectorContext?.optionalAdditionalCostWasPaid;
    if (paid === true) return true;
    if (paid === false) return false;
    return false;
  }

  if (
    normalizedRaw ===
    'a permanent entered the battlefield face down under your control this turn or you turned a permanent face up this turn'
  ) {
    return Boolean(
      ctx.faceDownPermanentEnteredThisTurnUnderYourControl ||
        ctx.turnedPermanentFaceUpThisTurn ||
        ctx.selectorContext?.faceDownPermanentEnteredThisTurnUnderYourControl ||
        ctx.selectorContext?.turnedPermanentFaceUpThisTurn
    );
  }

  if (normalizedRaw === "that player can't" || normalizedRaw === "that player can't sacrifice") {
    const targetPlayerId =
      String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.activePlayerId || '').trim() ||
      controllerId;
    const battlefield = getProcessedBattlefield(nextState);
    const hasLegalSacrifice = battlefield.some((perm: any) => {
      if (String(perm?.controller || '').trim() !== targetPlayerId) return false;
      const typeLine = getExecutorTypeLineLower(perm);
      if (typeLine.includes('land')) return false;
      if (Boolean((perm as any)?.isToken) || /\btoken\b/i.test(typeLine)) return false;
      return true;
    });
    return !hasLegalSacrifice;
  }

  // Kinship / Descendants' Path share-type clauses are owned by YouHaveGraveyard.
  // Generic "it's a … card" and extended type-list matchers steal them as false.
  if (
    /\bshares a (?:creature|card) type with (?:a creature you control|this creature|this permanent)\b/i.test(
      normalizedRaw,
    )
  ) {
    return undefined;
  }

  {
    // "Reveal the top card of your library. If it's a creature card, ..." reads the same way for
    // every card type, so the descriptor is captured rather than hard-coded to "permanent".
    const cardTypeClauseMatch = normalizedRaw.match(/^it(?:'s|\s+is)\s+an?\s+(.+?)\s+cards?$/i);
    const cardTypeDescriptor = cardTypeClauseMatch ? String(cardTypeClauseMatch[1] || '').trim() : '';
    if (cardTypeDescriptor) {
      const revealed = collectRevealedThisWayCardsLedgerFirst(ctx, params.step);
      const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
      const revealedCtx = Array.isArray((ctx as any)?.lastRevealedCards) ? (ctx as any).lastRevealedCards : [];
      const subject =
        (revealed.length > 0 ? revealed[revealed.length - 1] : null) ??
        (revealedCtx.length > 0 ? revealedCtx[revealedCtx.length - 1] : null) ??
        (movedCards.length > 0 ? movedCards[movedCards.length - 1] : null);
      if (!subject) {
        // "return that card ... if it's a Samurai card" binds "it" to the dying permanent's card rather
        // than to anything revealed or moved, so the bound object is consulted before guessing the
        // library top (which only fits the "reveal the top card, if it's a ..." templates).
        const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
        if (referencedObject) return matchesCardTypeDescriptor(referencedObject, cardTypeDescriptor);
        const ownerId = String(
          ctx.lastTopLibraryOwnerId || (ctx as any).targetPlayerId || ctx.selectorContext?.targetPlayerId || controllerId || '',
        ).trim();
        const player = (nextState.players || []).find(
          (entry: any) => String(entry?.id || '').trim() === ownerId,
        ) as any;
        const library = Array.isArray(player?.library) ? player.library : [];
        const topCard = library.length > 0 ? library[0] : null;
        return topCard ? matchesCardTypeDescriptor(topCard, cardTypeDescriptor) : false;
      }
      return matchesCardTypeDescriptor(subject, cardTypeDescriptor);
    }
  }

  {
    const extended = evaluateExtendedConditionalClause({
      normalizedRaw,
      raw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      step: params.step,
    });
    if (extended !== null) return extended;
  }

  if (normalizedRaw === 'a graveyard has twenty or more cards in it') {
    const graveyardCount = ((nextState as any).players || []).reduce((sum: number, player: any) => {
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      return sum + graveyard.length;
    }, 0);
    return graveyardCount >= 20;
  }

  if (normalizedRaw === 'this creature entered this turn') {
    const source = getSourceBattlefieldPermanent(nextState, ctx);
    if (!source) return false;
    return Boolean((source as any)?.enteredThisTurn);
  }

  if (normalizedRaw === 'this permanent entered this turn') {
    const source = getSourceBattlefieldPermanent(nextState, ctx);
    if (!source) return false;
    return Boolean((source as any)?.enteredThisTurn);
  }

  if (normalizedRaw === 'it entered from your library or was cast from your library') {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.stepKind === 'draw' && antecedent.kind === 'applied') return true;
    const movedCards = movedCardsFromCtx(ctx, lastMovedCards);
    if (movedCards.length > 0) return true;
    return false;
  }

  if (normalizedRaw === 'you control another creature with power 2 or less') {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = getProcessedBattlefield(nextState);
    return battlefield.some((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId || (sourceId && permanentId === sourceId)) return false;
      if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
      if (!getExecutorTypeLineLower(perm).includes('creature')) return false;
      return readCreaturePowerForUnless(perm) <= 2;
    });
  }

  {
    const discardUnlessMatch = normalizedRaw.match(
      /^(?:they|you) discard (?:a|an) (.+)$/
    );
    if (discardUnlessMatch) {
      const descriptor = String(discardUnlessMatch[1] || '').trim().toLowerCase();
      if (normalizedRaw.startsWith('they discard')) {
        const opponentIds = ((nextState as any).players || [])
          .map((player: any) => String(player?.id || '').trim())
          .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
        return opponentIds.some((opponentId) =>
          playerHandHasMatchingDescriptor(nextState, opponentId, descriptor),
        );
      }
      return playerHandHasMatchingDescriptor(nextState, String(controllerId || '').trim(), descriptor);
    }
  }

  if (normalizedRaw === 'an opponent controls more lands than you') {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const countLands = (playerId: string): number =>
      battlefield.filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === playerId && battlefieldObjectHasType(perm, 'land')
      ).length;
    const youLands = countLands(String(controllerId || '').trim());
    const opponentIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId: string) => playerId && playerId !== String(controllerId || '').trim());
    return opponentIds.some((opponentId: string) => countLands(opponentId) > youLands);
  }

  {
    const thatPlayerMoreMatch = normalizedRaw.match(/^that player controls more (creatures|lands) than you$/i);
    if (thatPlayerMoreMatch) {
      const subject = String(thatPlayerMoreMatch[1] || '').trim().toLowerCase();
      const thatPlayerId = String(
        ctx.selectorContext?.targetOpponentId ||
          ctx.selectorContext?.targetPlayerId ||
          (ctx as any).targetPlayerId ||
          (ctx as any).targetOpponentId ||
          ''
      ).trim();
      if (!thatPlayerId) return null;
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const typeName = subject === 'creatures' ? 'creature' : 'land';
      const countMatching = (playerId: string): number =>
        battlefield.filter(
          (perm: any) =>
            String(perm?.controller || '').trim() === playerId && battlefieldObjectHasType(perm, typeName)
        ).length;
      const yourCount = countMatching(String(controllerId || '').trim());
      const theirCount = countMatching(thatPlayerId);
      return theirCount > yourCount;
    }
  }

  if (normalizedRaw === 'that player controls more lands than each other player') {
    const activeIndex = Number.isInteger((nextState as any).activePlayerIndex)
      ? Number((nextState as any).activePlayerIndex)
      : 0;
    const thatPlayerId = String(
      ctx.selectorContext?.targetPlayerId ||
        ctx.selectorContext?.activePlayerId ||
        (ctx as any).targetPlayerId ||
        (ctx.selectorContext as any)?.thatPlayerId ||
        (nextState as any)?.turnPlayer ||
        (nextState.players || [])[activeIndex]?.id ||
        ''
    ).trim();
    if (!thatPlayerId) return null;
    const playerIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((playerId: string) => playerId);
    if (!playerIds.length) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const countLands = (playerId: string): number =>
      battlefield.filter(
        (perm: any) =>
          String(perm?.controller || '').trim() === playerId && battlefieldObjectHasType(perm, 'land')
      ).length;
    const thatCount = countLands(thatPlayerId);
    return playerIds.every((playerId) => {
      if (playerId === thatPlayerId) return true;
      return thatCount > countLands(playerId);
    });
  }

  if (
    normalizedRaw === 'this is the second time this ability has resolved this turn' ||
    normalizedRaw === "it's the second time"
  ) {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 2 : false;
  }

  if (normalizedRaw === "it's the third time") {
    const count = Number(ctx.abilityResolveCountThisTurn);
    return Number.isFinite(count) ? count >= 3 : false;
  }

  if (normalizedRaw === 'this is the third time this ability has resolved this turn') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const count = Number(
      ctx.abilityResolveCountThisTurn ??
        (nextState as any)?.abilityResolveCountThisTurn?.[sourceId] ??
        0
    );
    return Number.isFinite(count) ? count >= 3 : true;
  }

  if (normalizedRaw === 'a permanent left the battlefield under your control this turn' ||
    normalizedRaw === 'a permanent you controlled left the battlefield this turn'
  ) {
    const map = (nextState as any)?.permanentLeftBattlefieldThisTurn;
    return typeof map?.[controllerId] === 'boolean' ? map[controllerId] : null;
  }

  if (normalizedRaw === 'you attacked this turn') {
    return controllerAttackedThisTurn(nextState, controllerId);
  }

  if (
    normalizedRaw === "you didn't attack with a creature this turn" ||
    normalizedRaw === 'you did not attack with a creature this turn'
  ) {
    return !controllerAttackedThisTurn(nextState, controllerId);
  }

  if (normalizedRaw === "it's the first combat phase of your turn" || normalizedRaw === 'it is the first combat phase of your turn') {
    const combatPhases = Number((nextState as any)?.combatPhasesThisTurn?.[controllerId]);
    if (Number.isFinite(combatPhases)) return combatPhases <= 1;
    const phase = String((nextState as any)?.phase || '').trim().toLowerCase();
    return phase === 'combat' || phase === 'combat1' || phase === 'first_combat';
  }

  if (normalizedRaw === 'it attacked during its controller\'s last turn' || normalizedRaw === 'this creature attacked during its controller\'s last turn') {
    const referencedObject = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    if (!referencedObject) return null;
    return Boolean(
      (referencedObject as any)?.attackedLastTurn ??
        (referencedObject as any)?.attackedPreviousTurn ??
        (referencedObject as any)?.attackedLastTurn === true
    );
  }

  if (normalizedRaw === 'you had no cards in hand at the beginning of this turn') {
    const count = getHandCountAtBeginningOfTurn(nextState, controllerId);
    return count === null ? null : count === 0;
  }

  if (normalizedRaw === 'you had a card in hand' || normalizedRaw === 'you had at least one card in hand') {
    const count = getHandCountAtBeginningOfTurn(nextState, controllerId);
    return count === null ? null : count > 0;
  }
  return undefined;
}
