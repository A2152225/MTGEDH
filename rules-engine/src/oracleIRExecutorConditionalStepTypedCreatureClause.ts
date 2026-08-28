/**
 * Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
 * Cluster: generic creature-type N conditionals (dealt damage / sacrificed / exiled /
 *   attacking / equipped / control / mana spent on typed spells).
 * Public: tryEvaluateTypedCreatureClause
 */

import { normalizeCreatureTypeWord } from '../../shared/src/creatureTypes';
import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import { EXILE_THIS_WAY_STEP_KINDS } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  antecedentApplied,
  countControlledMatchingDescriptor,
  discardedCardsFrom,
  getConditionalSubjectCard,
  getEnchantedCreatureFromAura,
  getGraveyardCards,
  getReferencedObject,
  getSourceCounterCount,
  isPermanentAttacking,
  movedCardsFrom,
  objectHasType,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

const RESERVED_TYPED_NOUNS = new Set([
  'player',
  'opponent',
  'you',
  'they',
  'it',
  'this',
  'that',
  'one',
  'more',
  'other',
  'another',
  'each',
]);

function parseTypedNoun(raw: string): string | null {
  const word = String(raw || '').trim().toLowerCase();
  if (!word || RESERVED_TYPED_NOUNS.has(word)) return null;
  const creature = normalizeCreatureTypeWord(word);
  if (creature) return creature;
  if (word === 'vehicle' || word === 'vehicles') return 'vehicle';
  if (word === 'creature' || word === 'creatures') return 'creature';
  return null;
}

function sacrificedSnapshots(params: ExtendedConditionalParams): any[] {
  const fromCtx = (params.ctx as any)?.lastSacrificedPermanents;
  if (Array.isArray(fromCtx) && fromCtx.length > 0) return fromCtx;
  return movedCardsFrom(params);
}

function damagedSnapshots(params: ExtendedConditionalParams): any[] {
  const fromCtx = (params.ctx as any)?.lastDamagedCards;
  if (Array.isArray(fromCtx)) return fromCtx;
  return movedCardsFrom(params);
}

function someHaveType(cards: readonly any[], typeName: string): boolean {
  return cards.some((card) => objectHasType(card, typeName));
}

function battlefieldHasAttackingType(params: ExtendedConditionalParams, typeName: string): boolean {
  return (getProcessedBattlefield(params.nextState) as any[]).some(
    (perm: any) => isPermanentAttacking(perm) && objectHasType(perm, typeName),
  );
}

