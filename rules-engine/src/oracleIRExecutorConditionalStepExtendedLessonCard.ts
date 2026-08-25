// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: leftover evaluateExtendedConditionalClause starting at
//   `there's a lesson card in your graveyard`.
// Public entry symbol: tryEvaluateExtendedLessonCardClause.

import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  antecedentApplied,
  cardsShareCardType,
  contextualCardsFrom,
  controlledCreatures,
  discardedCardsFrom,
  findBattlefieldPermanentByName,
  findExiledCardWithSource,
  getCastManaSpendSource,
  getConditionalSubjectCard,
  getCreaturePower,
  getDieRollResult,
  getGraveyardCards,
  getReferencedObject,
  getStackSpellCard,
  isPermanentAttacking,
  milledCardsFrom,
  movedCardsFrom,
  objectHasKeyword,
  objectHasType,
  parseSmallNumberWord,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { isSearchedLibraryThisWayLedgerFirst } from './oracleIRLedgerCardAccess';

export function tryEvaluateExtendedLessonCardClause(params: ExtendedConditionalParams): boolean | null {
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

  if (
    normalizedRaw === "there's a lesson card in your graveyard" ||
    normalizedRaw === 'there is a lesson card in your graveyard'
  ) {
    return getGraveyardCards(nextState, controllerId).some((card) => objectHasType(card, 'lesson'));
  }

  if (normalizedRaw === 'it has the same name as a permanent') {
    const moved = movedCardsFrom(params);
    const referencedName = String(
      (moved[0] as any)?.name ||
        (moved[0] as any)?.card?.name ||
        ctx.referencedCardName ||
        ctx.targetCardName ||
        ctx.selectorContext?.chosenCardName ||
        (ctx as any)?.chosenCardName ||
        ''
    )
      .trim()
      .toLowerCase();
    const fallbackRef = referencedName ? null : getReferencedObject(nextState, ctx);
    const cardName =
      referencedName ||
      String((fallbackRef as any)?.name || (fallbackRef as any)?.card?.name || '')
        .trim()
        .toLowerCase();
    if (!cardName) return null;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return battlefield.some((perm: any) => {
      const permName = String(perm?.name || perm?.card?.name || '')
        .trim()
        .toLowerCase();
      return permName.length > 0 && permName === cardName;
    });
  }

  {
    const cluesSacrificedMatch = normalizedRaw.match(
      /^you sacrificed (three|[a-z0-9]+) or more clues this turn$/i
    );
    if (cluesSacrificedMatch) {
      const threshold = parseSmallNumberWord(String(cluesSacrificedMatch[1] || ''));
      if (threshold === null) return null;
      const count = Number(
        (nextState as any)?.cluesSacrificedThisTurn?.[controllerId] ??
          (nextState as any)?.sacrificedCluesThisTurn?.[controllerId] ??
          (nextState as any)?.cluesSacrificedThisTurnCount?.[controllerId] ??
          NaN
      );
      return Number.isFinite(count) ? count >= threshold : false;
    }
  }

  if (normalizedRaw === 'a creature you control has first strike' || normalizedRaw === 'a creature you control has flying') {
    const keyword = normalizedRaw.includes('first strike') ? 'first strike' : 'flying';
    return controlledCreatures(nextState, controllerId).some(
      perm =>
        objectHasType(perm, keyword) ||
        (Array.isArray((perm as any)?.keywords) && (perm as any).keywords.some((k: string) => String(k).toLowerCase().includes(keyword)))
    );
  }

  if (normalizedRaw === 'it has flying') {
    const ref = getReferencedObject(nextState, ctx);
    return ref ? objectHasType(ref, 'flying') : false;
  }

  if (normalizedRaw === 'it has mutate' || normalizedRaw === 'this creature has mutate') {
    const spell = getCastManaSpendSource(nextState, ctx) ?? getReferencedObject(nextState, ctx);
    if (!spell) return null;
    return objectHasKeyword(spell, 'mutate');
  }

  {
    const counterOnItMatch = normalizedRaw.match(/^there are (three|[a-z0-9]+) or more ([a-z0-9' -]+) counters on (?:it|this enchantment)$/i);
    if (counterOnItMatch) {
      const threshold = parseSmallNumberWord(String(counterOnItMatch[1] || ''));
      const counterName = String(counterOnItMatch[2] || '').trim().toLowerCase();
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      const count = Number(((ref as any)?.counters || {})[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) >= threshold;
    }
    const exactCounterMatch = normalizedRaw.match(/^it has exactly (four|[a-z0-9]+) \+1\/\+1 counters on it$/i);
    if (exactCounterMatch) {
      const expected = parseSmallNumberWord(String(exactCounterMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || expected === null) return false;
      const count = Number(((ref as any)?.counters || {})['+1/+1'] ?? 0);
      return count === expected;
    }
    const creatureCounterMatch = normalizedRaw.match(/^that creature has (three|[a-z0-9]+) or more \+1\/\+0 counters on it$/i);
    if (creatureCounterMatch) {
      const threshold = parseSmallNumberWord(String(creatureCounterMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      const count = Number(((ref as any)?.counters || {})['+1/+0'] ?? 0);
      return count >= threshold;
    }
    if (normalizedRaw === 'that creature has a +1/+1 counter on it') {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      return Number(((ref as any)?.counters || {})['+1/+1'] ?? 0) > 0;
    }
    const thatCreaturePlusOneMatch = normalizedRaw.match(
      /^that creature has (three|[a-z0-9]+) or more \+1\/\+1 counters on it$/i
    );
    if (thatCreaturePlusOneMatch) {
      const threshold = parseSmallNumberWord(String(thatCreaturePlusOneMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      return Number(((ref as any)?.counters || {})['+1/+1'] ?? 0) >= threshold;
    }
    if (normalizedRaw === 'this card has no egg counters on it') {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      return Number(((ref as any)?.counters || {}).egg ?? 0) === 0;
    }
  }

  if (normalizedRaw === 'it isn\'t that player\'s turn' || normalizedRaw === 'it is not that player\'s turn' || normalizedRaw === "it's not that player's turn") {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim();
    const turnPlayer = String((nextState as any)?.turnPlayer || '').trim();
    return targetId ? turnPlayer !== targetId : false;
  }
  if (normalizedRaw === 'it\'s your main phase' || normalizedRaw === 'it is your main phase') {
    const phase = String((nextState as any)?.phase || '').trim().toLowerCase();
    return (phase === 'main1' || phase === 'main2' || phase === 'main') &&
      String((nextState as any)?.turnPlayer || '').trim() === controllerId;
  }
  if (normalizedRaw === 'it\'s the first combat phase of the turn' || normalizedRaw === 'it is the first combat phase of the turn') {
    return Number((nextState as any)?.combatPhasesThisTurn?.[controllerId] ?? 1) <= 1;
  }

  {
    const resultExactMatch = normalizedRaw.match(/^the result is (one|[a-z0-9]+)$/i);
    if (resultExactMatch) {
      const expected = parseSmallNumberWord(String(resultExactMatch[1] || ''));
      const rolled = getDieRollResult(nextState, controllerId);
      return expected !== null && rolled !== null ? rolled === expected : false;
    }
    const rollAtLeastMatch = normalizedRaw.match(/^the roll was (\d+) or higher$/i);
    if (rollAtLeastMatch) {
      const threshold = Number.parseInt(String(rollAtLeastMatch[1] || ''), 10);
      const rolled = getDieRollResult(nextState, controllerId);
      return Number.isFinite(threshold) && rolled !== null ? rolled >= threshold : false;
    }
    if (normalizedRaw === 'both coins come up heads' || normalizedRaw === 'both coins come up tails') {
      const wantHeads = normalizedRaw.includes('heads');
      const flips = (nextState as any)?.lastCoinFlips?.[controllerId];
      if (Array.isArray(flips) && flips.length >= 2) {
        return wantHeads ? flips.every(Boolean) : flips.every((v: boolean) => !v);
      }
      return false;
    }
  }

  if (normalizedRaw === 'that spell is a lesson') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find((e: any) => String(e?.id || '') === targetSpellId);
    const typeLine = String((stackSpell as any)?.card?.type_line || (stackSpell as any)?.type_line || '').toLowerCase();
    return typeLine.includes('lesson');
  }
  if (normalizedRaw === 'that spell was all colors') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find((e: any) => String(e?.id || '') === targetSpellId);
    const colors = (stackSpell as any)?.card?.colors || (stackSpell as any)?.colors;
    return Array.isArray(colors) ? colors.length >= 5 : false;
  }

  if (normalizedRaw === 'target attacking creature token is the chosen type') {
    const chosen = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const target = targetId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, targetId)
      : null;
    if (!target || !chosen) return false;
    return Boolean((target as any)?.isToken) && getExecutorTypeLineLower(target).includes(chosen);
  }

  if (normalizedRaw === 'dominion gets more votes') {
    const winning = String((ctx as any).winningVoteChoice || '').trim().toLowerCase();
    return winning === 'dominion';
  }

  if (normalizedRaw === 'an opponent controls that creature') {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    return String((ref as any)?.controller || '').trim() !== controllerId;
  }
  if (normalizedRaw === 'that player is you') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || '').trim();
    return !targetId || targetId === controllerId;
  }

  if (normalizedRaw === "its power is less than this creature's power") {
    const ref = getReferencedObject(nextState, ctx);
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!ref || !source) return false;
    return getCreaturePower(ref) < getCreaturePower(source);
  }

  if (normalizedRaw === "they didn't attack you that turn") {
    const attackerId = String(ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2').trim();
    const attackedMap = (nextState as any)?.attackedDefendingPlayersThisCombatByPlayer as Record<string, string[]> | undefined;
    const defenders = Array.isArray(attackedMap?.[attackerId]) ? attackedMap[attackerId] : [];
    return !defenders.includes(controllerId);
  }

  if (normalizedRaw === 'a noncreature, nonland card is milled this way') {
    const milled = milledCardsFrom(ctx);
    return milled.some(
      (card: any) => !objectHasType(card, 'creature') && !objectHasType(card, 'land')
    );
  }

  if (
    normalizedRaw ===
    "that creature's power is less than or equal to the number of warriors your team controls"
  ) {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    const warriorCount = controlledCreatures(nextState, controllerId).filter((perm: any) =>
      getExecutorTypeLineLower(perm).includes('warrior')
    ).length;
    return getCreaturePower(ref) <= warriorCount;
  }

  if (normalizedRaw === 'the copy is a permanent spell') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    const typeLine = String((stackSpell as any)?.card?.type_line || (stackSpell as any)?.type_line || '').toLowerCase();
    if (!typeLine) return false;
    return (
      typeLine.includes('creature') ||
      typeLine.includes('artifact') ||
      typeLine.includes('enchantment') ||
      typeLine.includes('planeswalker') ||
      typeLine.includes('battle') ||
      typeLine.includes('kindred')
    );
  }

  if (
    normalizedRaw ===
    'a card with the same name is in a graveyard or a nontoken permanent with the same name is on the battlefield'
  ) {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    const spellName = String((stackSpell as any)?.card?.name || (stackSpell as any)?.name || ctx.sourceName || '')
      .trim()
      .toLowerCase();
    if (!spellName) return false;
    for (const player of nextState.players || []) {
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      if (
        graveyard.some(
          (card: any) => String(card?.name || '').trim().toLowerCase() === spellName
        )
      ) {
        return true;
      }
    }
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return battlefield.some((perm: any) => {
      if ((perm as any)?.isToken) return false;
      const name = String((perm as any)?.name || (perm as any)?.card?.name || '')
        .trim()
        .toLowerCase();
      return name === spellName;
    });
  }

  if (normalizedRaw === "each opponent who doesn't control an elf") {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === controllerId) return false;
      return !((nextState.battlefield || []) as any[]).some(
        perm => perm?.controller === playerId && getExecutorTypeLineLower(perm).includes('elf')
      );
    });
  }

  if (
    normalizedRaw ===
    'this permanent is your ring-bearer and the ring has tempted you two or more times this game'
  ) {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const temptCount = Number(player?.ringTemptations ?? 0);
    const sourceId = String(ctx.sourceId || '').trim();
    const ringBearerId = String(player?.ringBearerId || player?.ringBearerPermanentId || sourceId).trim();
    return ringBearerId === sourceId && temptCount >= 2;
  }

  if (/^you chose a creature other than this permanent as your ring-bearer$/i.test(normalizedRaw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const ringBearerId = String(
      ctx.chosenRingBearerId ??
        ctx.selectorContext?.chosenRingBearerId ??
        (nextState.players.find((player) => player.id === controllerId) as any)?.ringBearerId ??
        ''
    ).trim();
    if (!sourceId || !ringBearerId) return null;
    return ringBearerId !== sourceId;
  }

  if (normalizedRaw === "the result is equal to this vehicle's mana value") {
    const rolled = getDieRollResult(nextState, controllerId);
    const source = getReferencedObject(nextState, ctx);
    const mv = source ? getCardManaValue((source as any)?.card || source) : null;
    return rolled !== null && mv !== null ? rolled === mv : false;
  }

  if (normalizedRaw === 'one or more opponents had the highest result') {
    return typeof (ctx as any).opponentHadHighestRollResult === 'boolean'
      ? (ctx as any).opponentHadHighestRollResult
      : true;
  }

  if (
    normalizedRaw ===
    'each opponent who discarded a card that shares a card type with the card you discarded'
  ) {
    return discardedCardsFrom(params).length > 0;
  }

  if (normalizedRaw === 'you are one of those players') {
    return true;
  }

  if (/^you searched for a creature card that doesn't have that name$/.test(normalizedRaw)) {
    if (isSearchedLibraryThisWayLedgerFirst(params.ctx)) return true;
    if (params.ctx.searchedLibraryThisWay === true) return true;
    return antecedentApplied(lastActionOutcome, ['search_library']);
  }

  if (
    normalizedRaw ===
    'this permanent and a creature named phyrexian dragon engine are attacking, and you both own and control them'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const named = findBattlefieldPermanentByName(nextState, 'phyrexian dragon engine');
    if (!source || !named) return false;
    const controller = String(controllerId || '').trim();
    const sourceControlled =
      String((source as any)?.controller || '').trim() === controller &&
      String((source as any)?.owner || (source as any)?.controller || '').trim() === controller;
    const namedControlled =
      String((named as any)?.controller || '').trim() === controller &&
      String((named as any)?.owner || (named as any)?.controller || '').trim() === controller;
    return sourceControlled && namedControlled && isPermanentAttacking(source) && isPermanentAttacking(named);
  }

  if (normalizedRaw === 'it targets a permanent or player, and you may choose new targets for the copy') {
    const stackSpell = getStackSpellCard(nextState, ctx);
    if (!stackSpell) return true;
    const targets = (stackSpell as any)?.targets ?? (stackSpell as any)?.targetIds;
    return Array.isArray(targets) ? targets.length > 0 : true;
  }

  if (normalizedRaw === 'any of those cards shares a card type with that spell') {
    const spell = getStackSpellCard(nextState, ctx);
    const cards = contextualCardsFrom(params);
    if (!spell || cards.length === 0) return false;
    return cards.some(card => cardsShareCardType(card, spell));
  }

  if (normalizedRaw === 'it shares a card type with the exiled card') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const exiledCard = findExiledCardWithSource(nextState, sourceId);
    if (!exiledCard) return null;
    const triggeringCard =
      getStackSpellCard(nextState, ctx) ??
      (ctx as any)?.triggeringSpellCard ??
      contextualCardsFrom(params)[0] ??
      (ctx as any)?.lastCastSpellCard;
    if (!triggeringCard) return null;
    return cardsShareCardType(triggeringCard, exiledCard);
  }
  return null;
}
