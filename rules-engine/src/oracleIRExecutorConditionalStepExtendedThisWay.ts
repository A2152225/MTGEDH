// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: evaluateThisWayClause.
// Public entry symbol: evaluateThisWayClause.

import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import { EXILE_THIS_WAY_STEP_KINDS } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  antecedentApplied,
  cardsMatchDescriptor,
  discardedCardsFrom,
  milledCardsFrom,
  movedCardsFrom,
  objectHasType,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import {
  collectRevealedThisWayCardsLedgerFirst,
  isRevealedThisWayLedgerFirst,
} from './oracleIRLedgerCardAccess';

export function evaluateThisWayClause(params: ExtendedConditionalParams): boolean | null {
  const { normalizedRaw, lastActionOutcome, ctx, controllerId, nextState } = params;
  if (!normalizedRaw.includes(' this way')) return null;

  if (lastActionOutcome?.kind === 'impossible') return false;

  if (normalizedRaw === 'you paid life this way') {
    return Boolean(
      (ctx as any).lifePaidThisWay ??
        (ctx as any).paidLifeThisWay ??
        (nextState as any)?.lifePaidThisWay?.[controllerId]
    );
  }

  const moved = movedCardsFrom(params);
  const discarded = discardedCardsFrom(params);
  const milled = milledCardsFrom(ctx);

  if (/^you don't copy a spell this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'copy_spell' ? lastActionOutcome.kind !== 'applied' : false;
  }
  if (/^you don't draw a card this way$/.test(normalizedRaw) || /^you didn't draw cards this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'draw' ? lastActionOutcome.kind !== 'applied' : true;
  }
  if (/^you put no cards into your hand this way$/.test(normalizedRaw)) {
    return moved.length === 0;
  }
  if (/^no counters were removed this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'remove_counter' ? lastActionOutcome.kind !== 'applied' : true;
  }
  if (/^it deals damage to you this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['deal_damage', 'damage']);
  }
  if (/^damage is prevented this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['prevent_damage']);
  }
  if (/^one or more \+1\/\+1 counters are moved this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['move_counters', 'proliferate']);
  }
  if (/^a player is dealt damage this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['deal_damage', 'damage']);
  }
  if (normalizedRaw === 'a creature is dealt damage this way') {
    if ((ctx as any)?.creatureDealtDamageThisWay === true) return true;
    if (!antecedentApplied(lastActionOutcome, ['deal_damage', 'damage'])) return false;
    const damaged = (ctx as any)?.lastDamagedCards ?? movedCardsFrom(params);
    const cards = Array.isArray(damaged) ? damaged : [];
    return cards.some((card) => objectHasType(card, 'creature'));
  }

  if (
    normalizedRaw === 'damage from a creature source is prevented this way' ||
    normalizedRaw === 'damage from a noncreature source is prevented this way'
  ) {
    const wantsCreature = normalizedRaw === 'damage from a creature source is prevented this way';
    if (wantsCreature && (ctx as any)?.creatureDamagePreventedThisWay === true) return true;
    if (!wantsCreature && (ctx as any)?.noncreatureDamagePreventedThisWay === true) return true;
    if (wantsCreature && (ctx as any)?.noncreatureDamagePreventedThisWay === true) return false;
    if (!wantsCreature && (ctx as any)?.creatureDamagePreventedThisWay === true) return false;
    if (!antecedentApplied(lastActionOutcome, ['prevent_damage'])) return false;
    const sourceType = String((ctx as any)?.lastPreventedDamageSourceType ?? '').trim().toLowerCase();
    if (sourceType === 'creature') return wantsCreature;
    if (sourceType === 'noncreature') return !wantsCreature;
    const source = (ctx as any)?.lastPreventedDamageSource ?? (ctx as any)?.preventedDamageSource;
    if (source && typeof source === 'object') {
      if (objectHasType(source, 'creature')) return wantsCreature;
      const typeLine = getExecutorTypeLineLower(source);
      if (typeLine.length > 0 && !objectHasType(source, 'creature')) return !wantsCreature;
    }
    return null;
  }

  const youExiledMatch = normalizedRaw.match(/^you exiled (?:a|an) ([a-z0-9' -]+?) card this way$/);
  if (youExiledMatch) {
    const descriptor = String(youExiledMatch[1] || '').trim();
    if (antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS)) return cardsMatchDescriptor(moved, descriptor);
    return false;
  }
  if (normalizedRaw === 'you exiled a card this way') {
    return antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS) ? moved.length > 0 : false;
  }

  const putOntoBfMatch = normalizedRaw.match(/^you put (?:a|an) ([a-z0-9' -]+?) onto the battlefield this way$/);
  if (putOntoBfMatch) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'create_token']) ? cardsMatchDescriptor(moved, putOntoBfMatch[1]) : false;
  }

  const putIntoHandMatch = normalizedRaw.match(/^you put (?:a|an) ([a-z0-9' -]+?) (?:card )?into your hand this way$/);
  if (putIntoHandMatch) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'draw', 'search_library'])
      ? cardsMatchDescriptor(moved, putIntoHandMatch[1])
      : false;
  }
  if (normalizedRaw === 'you put a card into your hand this way' || normalizedRaw === 'you draw one or more cards this way') {
    return antecedentApplied(lastActionOutcome, ['draw', 'move_zone', 'search_library']);
  }
  if (normalizedRaw === 'you discarded a card this way') {
    return antecedentApplied(lastActionOutcome, ['discard']) ? discarded.length > 0 : false;
  }
  if (/^a creature card (?:is|was) exiled this way$/.test(normalizedRaw)) {
    if (moved.some((card) => objectHasType(card, 'creature'))) return true;
    return antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS)
      ? moved.some((card) => objectHasType(card, 'creature'))
      : false;
  }
  if (/^a noncreature card (?:is|was) exiled this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, EXILE_THIS_WAY_STEP_KINDS)
      ? moved.some((card) => !objectHasType(card, 'creature'))
      : false;
  }
  if (normalizedRaw === "you didn't create a token this way") {
    return lastActionOutcome?.stepKind === 'create_token' ? lastActionOutcome.kind !== 'applied' : true;
  }

  const milledMatch = normalizedRaw.match(/^(?:a|an|at least one) ([a-z0-9' -]+?) (?:card )?(?:is|was|are) milled this way$/);
  if (milledMatch) {
    return cardsMatchDescriptor(milled, milledMatch[1]) || (antecedentApplied(lastActionOutcome, ['mill']) && milled.length > 0);
  }
  if (/two cards that share (?:all their )?card types were milled this way/.test(normalizedRaw)) {
    if (milled.length >= 2) {
      for (let i = 0; i < milled.length; i += 1) {
        for (let j = i + 1; j < milled.length; j += 1) {
          const aTypes = getExecutorTypeLineLower(milled[i]);
          const bTypes = getExecutorTypeLineLower(milled[j]);
          const shared = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'].some(
            (type) => aTypes.includes(type) && bTypes.includes(type)
          );
          if (shared) return true;
        }
      }
    }
    return antecedentApplied(lastActionOutcome, ['mill']) && milled.length >= 2;
  }

  const discardedMatch = normalizedRaw.match(/^(?:a|an|two cards that share a card type are) ([a-z0-9' -]*?)cards? (?:was|were) discarded this way$/);
  if (discardedMatch || /discarded this way/.test(normalizedRaw)) {
    if (/two cards that share a card type are discarded this way/.test(normalizedRaw)) {
      return antecedentApplied(lastActionOutcome, ['discard']) && discarded.length >= 2;
    }
    const descriptorMatch = normalizedRaw.match(/^(?:a|an) ([a-z0-9' -]+?) card was discarded this way$/);
    if (descriptorMatch) {
      const descriptor = String(descriptorMatch[1] || '').trim();
      if (discarded.some(card => cardsMatchDescriptor([card], descriptor))) return true;
      return antecedentApplied(lastActionOutcome, ['discard'])
        ? cardsMatchDescriptor(discarded, descriptor)
        : false;
    }
    return antecedentApplied(lastActionOutcome, ['discard']) ? discarded.length > 0 : discarded.length > 0;
  }

  if (normalizedRaw === 'you reveal a creature card this way') {
    if (!antecedentApplied(lastActionOutcome, ['reveal_top'])) return false;
    const revealed = movedCardsFrom(params);
    return cardsMatchDescriptor(revealed, 'creature');
  }

  const revealedMatch = normalizedRaw.match(/^(?:a|an|all cards|you reveal a?) ([a-z0-9' -]*?)(?:cards? )?(?:is|are) revealed this way$/);
  if (revealedMatch || /revealed this way/.test(normalizedRaw)) {
    if (/all cards revealed this way are creature cards/.test(normalizedRaw)) {
      const revealedCards = collectRevealedThisWayCardsLedgerFirst(params.ctx, params.step);
      if (revealedCards.length > 0) {
        return revealedCards.every((card) => cardsMatchDescriptor(card, 'creature'));
      }
      return antecedentApplied(lastActionOutcome, ['look_choose_from_top', 'reveal', 'search_library']);
    }
    if (isRevealedThisWayLedgerFirst(params.ctx, params.step)) return true;
    return antecedentApplied(lastActionOutcome, ['look_choose_from_top', 'reveal', 'search_library', 'scry']);
  }

  const destroyedMatch = normalizedRaw.match(/^(?:a|an) ([a-z0-9' -]*?) (?:is|was) destroyed this way$/);
  if (destroyedMatch) {
    return antecedentApplied(lastActionOutcome, ['destroy']) && cardsMatchDescriptor(moved, destroyedMatch[1] || 'creature');
  }
  if (normalizedRaw === 'a creature you controlled was destroyed this way') {
    return antecedentApplied(lastActionOutcome, ['destroy']);
  }

  const gyPutMatch = normalizedRaw.match(/^that ([a-z0-9' -]+?) is put into a graveyard this way$/);
  if (gyPutMatch) {
    return antecedentApplied(lastActionOutcome, ['destroy', 'move_zone', 'sacrifice']);
  }

  if (/^a creature card is put into a graveyard this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['destroy', 'move_zone', 'sacrifice'])
      ? moved.some((card) => objectHasType(card, 'creature'))
      : false;
  }

  if (/^an instant card or a card with flash is exiled this way$/.test(normalizedRaw)) {
    if (!antecedentApplied(lastActionOutcome, ['exile', 'exile_top', 'impulse_exile_top'])) return false;
    return moved.some((card) => {
      const tl = getExecutorTypeLineLower(card);
      return tl.includes('instant') || /\bflash\b/i.test(String((card as any)?.oracle_text ?? '')) || (card as any)?.hasFlash === true;
    });
  }

  if (/^you discarded an instant or sorcery card this way$/.test(normalizedRaw)) {
    if (!antecedentApplied(lastActionOutcome, ['discard'])) return false;
    const cards = discarded.length > 0 ? discarded : moved;
    return cards.some((card) => {
      const tl = getExecutorTypeLineLower(card);
      return tl.includes('instant') || tl.includes('sorcery');
    });
  }

  if (/^you paid one or more \{e\} this way$/i.test(normalizedRaw)) {
    if ((ctx as any).energyPaidThisWay === true || (ctx as any)?.paidEnergyThisWay === true) return true;
    const paid = Number((ctx as any)?.energyPaidAmountThisWay ?? (ctx as any)?.energyPaidThisWayCount ?? NaN);
    return Number.isFinite(paid) ? paid >= 1 : antecedentApplied(lastActionOutcome, ['pay_energy', 'activate']);
  }

  if (/^you return a nonland card to your hand this way$/.test(normalizedRaw)) {
    if (!antecedentApplied(lastActionOutcome, ['move_zone', 'return_to_hand'])) return false;
    return moved.some((card) => !objectHasType(card, 'land') && !getExecutorTypeLineLower(card).includes('land'));
  }

  if (/^excess damage was dealt to that creature this way$/.test(normalizedRaw)) {
    const excess = Number((ctx as any)?.lastExcessDamageDealtThisWay ?? (ctx as any)?.excessDamageDealtThisWay ?? NaN);
    return Number.isFinite(excess) ? excess > 0 : antecedentApplied(lastActionOutcome, ['deal_damage']);
  }

  if (/another desert was returned this way/.test(normalizedRaw) || /a permanent was returned this way/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'return_to_hand']);
  }

  if (/^you (?:didn't|did not) put a card onto the battlefield this way$/.test(normalizedRaw)) {
    return !antecedentApplied(lastActionOutcome, ['move_zone']) || moved.length === 0;
  }

  if (/^you lost life this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['lose_life', 'pay_life']);
  }

  if (normalizedRaw === 'you cast a spell this way') {
    if (ctx.spellCastThisWay === true || ctx.selectorContext?.spellCastThisWay === true) return true;
    if (ctx.spellCastThisWay === false || ctx.selectorContext?.spellCastThisWay === false) return false;
    return antecedentApplied(lastActionOutcome, ['cast_spell', 'copy_spell']);
  }

  if (normalizedRaw === 'you cast a creature spell this way') {
    if (ctx.creatureSpellCastThisWay === true || ctx.selectorContext?.creatureSpellCastThisWay === true) {
      return true;
    }
    if (ctx.creatureSpellCastThisWay === false || ctx.selectorContext?.creatureSpellCastThisWay === false) {
      return false;
    }
    return antecedentApplied(lastActionOutcome, ['cast_spell', 'copy_spell']);
  }

  if (normalizedRaw === 'that creature dies this way') {
    if (ctx.creatureDiedThisWay === true || ctx.selectorContext?.creatureDiedThisWay === true) return true;
    if (ctx.creatureDiedThisWay === false || ctx.selectorContext?.creatureDiedThisWay === false) return false;
    return antecedentApplied(lastActionOutcome, ['destroy']);
  }

  return null;
}