export function tryEvaluateTypedCreatureClause(params: ExtendedConditionalParams): boolean | null {
  const { normalizedRaw, nextState, controllerId, ctx } = params;

  {
    const dealt = normalizedRaw.match(/^an? ([a-z][a-z'-]*) (?:creature |card )?(?:is|was) dealt damage this way$/);
    const typeName = dealt ? parseTypedNoun(String(dealt[1] || '')) : null;
    if (typeName && typeName !== 'creature') {
      const cards = damagedSnapshots(params);
      if (cards.length > 0) return someHaveType(cards, typeName);
      const flag = (ctx as any)?.[`${typeName}DealtDamageThisWay`];
      if (typeof flag === 'boolean') return flag;
      return antecedentApplied(params.lastActionOutcome, ['deal_damage', 'damage'])
        ? someHaveType(cards, typeName)
        : false;
    }
  }

  {
    const sacrificed = normalizedRaw.match(
      /^(?:an? ([a-z][a-z'-]*) (?:is|was) sacrificed this way|you sacrificed an? ([a-z][a-z'-]*) this way)$/,
    );
    const typeName = sacrificed ? parseTypedNoun(String(sacrificed[1] || sacrificed[2] || '')) : null;
    if (typeName && typeName !== 'permanent') {
      return someHaveType(sacrificedSnapshots(params), typeName);
    }
  }

  {
    const exiled = normalizedRaw.match(/^an? ([a-z][a-z'-]*) (?:card )?(?:was|is) exiled this way$/);
    const typeName = exiled ? parseTypedNoun(String(exiled[1] || '')) : null;
    if (typeName && typeName !== 'creature') {
      const moved = movedCardsFrom(params);
      if (moved.length > 0) return someHaveType(moved, typeName);
      return antecedentApplied(params.lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS);
    }
  }

  {
    const attacking = normalizedRaw.match(/^an? ([a-z][a-z'-]*) is attacking$/);
    const typeName = attacking ? parseTypedNoun(String(attacking[1] || '')) : null;
    if (typeName) return battlefieldHasAttackingType(params, typeName);
  }

  {
    const equipped = normalizedRaw.match(/^equipped creature is an? ([a-z][a-z'-]*)$/);
    const typeName = equipped ? parseTypedNoun(String(equipped[1] || '')) : null;
    if (typeName) {
      const source = getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
      );
      const attachedTo = String((source as any)?.attachedTo || '').trim();
      if (!attachedTo) return false;
      const host = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
      return host ? objectHasType(host, typeName) : false;
    }
  }

  {
    const dontControl = normalizedRaw.match(/^you don'?t control an? ([a-z][a-z'-]*)$/);
    const typeName = dontControl ? parseTypedNoun(String(dontControl[1] || '')) : null;
    if (typeName) return countControlledMatchingDescriptor(nextState, controllerId, typeName) === 0;
  }

  {
    const thisIs = normalizedRaw.match(/^(?:if )?this (?:creature|permanent) is an? ([a-z][a-z'-]*)$/);
    const typeName = thisIs ? parseTypedNoun(String(thisIs[1] || '')) : null;
    if (typeName) {
      const source =
        getConditionalSubjectCard(params) ??
        getContextSourceObject(ctx, (idRaw: string) =>
          findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw),
        );
      if (!source) return null;
      return objectHasType(source, typeName);
    }
  }

  {
    const manaNonType = normalizedRaw.match(/^that mana is spent to cast a non-([a-z][a-z'-]*) creature spell$/);
    const nonTypeName = manaNonType ? parseTypedNoun(String(manaNonType[1] || '')) : null;
    if (nonTypeName) {
      const flag =
        (ctx as any)?.manaSpentOnNonHumanCreatureSpell ??
        (ctx.selectorContext as any)?.manaSpentOnNonHumanCreatureSpell;
      if (typeof flag === 'boolean' && nonTypeName === 'human') return flag;
      const spell = (ctx as any)?.stackItem ?? getReferencedObject(nextState, ctx);
      const tl = getExecutorTypeLineLower(spell);
      return tl.includes('creature') && !tl.includes(nonTypeName);
    }
  }

  {
    const manaOnType = normalizedRaw.match(/^that mana is spent (?:on|to cast) an? (?!non-)([a-z][a-z'-]*) creature spell$/);
    const typeName = manaOnType ? parseTypedNoun(String(manaOnType[1] || '')) : null;
    if (typeName) {
      const flag =
        (ctx as any)?.[`manaSpentOn${typeName[0].toUpperCase()}${typeName.slice(1)}CreatureSpell`] ??
        (ctx.selectorContext as any)?.[`manaSpentOn${typeName[0].toUpperCase()}${typeName.slice(1)}CreatureSpell`];
      if (typeof flag === 'boolean') return flag;
      const spell = (ctx as any)?.stackItem ?? getReferencedObject(nextState, ctx);
      const tl = getExecutorTypeLineLower(spell);
      return tl.includes('creature') && tl.includes(typeName);
    }
  }

  {
    const discarded = normalizedRaw.match(/^the discarded card was an? ([a-z][a-z'-]*) card$/);
    const typeName = discarded ? parseTypedNoun(String(discarded[1] || '')) : null;
    if (typeName) {
      const cards = discardedCardsFrom(params);
      const card = cards[cards.length - 1];
      if (!card) return null;
      return objectHasType(card, typeName);
    }
  }

  {
    const pair = normalizedRaw.match(/^an? ([a-z][a-z'-]*) and an? ([a-z][a-z'-]*) attacked this combat$/);
    if (pair) {
      const first = parseTypedNoun(String(pair[1] || ''));
      const second = parseTypedNoun(String(pair[2] || ''));
      if (first && second) {
        const map = (nextState as any)?.attackersDeclaredThisCombatBySubtype;
        if (map && typeof map === 'object') {
          return Boolean((map as any)[first] && (map as any)[second]);
        }
        let sawFirst = false;
        let sawSecond = false;
        for (const perm of getProcessedBattlefield(nextState) as any[]) {
          if (!isPermanentAttacking(perm)) continue;
          if (objectHasType(perm, first)) sawFirst = true;
          if (objectHasType(perm, second)) sawSecond = true;
        }
        return sawFirst && sawSecond;
      }
    }
  }

  {
    const controlledAsCast = normalizedRaw.match(/^you controlled an? ([a-z][a-z'-]*) as you cast this spell$/);
    const typeName = controlledAsCast ? parseTypedNoun(String(controlledAsCast[1] || '')) : null;
    if (typeName) {
      const flag =
        (ctx as any)?.[`controlled${typeName[0].toUpperCase()}${typeName.slice(1)}AsCast`] ??
        (ctx.selectorContext as any)?.[`controlled${typeName[0].toUpperCase()}${typeName.slice(1)}AsCast`];
      if (typeof flag === 'boolean') return flag;
      return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
        if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
        return objectHasType(perm, typeName);
      });
    }
  }

  {
    const revealedOrControlled = normalizedRaw.match(
      /^you revealed an? ([a-z][a-z'-]*) card or controlled an? \1 as you cast this spell$/,
    );
    const typeName = revealedOrControlled ? parseTypedNoun(String(revealedOrControlled[1] || '')) : null;
    if (typeName) {
      const cap = `${typeName[0].toUpperCase()}${typeName.slice(1)}`;
      const revealed =
        (ctx as any)?.[`revealed${cap}AsCast`] === true
        || (ctx.selectorContext as any)?.[`revealed${cap}AsCast`] === true;
      const controlled =
        (ctx as any)?.[`controlled${cap}AsCast`] === true
        || (ctx.selectorContext as any)?.[`controlled${cap}AsCast`] === true;
      if (revealed || controlled) return true;
      if (countControlledMatchingDescriptor(nextState, controllerId, typeName) > 0) return true;
      const revealedCards = Array.isArray((ctx as any)?.lastRevealedCards) ? (ctx as any).lastRevealedCards : [];
      if (someHaveType(revealedCards, typeName)) return true;
      return false;
    }
  }

  {
    const combatByType = normalizedRaw.match(/^a player was dealt combat damage by an? ([a-z][a-z'-]*) this turn$/);
    const typeName = combatByType ? parseTypedNoun(String(combatByType[1] || '')) : null;
    if (typeName) {
      const cap = `${typeName[0].toUpperCase()}${typeName.slice(1)}`;
      const map =
        (nextState as any)?.[`combatDamageBy${cap}ThisTurn`]
        ?? (typeName === 'zombie' ? (nextState as any)?.combatDamageByZombieThisTurn : undefined);
      if (typeof map === 'boolean' && typeName === 'zombie') return map;
      if (map && typeof map === 'object') {
        return Object.values(map as Record<string, unknown>).some((value) => value === true);
      }
      return (getProcessedBattlefield(nextState) as any[]).some((perm: any) => {
        if (!objectHasType(perm, typeName)) return false;
        const dealt = Number((perm as any)?.combatDamageDealtThisTurn ?? (perm as any)?.combatDamageToPlayerThisTurn ?? 0);
        return Number.isFinite(dealt) && dealt > 0;
      });
    }
  }

  {
    const entered = normalizedRaw.match(/^another ([a-z][a-z'-]*) entered the battlefield under your control this turn$/);
    const typeName = entered ? parseTypedNoun(String(entered[1] || '')) : null;
    if (typeName && typeName !== 'creature') {
      const sourceId = String(ctx.sourceId || '').trim();
      const pluralKey =
        typeName === 'elf'
          ? 'elvesEnteredBattlefieldUnderControlThisTurn'
          : typeName === 'wolf'
            ? 'wolvesEnteredBattlefieldUnderControlThisTurn'
            : `${typeName}sEnteredBattlefieldUnderControlThisTurn`;
      const typedMaps = [(nextState as any)?.[pluralKey]];
      for (const map of typedMaps) {
        if (map && typeof map === 'object' && !Array.isArray(map)) {
          const value = (map as Record<string, unknown>)[String(controllerId || '').trim()];
          if (typeof value === 'boolean') return value;
          if (typeof value === 'number') return value > 0;
        } else if (typeof map === 'boolean') return map;
        else if (typeof map === 'number') return map > 0;
      }
      const hits = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
        if (sourceId && String(perm?.id || '').trim() === sourceId) return false;
        if (!(perm?.enteredThisTurn === true || perm?.enteredBattlefieldThisTurn === true)) return false;
        return objectHasType(perm, typeName);
      });
      if (hits.length > 0) return true;
      const tracking = (getProcessedBattlefield(nextState) as any[]).some(
        (perm: any) => perm?.enteredThisTurn === true || perm?.enteredThisTurn === false,
      );
      return tracking ? false : null;
    }
  }

  {
    const died = normalizedRaw.match(/^another ([a-z][a-z'-]*) died under your control this turn$/);
    const typeName = died ? parseTypedNoun(String(died[1] || '')) : null;
    if (typeName && typeName !== 'creature') {
      const map = (nextState as any)?.creaturesDiedThisTurnByControllerSubtype;
      if (map && typeof map === 'object') {
        const entry = (map as Record<string, unknown>)[String(controllerId || '').trim()];
        if (entry && typeof entry === 'object') {
          const count = Number((entry as Record<string, unknown>)[typeName] ?? 0);
          return Number.isFinite(count) && count >= 1;
        }
      }
      return null;
    }
  }

  {
    const notType = normalizedRaw.match(/^(?:it'?s not|it is not|he wasn'?t|he was not) an? ([a-z][a-z'-]*)$/);
    const typeName = notType ? parseTypedNoun(String(notType[1] || '')) : null;
    if (typeName) {
      const ref = getReferencedObject(nextState, ctx) ?? getConditionalSubjectCard(params);
      if (!ref) return null;
      return !objectHasType(ref, typeName);
    }
  }

  {
    const orTypes = normalizedRaw.match(/^it'?s an? ([a-z][a-z'-]*) or ([a-z][a-z'-]*)$/);
    if (orTypes) {
      const first = parseTypedNoun(String(orTypes[1] || ''));
      const second = parseTypedNoun(String(orTypes[2] || ''));
      if (first && second) {
        const ref = getReferencedObject(nextState, ctx) ?? getConditionalSubjectCard(params);
        if (!ref) return false;
        return objectHasType(ref, first) || objectHasType(ref, second);
      }
    }
  }

  {
    const enchantedOr = normalizedRaw.match(/^enchanted creature is an? ([a-z][a-z'-]*) or ([a-z][a-z'-]*)$/);
    if (enchantedOr) {
      const first = parseTypedNoun(String(enchantedOr[1] || ''));
      const second = parseTypedNoun(String(enchantedOr[2] || ''));
      if (first && second) {
        const enchanted = getEnchantedCreatureFromAura(nextState, ctx);
        if (!enchanted) return null;
        return objectHasType(enchanted, first) || objectHasType(enchanted, second);
      }
    }
  }

  {
    const gyAndCounter = normalizedRaw.match(
      /^there is an? ([a-z][a-z'-]*) card in your graveyard and this creature has a -1\/-1 counter on it$/,
    );
    const typeName = gyAndCounter ? parseTypedNoun(String(gyAndCounter[1] || '')) : null;
    if (typeName) {
      const hasType = getGraveyardCards(nextState, controllerId).some((card) => objectHasType(card, typeName));
      if (!hasType) return false;
      return getSourceCounterCount(nextState, ctx, '-1/-1') >= 1;
    }
  }

  {
    const oppNoType = normalizedRaw.match(/^each opponent who doesn'?t control an? ([a-z][a-z'-]*)$/);
    const typeName = oppNoType ? parseTypedNoun(String(oppNoType[1] || '')) : null;
    if (typeName) {
      return (nextState.players || []).some((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (!playerId || playerId === controllerId) return false;
        return countControlledMatchingDescriptor(nextState, playerId as typeof controllerId, typeName) === 0;
      });
    }
  }

  {
    const damageBy = normalizedRaw.match(/^any of that damage was dealt by an? ([a-z][a-z'-]*)$/);
    const typeName = damageBy ? parseTypedNoun(String(damageBy[1] || '')) : null;
    if (typeName) {
      const cap = `${typeName[0].toUpperCase()}${typeName.slice(1)}`;
      const flag =
        (ctx as any)?.[`damageIncluded${cap}Source`]
        ?? (typeName === 'warrior' ? (ctx as any)?.damageIncludedWarriorSource : undefined);
      if (typeof flag === 'boolean') return flag;
      const damageSources = (ctx as any)?.damageSourcePermanents;
      if (Array.isArray(damageSources) && damageSources.length > 0) {
        return someHaveType(damageSources, typeName);
      }
      const ids: string[] =
        (Array.isArray((ctx as any)?.damageSourceCreatureIds) ? (ctx as any).damageSourceCreatureIds : null)
        ?? (Array.isArray((ctx as any)?.damageSourcePermanentIds) ? (ctx as any).damageSourcePermanentIds : null)
        ?? (Array.isArray((ctx as any)?.damageSourceIds) ? (ctx as any).damageSourceIds : null)
        ?? [];
      if (ids.length === 0) return null;
      const battlefield = getProcessedBattlefield(nextState) as any[];
      let sawAll = true;
      for (const id of ids) {
        const perm = findObjectByIdInState(nextState, battlefield, String(id));
        if (!perm) {
          sawAll = false;
          continue;
        }
        if (objectHasType(perm, typeName)) return true;
      }
      return sawAll ? false : null;
    }
  }

  {
    const revealedIf = normalizedRaw.match(/^if you revealed an? ([a-z][a-z'-]*)/);
    const controlledIf = normalizedRaw.match(/^if you controlled an? ([a-z][a-z'-]*)/);
    if ((revealedIf && parseTypedNoun(String(revealedIf[1] || '')))
      || (controlledIf && parseTypedNoun(String(controlledIf[1] || '')))) {
      return true;
    }
  }

  return null;
}
