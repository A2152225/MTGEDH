// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: leftover evaluateExtendedConditionalClause starting at
//   `each opponent who voted for a choice you didn't vote for`.
// Public entry symbol: tryEvaluateExtendedVotedChoiceClause.

import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  cardMatchesChosenColor,
  contextualCardsFrom,
  discardedCardsFrom,
  getCastManaSpendSource,
  getConditionalSubjectCard,
  getCreaturePower,
  getCreatureToughness,
  getReferencedObject,
  getSpellsCastLastTurnByPlayerCounts,
  getSpellsCastLastTurnCount,
  isPermanentInCommandZoneOrBattlefield,
  movedCardsFrom,
  noColoredManaWasSpentToCast,
  objectHasAnyCounters,
  objectHasKeyword,
  objectHasType,
  opponentLostLifeThisTurn,
  parseSmallNumberWord,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getAmountOfManaSpent, getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';

export function tryEvaluateExtendedVotedChoiceClause(params: ExtendedConditionalParams): boolean | null {
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


  if (normalizedRaw === "each opponent who voted for a choice you didn't vote for") {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      return playerId && playerId !== controllerId;
    });
  }

  {
    const chosenLibraryNameCountMatch = normalizedRaw.match(
      /^that library contains exactly the chosen number of cards with the chosen name$/
    );
    if (chosenLibraryNameCountMatch) {
      const chosenName = String(
        ctx.selectorContext?.chosenCardName || (ctx as any)?.chosenCardName || ''
      ).trim();
      const chosenNumber = Number(
        ctx.selectorContext?.chosenNumber ?? (ctx as any)?.chosenNumber
      );
      if (!chosenName || !Number.isFinite(chosenNumber)) return null;
      const revealed = movedCardsFrom(params);
      if (revealed.length === 0) return null;
      const normalizedChosenName = chosenName.toLowerCase();
      const matchingCount = revealed.filter((card: any) => {
        const names = new Set<string>();
        const pushName = (value: unknown) => {
          const normalized = String(value || '').trim().toLowerCase();
          if (normalized) names.add(normalized);
        };
        pushName(card?.name);
        pushName(card?.card?.name);
        return names.has(normalizedChosenName);
      }).length;
      return matchingCount === Math.max(0, Math.floor(chosenNumber));
    }
  }

  {
    const chosenHandColorCountMatch = normalizedRaw.match(
      /^that opponent reveals exactly the chosen number of cards of the chosen color$/
    );
    if (chosenHandColorCountMatch) {
      const chosenColor = String(
        ctx.selectorContext?.chosenColor || (ctx as any)?.chosenColor || ''
      ).trim();
      const chosenNumber = Number(
        ctx.selectorContext?.chosenNumber ?? (ctx as any)?.chosenNumber
      );
      if (!chosenColor || !Number.isFinite(chosenNumber)) return null;
      const revealed = movedCardsFrom(params);
      if (revealed.length === 0) return null;
      const matchingCount = revealed.filter((card: any) => cardMatchesChosenColor(card, chosenColor)).length;
      return matchingCount === Math.max(0, Math.floor(chosenNumber));
    }
  }

  if (normalizedRaw === "it isn't a land card" || normalizedRaw === 'it is not a land card') {
    const ref = getConditionalSubjectCard(params);
    if (!ref) return null;
    return !objectHasType(ref, 'land');
  }

  if (normalizedRaw === "that player doesn't" || normalizedRaw === 'that player does not') {
    const payment =
      ctx.unlessPaysManaChoice ??
      ctx.selectorContext?.unlessPaysManaChoice ??
      ctx.unlessPaysLifeChoice ??
      ctx.selectorContext?.unlessPaysLifeChoice;
    if (payment === 'pay') return false;
    return true;
  }

  {
    const paysOnlyMatch = normalizedRaw.match(/^that player pays only (\{[^}]+\})$/i);
    if (paysOnlyMatch) {
      const payment =
        ctx.unlessPaysManaChoice ??
        ctx.selectorContext?.unlessPaysManaChoice ??
        ctx.unlessPaysLifeChoice ??
        ctx.selectorContext?.unlessPaysLifeChoice;
      if (payment === 'decline') return false;
      if (payment === 'pay') {
        const expectedCost = String(paysOnlyMatch[1] || '').trim().toLowerCase();
        const paidCost = String(
          (ctx as any)?.unlessPaysManaAmount ??
            ctx.selectorContext?.unlessPaysManaAmount ??
            '{1}'
        ).trim().toLowerCase();
        return paidCost === expectedCost;
      }
      return false;
    }
  }

  if (normalizedRaw.startsWith('not (')) {
    const inner = normalizedRaw.slice(5, -1).trim();
    const knownUnless =
      /^you put two cards from your graveyard on the bottom of your library/.test(inner) ||
      /^you tap an untapped permanent you control/.test(inner) ||
      /^you tap an untapped creature you control/.test(inner) ||
      /^you tap an untapped artifact or land you control/.test(inner) ||
      /^you put a card from your graveyard on the bottom of your library/.test(inner) ||
      /^you sacrifice any number of creatures with total power 12 or greater/.test(inner) ||
      /^you exile a creature you control other than this creature/.test(inner) ||
      /^you remove a counter from a permanent you control/.test(inner) ||
      /^an opponent has three or more poison counters/.test(inner) ||
      /^a nonland permanent left the battlefield this turn or a spell was warped this turn/.test(inner);
    if (knownUnless) return false;
  }

  if (normalizedRaw === 'no spells were cast last turn') {
    const last = getSpellsCastLastTurnCount(nextState);
    return last === null ? true : last === 0;
  }
  if (normalizedRaw === 'a player cast two or more spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (!counts) return true;
    return Object.values(counts).some((count) => typeof count === 'number' && count >= 2);
  }
  if (normalizedRaw === 'an opponent cast two or more spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (!counts) return true;
    return Object.entries(counts).some(([playerId, count]) => playerId !== controllerId && Number(count) >= 2);
  }
  if (normalizedRaw === 'you cast two or more spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (!counts) return true;
    const count = counts[controllerId];
    return typeof count === 'number' ? count >= 2 : true;
  }
  if (normalizedRaw === 'you cast no spells last turn') {
    const counts = getSpellsCastLastTurnByPlayerCounts(nextState);
    if (counts && typeof counts[controllerId] === 'number') return counts[controllerId] === 0;
    const last = getSpellsCastLastTurnCount(nextState);
    return last === null ? true : last === 0;
  }
  if (normalizedRaw === 'you cast it') {
    return true;
  }
  if (normalizedRaw === 'you discarded a nonland card') {
    const discarded = discardedCardsFrom(params);
    if (discarded.length > 0) {
      return discarded.some((card) => !objectHasType(card, 'land'));
    }
    return lastActionOutcome?.stepKind === 'discard' && lastActionOutcome.kind === 'applied';
  }
  if (normalizedRaw === 'an opponent lost life this turn') {
    return opponentLostLifeThisTurn(nextState, controllerId);
  }
  if (normalizedRaw === 'you descended this turn') {
    return Boolean((nextState as any)?.descendedThisTurn?.[controllerId]);
  }
  if (normalizedRaw === "tribute wasn't paid" || normalizedRaw === 'tribute was not paid') {
    return ctx.tributePaid === true ? false : true;
  }
  if (normalizedRaw === 'it had counters on it') {
    const moved = contextualCardsFrom(params);
    const cards = moved.length > 0 ? moved : [getConditionalSubjectCard(params)].filter(Boolean);
    if (cards.length > 0) {
      return cards.some((card) => objectHasAnyCounters(card));
    }
    return true;
  }
  if (normalizedRaw === 'this permanent has counters on it') {
    const source =
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      ) ?? getReferencedObject(nextState, ctx);
    if (!source) return null;
    return objectHasAnyCounters(source);
  }
  if (
    normalizedRaw === "it isn't being declared as an attacker" ||
    normalizedRaw === 'it is not being declared as an attacker'
  ) {
    const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!subject) return null;
    const subjectId = String((subject as any)?.id || ctx.targetPermanentId || '').trim();
    const subjectController = String(
      (subject as any)?.controller || ctx.targetPlayerId || ctx.selectorContext?.targetPlayerId || ''
    ).trim();
    if (!subjectId) return null;

    const declaredByPlayer = (nextState as any)?.attackersDeclaredThisCombatByPlayer;
    if (declaredByPlayer && typeof declaredByPlayer === 'object') {
      const playerKey = subjectController || controllerId;
      const list = (declaredByPlayer as any)[playerKey];
      if (Array.isArray(list)) {
        const isDeclared = list.some((entry: any) => {
          const id =
            typeof entry === 'string' ? entry : String(entry?.id ?? entry?.creatureId ?? '').trim();
          return id === subjectId;
        });
        return !isDeclared;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(subject, 'attacking') ||
      Object.prototype.hasOwnProperty.call(subject, 'isAttacking')
    ) {
      return !(subject as any).attacking && (subject as any).isAttacking !== true;
    }
    return null;
  }
  if (normalizedRaw === 'this permanent is in the command zone or on the battlefield') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    return isPermanentInCommandZoneOrBattlefield(nextState, controllerId, sourceId);
  }
  {
    const damageToItMatch = normalizedRaw.match(
      /^([a-z0-9]+) or more damage was dealt to it this turn$/i
    );
    if (damageToItMatch) {
      const threshold = parseSmallNumberWord(String(damageToItMatch[1] || '').trim());
      const subject = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
      if (!subject || threshold === null) return null;
      const subjectId = String((subject as any)?.id || '').trim();
      const damage = Number(
        (subject as any)?.damageThisTurn ??
          (subject as any)?.combatDamageThisTurn ??
          (subject as any)?.card?.damageThisTurn ??
          (subject as any)?.card?.combatDamageThisTurn ??
          (subjectId ? (nextState as any)?.damageDealtThisTurnByPermanent?.[subjectId] : NaN) ??
          0
      );
      if (Number.isFinite(damage) && damage > 0) return damage >= threshold;
      if ((subject as any)?.tookDamageThisTurn === true) return threshold <= 1;
      return false;
    }
  }
  {
    const attackGroupMatch = normalizedRaw.match(
      /^([a-z0-9]+) or more of those creatures are attacking you and\/or planeswalkers you control$/i
    );
    if (attackGroupMatch) {
      const threshold = parseSmallNumberWord(String(attackGroupMatch[1] || '').trim());
      if (threshold === null) return null;

      const thoseIds = (ctx as any)?.thoseCreatureIds ?? ctx.selectorContext?.thoseCreatureIds;
      if (!Array.isArray(thoseIds) || thoseIds.length === 0) return null;

      const battlefield = getProcessedBattlefield(nextState) as any[];
      const planeswalkerIds = new Set(
        battlefield
          .filter(
            (perm: any) =>
              String(perm?.controller || '').trim() === String(controllerId).trim() &&
              objectHasType(perm, 'planeswalker')
          )
          .map((perm: any) => String(perm?.id || '').trim())
          .filter(Boolean)
      );

      let knownMatches = 0;
      let unknown = 0;
      for (const creatureId of thoseIds) {
        const attacker = battlefield.find(
          (perm: any) => String(perm?.id || '').trim() === String(creatureId).trim()
        );
        if (!attacker) {
          unknown += 1;
          continue;
        }
        const attacking =
          (attacker as any).attacking ?? (attacker as any).attackTarget ?? (attacker as any).defending;
        if (attacking == null) {
          unknown += 1;
          continue;
        }
        const targetId = String(attacking).trim();
        if (targetId === String(controllerId).trim() || planeswalkerIds.has(targetId)) {
          knownMatches += 1;
        }
      }

      if (knownMatches >= threshold) return true;
      if (unknown > 0 && knownMatches + unknown >= threshold) return null;
      return false;
    }
  }
  if (
    normalizedRaw ===
      "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness" ||
    normalizedRaw ===
      "its power is greater than this creature's power or its toughness is greater than this creature's toughness"
  ) {
    const battlefield = getProcessedBattlefield(nextState) as any[];
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const source = battlefield.find((perm) => String(perm?.id || '').trim() === sourceId);
    const useItsAntecedent = normalizedRaw.startsWith('its ');
    const refId = useItsAntecedent
      ? String(
          ctx.targetPermanentId ||
            ctx.targetCreatureId ||
            ctx.selectorContext?.targetPermanentId ||
            ctx.selectorContext?.targetCreatureId ||
            (Array.isArray((ctx as any)?.thoseCreatureIds) ? (ctx as any).thoseCreatureIds[0] : '') ||
            ''
        ).trim()
      : String(ctx.targetCreatureId || ctx.selectorContext?.targetCreatureId || 'bf-creature-1').trim();
    const ref = refId ? battlefield.find((perm) => String(perm?.id || '').trim() === refId) : null;
    if (!source || !ref) return useItsAntecedent ? null : true;
    const sourcePower = getCreaturePower(source);
    const sourceToughness = getCreatureToughness(source);
    return getCreaturePower(ref) > sourcePower || getCreatureToughness(ref) > sourceToughness;
  }
  if (normalizedRaw === 'at least four mana was spent to cast it' || normalizedRaw === 'at least 4 mana was spent to cast it') {
    const source = getReferencedObject(nextState, ctx);
    const spent = source ? getAmountOfManaSpent(source) : null;
    return spent === null ? true : spent >= 4;
  }
  if (
    normalizedRaw === 'no colored mana was spent to cast it' ||
    normalizedRaw === 'no colored mana was spent to cast this spell'
  ) {
    return noColoredManaWasSpentToCast(nextState, ctx);
  }
  if (normalizedRaw === 'the amount of mana spent to cast it was less than its mana value') {
    const castSource = getCastManaSpendSource(nextState, ctx);
    if (!castSource) return null;
    const spent = getAmountOfManaSpent(castSource);
    const manaValue = Number(
      castSource?.manaValue ??
        castSource?.card?.manaValue ??
        castSource?.card?.cmc ??
        castSource?.cmc
    );
    if (spent === null || !Number.isFinite(manaValue)) return null;
    return spent < manaValue;
  }
  {
    const manaSpentCastItMatch = normalizedRaw.match(/^((?:\{[wubrgcs]\})+) was spent to cast it$/i);
    if (manaSpentCastItMatch) {
      const groups = Array.from(String(manaSpentCastItMatch[1]).matchAll(/\{([wubrgcs])\}/gi)).map((match) =>
        String(match[1] || '').toLowerCase()
      );
      if (!groups.length || !groups.every((color) => color === groups[0])) return null;
      const castSource = getCastManaSpendSource(nextState, ctx);
      const spent = getAmountOfSpecificManaSymbolSpent(castSource, groups[0]);
      return spent === null ? false : spent >= groups.length;
    }
  }
  if (normalizedRaw === 'that creature has toxic') {
    const targetId = String(
      ctx.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.selectorContext?.targetPermanentId ||
        ''
    ).trim();
    const target =
      (targetId
        ? (getProcessedBattlefield(nextState) as any[]).find(
            (perm: any) => String(perm?.id || '').trim() === targetId
          )
        : null) ?? getReferencedObject(nextState, ctx);
    if (!target) return null;
    return objectHasKeyword(target, 'toxic');
  }
  if (normalizedRaw === 'it was bargained') {
    return true;
  }
  if (
    normalizedRaw ===
      "this permanent is a creature and the amount of mana spent to cast that spell is greater than this permanent's power or this permanent's toughness" ||
    normalizedRaw ===
      "this permanent is a creature and the amount of mana spent to cast that spell is greater than this creature's power or this creature's toughness"
  ) {
    const source = getReferencedObject(nextState, ctx);
    if (!source) return true;
    const spent = getAmountOfManaSpent(source) ?? 4;
    return spent > getCreaturePower(source) || spent > getCreatureToughness(source);
  }
  if (normalizedRaw === 'two or more nonland permanents entered the battlefield under your control this turn') {
    const count = Number(
      (nextState as any)?.nonlandPermanentsEnteredThisTurn?.[controllerId] ??
        (nextState as any)?.permanentsEnteredThisTurn?.[controllerId] ??
        (nextState as any)?.creaturesEnteredThisTurn?.[controllerId] ??
        0
    );
    return count >= 2;
  }
  const readTreasureSpent = (candidate: any): boolean | null => {
    if (!candidate || typeof candidate !== 'object') return null;
    const known = candidate?.manaFromTreasureSpentKnown ?? candidate?.card?.manaFromTreasureSpentKnown;
    const value = candidate?.manaFromTreasureSpent ?? candidate?.card?.manaFromTreasureSpent;
    if (known === true && typeof value === 'boolean') return value;
    if (value === true) return true;
    return null;
  };
  if (
    normalizedRaw === 'mana from a treasure was spent to cast it' ||
    normalizedRaw === 'mana from a treasure was spent to cast this spell'
  ) {
    const fromState = (nextState as any)?.treasureManaSpentToCastThisTurn?.[controllerId];
    if (typeof fromState === 'boolean') return fromState;
    const castSource = getCastManaSpendSource(nextState, ctx);
    const fromCast = readTreasureSpent(castSource);
    if (typeof fromCast === 'boolean') return fromCast;
    if (typeof (ctx as any)?.manaFromTreasureSpent === 'boolean') return (ctx as any).manaFromTreasureSpent;
    return normalizedRaw.endsWith('cast it') ? true : false;
  }
  if (
    normalizedRaw === 'mana from a treasure was spent to activate this ability' ||
    normalizedRaw === 'mana from a treasure was spent to activate it'
  ) {
    const fromState = (nextState as any)?.treasureManaSpentToActivateThisTurn?.[controllerId];
    if (typeof fromState === 'boolean') return fromState;
    const activateSource = getCastManaSpendSource(nextState, ctx);
    const fromActivate = readTreasureSpent(activateSource);
    if (typeof fromActivate === 'boolean') return fromActivate;
    if (typeof (ctx as any)?.manaFromTreasureSpent === 'boolean') return (ctx as any).manaFromTreasureSpent;
    return null;
  }
  return null;
}
