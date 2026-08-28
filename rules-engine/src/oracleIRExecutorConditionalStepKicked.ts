/**
 * Origin: oracleIRExecutorConditionalStepSupport.ts
 * Cluster: evaluateConditionalWrapperCondition kicked / you-do / composite-and-or / graveyard-there-are clauses
 * Public: tryEvaluateConditionalKicked
 */
import type {
  EvaluateConditionalWrapperConditionParams,
  LastActionOutcome,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import {
  battlefieldObjectHasType,
  battlefieldObjectMatchesDescriptor,
  cardHasType,
  countControlledBattlefieldObjectsMatching,
  countCreaturesAttackedThisTurn,
  countYourGraveyardCards,
  getReferencedConditionalObject,
  getSingleChosenObjectId,
  getYourGraveyardCards,
  matchesCardTypeDescriptor,
  movedCardsFromCtx,
  parseSmallNumberWord,
  playerRolledDoubles,
  resolveConditionalCounterObject,
  resolveKickedStatus,
  resolveKickedTwiceStatus,
  splitCompositeCondition,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { isSearchedLibraryThisWayLedgerFirst } from './oracleIRLedgerCardAccess';

export function tryEvaluateConditionalKicked(
  params: EvaluateConditionalWrapperConditionParams,
): boolean | null | undefined {
  const {
    condition,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastStepOutcome = null,
    pendingSteps,
    lastMovedCards,
    lastDiscardedCards,
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

  const sourceRefForEarlyChecks = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );

  if (normalizedRaw === 'it was kicked' || normalizedRaw === 'this spell was kicked') {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? null : kicked;
  }

  if (normalizedRaw === 'that spell was kicked') {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? null : kicked;
  }

  if (normalizedRaw === 'this creature was kicked') {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? false : kicked;
  }

  if (normalizedRaw === 'it was kicked twice') {
    return resolveKickedTwiceStatus(nextState, ctx, sourceRefForEarlyChecks);
  }

  if (normalizedRaw === 'life was paid to activate it') {
    const explicit =
      (ctx as any)?.lifeWasPaidToActivateIt ??
      (ctx as any)?.lifePaidToActivateIt ??
      (ctx.selectorContext as any)?.lifeWasPaidToActivateIt;
    if (typeof explicit === 'boolean') return explicit;
    const stackItem =
      (ctx as any)?.stackItem ??
      ((nextState as any)?.stack || []).find(
        (entry: any) =>
          String(entry?.id || '').trim() ===
          String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim()
      );
    if (!stackItem) return null;
    const abilityTextRaw = String(
      (stackItem as any)?.abilityText ??
        (stackItem as any)?.activatedAbilityText ??
        (stackItem as any)?.description ??
        ''
    ).trim();
    if (!abilityTextRaw) return null;
    const colonIdx = abilityTextRaw.indexOf(':');
    if (colonIdx <= 0) return null;
    const costPart = abilityTextRaw.slice(0, colonIdx).toLowerCase();
    if (/\bor\b/i.test(costPart)) return null;
    if (/\bmay\s+pay\b/i.test(costPart)) return null;
    if (/\bpay\s+([0-9]+|x)\s+life\b/i.test(costPart)) return true;
    return null;
  }

  {
    const specificKickerMatch = normalizedRaw.match(
      /^(?:it|this spell|this creature|this permanent) was kicked with its .+ kicker$/i
    );
    if (specificKickerMatch) {
      const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
      return kicked === null ? null : kicked;
    }
  }

  if (
    normalizedRaw === "it wasn't kicked" ||
    normalizedRaw === 'it was not kicked' ||
    normalizedRaw === "this spell wasn't kicked" ||
    normalizedRaw === 'this spell was not kicked' ||
    normalizedRaw === "this creature wasn't kicked" ||
    normalizedRaw === 'this creature was not kicked'
  ) {
    const kicked = resolveKickedStatus(nextState, ctx, sourceRefForEarlyChecks);
    return kicked === null ? null : !kicked;
  }

  if (normalizedRaw === 'you rolled doubles') {
    return playerRolledDoubles(nextState, controllerId);
  }

  {
    const manaSpentThisSpellMatch = normalizedRaw.match(/^\{([wubrgcs])\} was spent to cast this spell$/i);
    if (manaSpentThisSpellMatch) {
      const spent = getAmountOfSpecificManaSymbolSpent(sourceRefForEarlyChecks, manaSpentThisSpellMatch[1]);
      return spent === null ? false : spent > 0;
    }
  }

  {
    const attackedCountMatch = normalizedRaw.match(
      /^you attacked with (two|[a-z0-9]+) or more creatures this turn$/i
    );
    if (attackedCountMatch) {
      const threshold = parseSmallNumberWord(String(attackedCountMatch[1] || '').trim());
      if (threshold !== null) {
        return countCreaturesAttackedThisTurn(nextState, controllerId) >= threshold;
      }
    }
  }

  {
    const graveyardCountMatch = normalizedRaw.match(/^([a-z0-9]+) or more cards are in your graveyard$/i);
    if (graveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(graveyardCountMatch[1] || '').trim());
      if (threshold !== null) {
        return getYourGraveyardCards(nextState, controllerId).length >= threshold;
      }
    }
  }

  {
    const andParts = splitCompositeCondition(normalizedRaw, 'and');
    if (andParts) {
      const results = andParts.map(part =>
        evaluateConditionalWrapperCondition({
          ...params,
          condition: { ...condition, raw: part },
        })
      );
      return results.every(result => result === true)
        ? true
        : results.some(result => result === false)
          ? false
          : null;
    }
  }

  const orParts = splitCompositeCondition(normalizedRaw, 'or');
  if (orParts) {
    const results = orParts.map(part =>
      evaluateConditionalWrapperCondition({
        ...params,
        condition: { ...condition, raw: part },
      })
    );
    return results.some(result => result === true)
      ? true
      : results.every(result => result === false)
        ? false
        : null;
  }

  {
    const youDoNotControlMatch = normalizedRaw.match(/^you (?:don't|do not) control (?:a|an|one or more)\s+(.+)$/i);
    if (youDoNotControlMatch) {
      const descriptor = String(youDoNotControlMatch[1] || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return !battlefield.some(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          battlefieldObjectMatchesDescriptor(perm, descriptor)
      );
    }
  }

  if (
    /^you (?:don't|do not)\b/i.test(normalizedRaw) ||
    /^they (?:don't|do not)\b/i.test(normalizedRaw) ||
    /^the player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^that player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^a player (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^each opponent who (?:doesn't|does not)\b/i.test(normalizedRaw) ||
    /^the player can't\b/i.test(normalizedRaw) ||
    normalizedRaw === "it doesn't" ||
    normalizedRaw === 'it does not'
  ) {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied') return false;
    if (lastActionOutcome) return true;
    // With no antecedent in the sequence there is nothing to have declined, so "you don't" is
    // unevaluable. Defaulting it to true fires the punisher branch unprompted - "If you don't,
    // sacrifice this artifact" would sacrifice on its own.
    return null;
  }

  if (
    normalizedRaw === "you can't" ||
    normalizedRaw === 'you can not' ||
    normalizedRaw.startsWith("you can't,") ||
    normalizedRaw.startsWith('you can not,')
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    // An antecedent waiting on a choice is still possible - "exile two cards from your graveyard"
    // with three cards there can be done, the player just has not picked which two. Treating that
    // as "you can't" fires the punisher branch (sacrifice Egon, draw) while the exile is pending.
    if (antecedent?.kind === 'applied' || antecedent?.kind === 'choice_required') return false;
    if (antecedent) return true;
    return null;
  }

  if (normalizedRaw === 'no player does') {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.kind === 'applied') return false;
    if (antecedent?.kind === 'impossible') return true;
    if ((ctx as any)?.optionalOfferAccepted === true) return false;
    if ((ctx as any)?.optionalOfferAccepted === false) return true;
    return null;
  }

  if (
    normalizedRaw === 'you do' ||
    normalizedRaw === 'the player does' ||
    normalizedRaw === 'a player does' ||
    normalizedRaw === 'they do' ||
    normalizedRaw === 'that player does'
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.kind === 'applied' && antecedent.stepKind === 'tap_matching_permanents') {
      const count = Number(antecedent.count ?? 0);
      return Number.isFinite(count) ? count > 0 : true;
    }
    if (antecedent?.kind === 'applied') return true;
    if (antecedent) return false;
    return false;
  }

  if (
    normalizedRaw === 'you search your library this way' ||
    normalizedRaw === 'they search their library this way' ||
    normalizedRaw === 'that player searches their library this way' ||
    normalizedRaw === 'an opponent searches their library this way' ||
    normalizedRaw === 'you searched your library this way'
  ) {
    if (isSearchedLibraryThisWayLedgerFirst(ctx, params.step)) return true;
    if (ctx.searchedLibraryThisWay === true) return true;
    const antecedent = getAffirmativeAntecedentOutcome();
    if (antecedent?.stepKind === 'search_library' && antecedent.kind === 'applied') return true;
    if (antecedent?.stepKind === 'search_library' || ctx.searchedLibraryThisWay === false) return false;
    return false;
  }

  if (
    normalizedRaw === 'that spell would be put into a graveyard' ||
    normalizedRaw === 'that spell would be put into a graveyard from anywhere' ||
    normalizedRaw === 'it would be put into a graveyard' ||
    normalizedRaw === 'this spell would be put into a graveyard'
  ) {
    const antecedent = getAffirmativeAntecedentOutcome();
    if (
      antecedent?.kind === 'applied' &&
      (antecedent.stepKind === 'grant_graveyard_permission' ||
        String(antecedent.stepKind) === 'cast_spell' ||
        antecedent.stepKind === 'copy_spell')
    ) {
      return true;
    }
    if (antecedent) return false;
    return null;
  }

  if (
    normalizedRaw === 'this permanent would be put into a graveyard from anywhere' ||
    normalizedRaw === 'this creature would be put into a graveyard from anywhere'
  ) {
    return true;
  }

  if (normalizedRaw === "you can't" || normalizedRaw === 'you cannot') {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.kind === 'applied' || lastActionOutcome?.kind === 'choice_required') return false;
    return null;
  }

  if (normalizedRaw === "they can't" || normalizedRaw === 'they cannot') {
    if (lastActionOutcome?.kind === 'impossible') return true;
    if (lastActionOutcome?.stepKind === 'discard' && lastActionOutcome?.kind === 'applied') return false;
    return null;
  }

  if (normalizedRaw === 'a creature died this turn') {
    return Boolean((nextState as any)?.creatureDiedThisTurn);
  }

  if (normalizedRaw === 'you gained life this turn') {
    return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) > 0;
  }

  if (normalizedRaw === 'you gained or lost life this turn') {
    const gained = Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0);
    const lost = Number(((nextState as any)?.lifeLostThisTurn || {})?.[controllerId] || 0);
    return gained > 0 || lost > 0;
  }

  if (
    normalizedRaw === "you've committed a crime this turn" ||
    normalizedRaw === 'you have committed a crime this turn'
  ) {
    const stateAny = nextState as any;
    const crimeMap =
      stateAny?.committedCrimeThisTurn ||
      stateAny?.crimeCommittedThisTurn ||
      stateAny?.hasCommittedCrimeThisTurn;
    if (crimeMap && typeof crimeMap[controllerId] === 'boolean') return crimeMap[controllerId];
    return null;
  }

  if (normalizedRaw === 'evidence was collected') {
    return typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : null;
  }

  if (
    normalizedRaw === 'defending player has the most life or is tied for the most life' ||
    normalizedRaw === 'the defending player has the most life or is tied for the most life'
  ) {
    const defendingPlayerId = String(
      ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2'
    ).trim();
    if (!defendingPlayerId) return null;

    const lifeTotals = ((nextState as any)?.players || [])
      .map((player: any) => Number(player?.life))
      .filter((life: number) => Number.isFinite(life));
    if (lifeTotals.length === 0) return null;

    const defendingPlayer = ((nextState as any)?.players || []).find(
      (player: any) => String(player?.id || '').trim() === defendingPlayerId
    );
    const defendingLife = Number((defendingPlayer as any)?.life);
    if (!Number.isFinite(defendingLife)) return null;

    return defendingLife === Math.max(...lifeTotals);
  }

  if (
    normalizedRaw === "this creature isn't renowned" ||
    normalizedRaw === "this permanent isn't renowned" ||
    normalizedRaw === "it isn't renowned" ||
    normalizedRaw === "this creature is not renowned" ||
    normalizedRaw === "this permanent is not renowned" ||
    normalizedRaw === "it is not renowned"
  ) {
    const battlefield = getProcessedBattlefield(nextState);
    const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
    if (!referencedObject) return null;
    const isRenowned =
      typeof (referencedObject as any)?.isRenowned === 'boolean'
        ? Boolean((referencedObject as any).isRenowned)
        : typeof (referencedObject as any)?.renowned === 'boolean'
          ? Boolean((referencedObject as any).renowned)
          : false;
    return !isRenowned;
  }

  {
    const youControlMatch = normalizedRaw.match(/^you control (?:a|an|one or more)\s+(.+)$/i);
    if (youControlMatch) {
      const descriptor = String(youControlMatch[1] || '').trim();
      const battlefield = getProcessedBattlefield(nextState) as any[];
      return battlefield.some(
        (perm: any) =>
          String(perm?.controller || '').trim() === controllerId &&
          battlefieldObjectMatchesDescriptor(perm, descriptor)
      );
    }
  }

  {
    const returnedToHandMatch = normalizedRaw.match(
      /^returned (?:a|an) ([a-z][a-z'-]*) card to your hand this way$/i
    );
    if (returnedToHandMatch) {
      const subtype = String(returnedToHandMatch[1] || '').trim().toLowerCase();
      const movedCards = [
        ...(Array.isArray(lastMovedCards) ? lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      return movedCards.some((card: any) => {
        const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
        return typeLine.includes(subtype);
      });
    }
  }

  {
    const gainedLifeThresholdMatch = normalizedRaw.match(/^you gained ([a-z0-9]+) or more life this turn$/i);
    if (gainedLifeThresholdMatch) {
      const threshold = parseSmallNumberWord(String(gainedLifeThresholdMatch[1] || ''));
      if (threshold !== null) {
        return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) >= threshold;
      }
    }
  }

  if (normalizedRaw === "you're the monarch" || normalizedRaw === 'you are the monarch') {
    return String((nextState as any)?.monarch || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === 'there is no monarch') {
    return !String((nextState as any)?.monarch || '').trim();
  }

  if (
    normalizedRaw === 'you have the initiative' ||
    normalizedRaw === "you've got the initiative"
  ) {
    return String((nextState as any)?.initiative || '').trim() === String(controllerId || '').trim();
  }

  if (normalizedRaw === "you or a player you're attacking has the initiative") {
    const initiative = String((nextState as any)?.initiative || '').trim();
    if (!initiative) return false;
    if (initiative === String(controllerId || '').trim()) return true;
    const source = getReferencedConditionalObject(nextState, getProcessedBattlefield(nextState), ctx);
    const defendingPlayerId = String(
      (ctx as any)?.defendingPlayerId ??
        ctx.selectorContext?.targetOpponentId ??
        (source as any)?.defendingPlayerId ??
        (source as any)?.attacking ??
        ''
    ).trim();
    return Boolean(defendingPlayerId && initiative === defendingPlayerId);
  }

  if (
    normalizedRaw === 'you completed a dungeon this turn' ||
    normalizedRaw === "you've completed a dungeon this turn" ||
    normalizedRaw === 'you have completed a dungeon this turn'
  ) {
    return Boolean(((nextState as any)?.dungeonCompletedThisTurn || {})?.[controllerId]);
  }

  if (
    normalizedRaw === 'you completed a dungeon' ||
    normalizedRaw === "you've completed a dungeon" ||
    normalizedRaw === 'you have completed a dungeon'
  ) {
    return Boolean(((nextState as any)?.dungeonCompleted || {})?.[controllerId]);
  }

  if (normalizedRaw === 'the gift was promised') {
    return typeof ctx.giftPromised === 'boolean' ? ctx.giftPromised : null;
  }

  if (normalizedRaw === "it's your turn" || normalizedRaw === 'it is your turn' || normalizedRaw === 'your turn') {
    return String((nextState as any)?.turnPlayer || '').trim() === String(controllerId || '').trim();
  }

  const battlefield = getProcessedBattlefield(nextState);

  {
    const noCountersMatch = normalizedRaw.match(
      /^(?:there are no|it has no|this creature has no|this permanent has no|this aura has no|this enchantment has no)\s+(.+?)\s+counters?\s+on\s+(?:it|this aura|this permanent|this creature|this enchantment)$/i
    );
    if (noCountersMatch) {
      const selfReference = String(
        normalizedRaw.match(/\s+on\s+(this aura|this permanent|this creature|this enchantment|it)$/i)?.[1] || 'it'
      ).trim();
      const referencedObject = resolveConditionalCounterObject(nextState, ctx, selfReference);
      if (!referencedObject) return null;
      const counterName = String(noCountersMatch[1] || '').trim().toLowerCase();
      if (!counterName) return null;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const count = Number(counters[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) === 0;
    }
  }

  {
    const oddCounterMatch = normalizedRaw.match(/^it has an odd number of counters on it$/i);
    if (oddCounterMatch) {
      const referencedObject = getReferencedConditionalObject(nextState, battlefield, ctx);
      if (!referencedObject) return null;
      const counters = ((referencedObject as any)?.counters || {}) as Record<string, unknown>;
      const total = Object.values(counters).reduce<number>((sum, value) => {
        const count = Number(value);
        return sum + (Number.isFinite(count) ? count : 0);
      }, 0);
      return total % 2 === 1;
    }
  }

  {
    const thatLandIsTypeMatch = normalizedRaw.match(/^that land is (?:a|an) ([a-z0-9' -]+)$/i);
    if (thatLandIsTypeMatch) {
      const typeName = String(thatLandIsTypeMatch[1] || '').trim().toLowerCase();
      if (!typeName) return null;

      const movedLand = movedCardsFromCtx(ctx, lastMovedCards).find((card: any) => cardHasType(card, 'land')) ?? null;
      if (movedLand) return matchesCardTypeDescriptor(movedLand, typeName);

      const referencedId =
        getSingleChosenObjectId(ctx) ||
        String(ctx.targetPermanentId || '').trim() ||
        String(ctx.sourceId || '').trim();
      if (referencedId) {
        const referencedLand = battlefield.find((perm: any) => String(perm?.id || '').trim() === referencedId);
        if (referencedLand) return battlefieldObjectHasType(referencedLand, typeName);
      }
      return false;
    }
  }

  {
    const contextualCardTypeMatch = normalizedRaw.match(
      /^(?:it(?:'s| is)?|that card|that creature|that permanent|this card|this permanent) (?:is )?(?:a|an) ([a-z0-9' -]+?)(?: card)?$/i
    );
    if (
      contextualCardTypeMatch &&
      !/\bshares a (?:creature|card) type\b/i.test(String(contextualCardTypeMatch[1] || ''))
    ) {
      const typeName = String(contextualCardTypeMatch[1] || '').trim().toLowerCase();
      const referencedId =
        String(ctx.targetPermanentId || '').trim() ||
        getSingleChosenObjectId(ctx) ||
        String(ctx.sourceId || '').trim();
      if (typeName && referencedId) {
        const referencedObject = findObjectByIdInState(nextState, battlefield as any, referencedId);
        if (!referencedObject) return false;

        const battlefieldObject = battlefield.find(
          (perm: any) => String(perm?.id || '').trim() === referencedId
        );
        return battlefieldObject
          ? battlefieldObjectHasType(battlefieldObject, typeName)
          : cardHasType(referencedObject, typeName);
      }
    }
  }

  {
    const youControlCountMatch = raw.match(/^you control ([a-z0-9]+) or more ([a-z0-9' -]+?)(?:s)?$/i);
    if (youControlCountMatch) {
      const threshold = parseSmallNumberWord(String(youControlCountMatch[1] || ''));
      const typeName = String(youControlCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = battlefield.filter((perm: any) =>
          String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
          battlefieldObjectHasType(perm, typeName)
        ).length;
        return count >= threshold;
      }
    }
  }

  {
    const youControlSingleMatch = raw.match(/^you control (?:a|an) ([a-z0-9' -]+)$/i);
    if (youControlSingleMatch) {
      const typeName = String(youControlSingleMatch[1] || '').trim().toLowerCase();
      if (typeName) {
        return countControlledBattlefieldObjectsMatching({
          battlefield,
          controllerId,
          typeNames: [typeName],
        }) >= 1;
      }
    }
  }

  {
    const tappedMixedTypeMatch = raw.match(
      /^you control ([a-z0-9]+) or more tapped ([a-z0-9' -]+?)s? and\/or ([a-z0-9' -]+?)s?$/i
    );
    if (tappedMixedTypeMatch) {
      const threshold = parseSmallNumberWord(String(tappedMixedTypeMatch[1] || ''));
      const firstType = String(tappedMixedTypeMatch[2] || '').trim().toLowerCase();
      const secondType = String(tappedMixedTypeMatch[3] || '').trim().toLowerCase();
      if (threshold !== null && firstType && secondType) {
        return countControlledBattlefieldObjectsMatching({
          battlefield,
          controllerId,
          typeNames: [firstType, secondType],
          tappedOnly: true,
        }) >= threshold;
      }
    }
  }

  {
    const graveyardCountMatch = raw.match(/^([a-z0-9]+) or more ([a-z0-9' -]+?) cards are in your graveyard$/i);
    if (graveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(graveyardCountMatch[1] || ''));
      const typeName = String(graveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null && typeName) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          ctx,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  {
    const thereAreGraveyardCountMatch = raw.match(/^there are ([a-z0-9]+) or more(?: ([a-z0-9' -]+?))? cards in your graveyard$/i);
    if (thereAreGraveyardCountMatch) {
      const threshold = parseSmallNumberWord(String(thereAreGraveyardCountMatch[1] || ''));
      const typeName = String(thereAreGraveyardCountMatch[2] || '').trim().toLowerCase();
      if (threshold !== null) {
        const count = countYourGraveyardCards({
          nextState,
          controllerId,
          typeName,
          pendingSteps,
          ctx,
          lastMovedCards,
        });
        return count >= threshold;
      }
    }
  }

  return undefined;
}
