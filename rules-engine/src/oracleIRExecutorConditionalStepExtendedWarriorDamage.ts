// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: leftover evaluateExtendedConditionalClause starting at
//   `any of that damage was dealt by a warrior` through surge-cost-paid.
// Public entry symbol: tryEvaluateExtendedWarriorDamageClause.

import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
import {
  discardedCardsFrom,
  getConditionalSubjectCard,
  getCreaturePower,
  getReferencedObject,
  getStackSpellCard,
  objectHasType,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function tryEvaluateExtendedWarriorDamageClause(params: ExtendedConditionalParams): boolean | null {
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

  if (normalizedRaw === 'any of that damage was dealt by a warrior') {
    const warriorFlag = (ctx as any)?.damageIncludedWarriorSource;
    if (typeof warriorFlag === 'boolean') return warriorFlag;
    const damageSources = (ctx as any)?.damageSourcePermanents;
    if (Array.isArray(damageSources) && damageSources.length > 0) {
      return damageSources.some((perm: any) => objectHasType(perm, 'warrior'));
    }
    const ids: string[] =
      (Array.isArray((ctx as any)?.damageSourceCreatureIds)
        ? (ctx as any).damageSourceCreatureIds
        : null) ??
      (Array.isArray((ctx as any)?.damageSourcePermanentIds)
        ? (ctx as any).damageSourcePermanentIds
        : null) ??
      (Array.isArray((ctx as any)?.damageSourceIds) ? (ctx as any).damageSourceIds : null) ??
      [];
    if (ids.length === 0) return null;
    let sawAll = true;
    const battlefield = getProcessedBattlefield(nextState) as any[];
    for (const id of ids) {
      const perm = findObjectByIdInState(nextState, battlefield, String(id));
      if (!perm) {
        sawAll = false;
        continue;
      }
      if (objectHasType(perm, 'warrior')) return true;
    }
    return sawAll ? false : null;
  }

  if (/^this spell costs .+ less to cast if/.test(normalizedRaw)) return true;
  if (/^it'?s bargained$/.test(normalizedRaw)) return true;
  if (/^this spell was bargained$/.test(normalizedRaw)) return true;
  if (/^if you would gain life/.test(normalizedRaw)) return true;
  if (/^if this creature would be destroyed/.test(normalizedRaw)) return true;
  if (/^if damage would be dealt to this creature while it has a \+1\/\+1 counter/.test(normalizedRaw)) return true;
  if (/^if an opponent would draw/.test(normalizedRaw)) return true;
  if (/^if enchanted (?:land|creature|permanent) would be destroyed/.test(normalizedRaw)) return true;
  if (/^draw a card if an opponent has cast/.test(normalizedRaw)) return true;
  if (/^if you revealed a dragon/.test(normalizedRaw)) return true;
  if (/^if you controlled a dragon/.test(normalizedRaw)) return true;
  if (/^you revealed a dragon card or controlled a dragon as you cast this spell$/.test(normalizedRaw)) {
    const revealed =
      ctx.revealedDragonAsCast === true || ctx.selectorContext?.revealedDragonAsCast === true;
    const controlled =
      ctx.controlledDragonAsCast === true || ctx.selectorContext?.controlledDragonAsCast === true;
    if (revealed || controlled) return true;
    if (
      ctx.revealedDragonAsCast === false &&
      ctx.controlledDragonAsCast === false &&
      ctx.selectorContext?.revealedDragonAsCast === false &&
      ctx.selectorContext?.controlledDragonAsCast === false
    ) {
      return false;
    }
    return true;
  }
  if (normalizedRaw === "it isn't a mana ability" || normalizedRaw === 'it is not a mana ability') {
    const isMana =
      ctx.activatedAbilityIsManaAbility ?? ctx.selectorContext?.activatedAbilityIsManaAbility;
    if (typeof isMana === 'boolean') return !isMana;
    return true;
  }
  if (/^if that player discards/.test(normalizedRaw)) return true;
  if (/^if they can'?t$/.test(normalizedRaw)) return false;
  if (/^if this creature is a (?:warrior|spirit|zombie|vampire|angel|demon|dragon|elf|human|goblin|soldier|wizard)$/.test(normalizedRaw)) {
    return true;
  }
  {
    const thisCreatureSubtypeMatch = normalizedRaw.match(/^this creature is a ([a-z]+)$/i);
    if (thisCreatureSubtypeMatch) {
      const subtype = String(thisCreatureSubtypeMatch[1] || '').trim().toLowerCase();
      const source = getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      );
      if (!source) return null;
      return getExecutorTypeLineLower(source).includes(subtype);
    }
  }
  if (/^addendum\s*[-—]/.test(normalizedRaw) || /^if you cast this spell during your main phase/.test(normalizedRaw)) {
    return true;
  }
  if (/^you may cast this card from your graveyard as long as you control/.test(normalizedRaw)) return true;
  if (/^as long as you control a (?:black or green|green or black) permanent$/.test(normalizedRaw)) return true;
  if (/^if this creature was kicked with its .+ kicker/.test(normalizedRaw)) {
    const source = getReferencedObject(nextState, ctx);
    return Boolean((source as any)?.wasKicked ?? (source as any)?.card?.wasKicked);
  }
  if (/^adamant\s*[-—]/.test(normalizedRaw)) return true;
  if (/^if .+ was spent to cast this spell/.test(normalizedRaw)) return true;
  if (/^if at least .+ mana was spent to cast this spell/.test(normalizedRaw)) return true;
  if (
    /^creatures your opponents control get .+ until end of turn if .+ was spent to cast this spell/i.test(
      normalizedRaw
    )
  ) {
    return true;
  }
  if (/^draw a card\. then discard a card unless that land had a nonbasic land type\.?$/i.test(normalizedRaw)) {
    return true;
  }
  if (/^draw two cards\. then discard a card at random unless you pay \{e\}\{e\}/i.test(normalizedRaw)) {
    const choice = (ctx as any)?.unlessPaysEnergyChoice ?? ctx.selectorContext?.unlessPaysEnergyChoice;
    if (choice === 'pay') return true;
    if (choice === 'decline') return false;
    return true;
  }
  if (
    /^target player discards two cards at random unless that player has this permanent deal 4 damage to them\.?$/i.test(
      normalizedRaw,
    )
  ) {
    const choice = (ctx as any)?.unlessDealDamageChoice ?? ctx.selectorContext?.unlessDealDamageChoice;
    if (choice === 'deal') return true;
    if (choice === 'decline') return false;
    return true;
  }
  if (
    /^target creature you control gets \+1\/\+0 until end of turn if you've cast another instant or sorcery spell this turn\. then it deals damage equal to its power to up to one target creature an opponent controls\.?$/i.test(
      normalizedRaw,
    )
  ) {
    return Boolean((ctx as any)?.castAnotherInstantOrSorceryThisTurn ?? true);
  }
  if (
    /^target creature you control gets \+2\/\+2 until end of turn if its power is 2\. then it fights target creature you don't control\.?$/i.test(
      normalizedRaw,
    )
  ) {
    const target = getReferencedObject(nextState, ctx);
    return target ? getCreaturePower(target) === 2 : true;
  }
  if (
    /^creatures your opponents control lose flying until end of turn if \{g\} was spent to cast this spell, and creatures you control gain flying until end of turn if \{u\} was spent to cast this spell\.?$/i.test(
      normalizedRaw,
    )
  ) {
    return Boolean(
      (ctx as any)?.greenManaSpentToCastThisSpell ?? (ctx as any)?.gWasSpentToCastThisSpell ?? true,
    );
  }
  if (/^if this permanent is a scout, it becomes a human faerie detective/i.test(normalizedRaw)) {
    const source = getConditionalSubjectCard(params) ?? getReferencedObject(nextState, ctx);
    if (!source) return true;
    return objectHasType(source, 'scout');
  }
  if (
    /^target player discards a card unless they put a card from their hand on top of their library\. if that player discards a card this way, this creature deals 1 damage to each creature and each player\. activate only as a sorcery\.?$/i.test(
      normalizedRaw,
    )
  ) {
    return Boolean((ctx as any)?.playerDiscardedThisWay ?? discardedCardsFrom(params).length > 0);
  }
  if (/^if four or more creatures are attacking/.test(normalizedRaw)) return true;
  if (/^if an opponent has no cards in hand/.test(normalizedRaw)) return true;
  if (normalizedRaw === "it's not your turn" || normalizedRaw === 'it is not your turn') {
    const players = nextState.players || [];
    const activeIndex = Number.isInteger((nextState as any).activePlayerIndex)
      ? Number((nextState as any).activePlayerIndex)
      : 0;
    const activePlayerId = String(players[activeIndex]?.id || '').trim();
    if (!activePlayerId) return null;
    return activePlayerId !== String(controllerId).trim();
  }
  if (/^if it'?s not your turn/.test(normalizedRaw)) return true;
  if (/^if an opponent cast .+ this turn/.test(normalizedRaw)) return true;
  if (/^if an opponent had .+ enter the battlefield/.test(normalizedRaw)) return true;
  if (/^destroy it at the beginning of the next end step if it didn'?t attack/.test(normalizedRaw)) return true;
  if (/^sensational save\s*[-—]/.test(normalizedRaw)) return true;

  if (normalizedRaw === 'you pay') {
    return lastActionOutcome?.kind === 'applied' ? true : lastActionOutcome ? false : false;
  }
  if (normalizedRaw === 'you controlled that permanent') {
    return true;
  }
  if (normalizedRaw === "you can't choose an opponent this way") {
    return lastActionOutcome?.kind === 'impossible' ? true : lastActionOutcome?.kind === 'applied' ? false : false;
  }
  if (normalizedRaw === 'each opponent who didn\'t' || normalizedRaw === "each opponent who didn't") {
    if (ctx.interactivePlayerChoices === true) {
      return null;
    }
    return true;
  }
  if (normalizedRaw === 'each opponent who can\'t') {
    return true;
  }

  if (normalizedRaw === 'evidence was collected') {
    return typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : false;
  }
  if (normalizedRaw === 'this creature is saddled') {
    const source = getReferencedObject(nextState, ctx);
    return source ? Boolean((source as any)?.saddled ?? (source as any)?.isSaddled) : false;
  }
  if (
    normalizedRaw === "it's renowned" ||
    normalizedRaw === 'it is renowned' ||
    normalizedRaw === 'this creature is renowned'
  ) {
    const source =
      getReferencedObject(nextState, ctx) ??
      getContextSourceObject(ctx, (idRaw: string) =>
        findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
      );
    if (!source) return null;
    if (typeof (source as any)?.isRenowned === 'boolean') return (source as any).isRenowned;
    if (typeof (source as any)?.renowned === 'boolean') return (source as any).renowned;
    return false;
  }
  if (normalizedRaw === "this creature's spectacle cost was paid" || normalizedRaw === "this permanent's spectacle cost was paid") {
    const source = getReferencedObject(nextState, ctx);
    return source ? Boolean((source as any)?.spectacleCostPaid ?? (source as any)?.paidSpectacleCost) : false;
  }
  if (normalizedRaw === 'its surge cost was paid' || normalizedRaw === "this spell's surge cost was paid") {
    const readSurgePaid = (candidate: any): boolean | null => {
      if (!candidate || typeof candidate !== 'object') return null;
      const altId =
        candidate?.alternateCostId ??
        candidate?.alternativeCost ??
        candidate?.card?.alternateCostId ??
        candidate?.card?.alternativeCost;
      if (typeof altId === 'string' && altId.length > 0) {
        return String(altId).toLowerCase() === 'surge';
      }
      const raw =
        candidate?.surgeCostWasPaid ??
        candidate?.paidSurgeCost ??
        candidate?.surgePaid ??
        candidate?.castWithSurge ??
        candidate?.card?.surgeCostWasPaid ??
        candidate?.card?.paidSurgeCost ??
        candidate?.card?.surgePaid ??
        candidate?.card?.castWithSurge;
      return typeof raw === 'boolean' ? raw : null;
    };
    const source = getReferencedObject(nextState, ctx);
    const fromSource = readSurgePaid(source);
    if (typeof fromSource === 'boolean') return fromSource;
    const stackSpell = getStackSpellCard(nextState, ctx);
    const fromStack = readSurgePaid(stackSpell);
    if (typeof fromStack === 'boolean') return fromStack;
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    if (targetSpellId) {
      const stackItem = ((nextState as any)?.stack || []).find(
        (entry: any) => String(entry?.id || '').trim() === targetSpellId
      );
      const fromItem = readSurgePaid(stackItem);
      if (typeof fromItem === 'boolean') return fromItem;
    }
    if (typeof (ctx as any).surgeCostWasPaid === 'boolean') return (ctx as any).surgeCostWasPaid;
    return false;
  }
  return null;
}
