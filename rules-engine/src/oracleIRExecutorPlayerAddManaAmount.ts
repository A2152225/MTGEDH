// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: battlefield-stat readers, expandManaCostToManaSequence,
// resolveDynamicAddManaSequence, resolveAddManaAmount.
// Public entries: readPermanentPower, permanentIsCreature, permanentHasSubtype,
// repeatManaString, resolveDynamicAddManaSequence, resolveAddManaAmount.

import type { GameState } from '../../shared/src';
import { permanentHasCreatureType } from '../../shared/src/creatureTypes.js';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { countManaSymbolsInManaCost } from './oracleIRExecutorManaUtils';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  getCardManaValue,
  getCardTypeLineLower,
  normalizeOracleText,
  quantityToNumber,
} from './oracleIRExecutorPlayerUtils';
import { parseManaSymbols } from './types/numbers';

export function readPermanentPower(permanent: any): number | null {
  for (const value of [permanent?.effectivePower, permanent?.basePower, permanent?.card?.power, permanent?.power]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readPermanentToughness(permanent: any): number | null {
  for (const value of [permanent?.effectiveToughness, permanent?.baseToughness, permanent?.card?.toughness, permanent?.toughness]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function permanentIsCreature(permanent: any): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || permanent?.cardType || '')
    .toLowerCase();
  return /\bcreature\b/.test(typeLine);
}

export function permanentHasSubtype(permanent: any, subtype: string | undefined): boolean {
  const needle = String(subtype || '').trim();
  if (!needle) return false;
  return permanentHasCreatureType(permanent, needle);
}

export function repeatManaString(mana: string, count: number): string {
  if (count <= 0) return '';
  return Array.from({ length: count }, () => mana).join('');
}

function getSourceBattlefieldPermanent(state: GameState, ctx: OracleIRExecutionContext): any | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  return ((state.battlefield || []) as any[]).find((permanent) => String(permanent?.id || '').trim() === sourceId) || null;
}

function readCounterCount(permanent: any, counterName: string): number {
  const normalizedCounterName = normalizeOracleText(counterName);
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object') return 0;

  for (const [name, value] of Object.entries(counters)) {
    if (normalizeOracleText(name) !== normalizedCounterName) continue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }

  return 0;
}

function getControlledPermanents(state: GameState, controllerId: string): any[] {
  const normalizedControllerId = String(controllerId || '').trim();
  return ((state.battlefield || []) as any[]).filter(
    (permanent) => String(permanent?.controller || permanent?.controllerId || '').trim() === normalizedControllerId
  );
}

function expandManaCostToManaSequence(rawManaCost: string): string | null {
  const symbols = parseManaSymbols(String(rawManaCost || '').trim());
  if (symbols.length === 0) return '';

  let mana = '';
  for (const symbolRaw of symbols) {
    const symbol = String(symbolRaw || '').trim().toUpperCase();
    if (!symbol) continue;

    if (/^\{\d+\}$/.test(symbol)) {
      mana += repeatManaString('{C}', Number.parseInt(symbol.slice(1, -1), 10));
      continue;
    }

    if (/^\{[WUBRGC]\}$/.test(symbol)) {
      mana += symbol;
      continue;
    }

    return null;
  }

  return mana;
}

export function resolveDynamicAddManaSequence(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): string | null | undefined {
  const normalizedReference = step.amount?.kind === 'reference_amount'
    ? normalizeOracleText(String(step.amount.raw || ''))
    : '';
  if (normalizedReference !== "enchanted permanent's mana cost") return undefined;

  const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
  if (!sourcePermanent) return null;

  const attachedToId = String(sourcePermanent?.attachedTo || sourcePermanent?.enchanting || '').trim();
  if (!attachedToId) return null;

  const enchantedPermanent = ((state.battlefield || []) as any[]).find(
    (permanent) => String(permanent?.id || '').trim() === attachedToId
  );
  if (!enchantedPermanent) return null;

  const manaCost = String(
    enchantedPermanent?.manaCost ||
      enchantedPermanent?.mana_cost ||
      enchantedPermanent?.card?.manaCost ||
      enchantedPermanent?.card?.mana_cost ||
      ''
  ).trim();
  return expandManaCostToManaSequence(manaCost);
}

export function resolveAddManaAmount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): number | null {
  if (!step.amount) return 1;

  if (step.amount.kind === 'number') return Math.max(0, Math.floor(step.amount.value));
  if (step.amount.kind === 'x') return Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number)) : null;
  if (step.amount.kind === 'object_stat') {
    const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
    const subject = String(step.amount.subject || '');
    const attachedToId = String(
      sourcePermanent?.attachedTo
      || sourcePermanent?.enchanting
      || (ctx as any).targetPermanentId
      || ctx.selectorContext?.targetPermanentId
      || (ctx.selectorContext as any)?.attachedToId
      || '',
    ).trim();
    const hostPermanent = attachedToId
      ? ((state.battlefield || []) as any[]).find((permanent) => String(permanent?.id || '').trim() === attachedToId)
      : null;
    const statPermanent = (
      hostPermanent
      && (subject === 'it' || subject === 'this_creature' || subject === 'this_permanent' || subject === 'source')
    )
      ? hostPermanent
      : sourcePermanent;
    if (!statPermanent) return null;
    if (step.amount.stat === 'power') return readPermanentPower(statPermanent);
    if (step.amount.stat === 'toughness') return readPermanentToughness(statPermanent);
    if (step.amount.stat === 'mana_value') return getCardManaValue(statPermanent?.card || statPermanent);
    return null;
  }
  if (step.amount.kind === 'greatest_power_among_creatures_you_control') {
    const powers = getControlledPermanents(state, ctx.controllerId)
      .filter(permanentIsCreature)
      .map(readPermanentPower)
      .filter((value): value is number => value !== null);
    return powers.length > 0 ? Math.max(0, ...powers) : 0;
  }
  if (step.amount.kind === 'reference_amount') {
    const normalized = normalizeOracleText(String(step.amount.raw || ''));
    const sourcePermanent = getSourceBattlefieldPermanent(state, ctx);
    switch (normalized) {
      case 'the chosen colors':
        return 1;
      case 'the number of art counters on this permanent plus one':
        return sourcePermanent ? readCounterCount(sourcePermanent, 'art') + 1 : null;
      case 'the number of time counters on this artifact':
        return sourcePermanent ? readCounterCount(sourcePermanent, 'time') : null;
      case 'the number of charge counters on this artifact':
        return sourcePermanent ? readCounterCount(sourcePermanent, 'charge') : null;
      case 'the number of different powers among creatures you control': {
        const powers = new Set<number>();
        for (const permanent of getControlledPermanents(state, ctx.controllerId).filter(permanentIsCreature)) {
          const power = readPermanentPower(permanent);
          if (power !== null) powers.add(power);
        }
        return powers.size;
      }
      case 'x plus one':
      case 'x plus one cards':
        return Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number) + 1) : null;
      case 'your devotion to green': {
        return getControlledPermanents(state, ctx.controllerId)
          .reduce((sum, permanent) => sum + countManaSymbolsInManaCost(permanent, 'G'), 0);
      }
      case 'the greatest power among creatures you control that entered this turn': {
        const powers = getControlledPermanents(state, ctx.controllerId)
          .filter(permanentIsCreature)
          .filter((permanent) => permanent?.enteredThisTurn === true)
          .map(readPermanentPower)
          .filter((value): value is number => value !== null);
        return powers.length > 0 ? Math.max(0, ...powers) : 0;
      }
      case 'the number of creatures you control of the chosen type': {
        const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
        if (!chosenType) return null;
        return getControlledPermanents(state, ctx.controllerId)
          .filter(permanentIsCreature)
          .filter((permanent) => permanentHasSubtype(permanent, chosenType))
          .length;
      }
      case 'twice that much': {
        const quantity = quantityToNumber({ kind: 'reference_amount', raw: 'that much' }, ctx);
        return quantity === null ? null : Math.max(0, quantity * 2);
      }
      case 'the high bid': {
        const referenceAmount = Number(ctx.referenceAmount);
        return Number.isFinite(referenceAmount) ? Math.max(0, referenceAmount) : 2;
      }
      case 'noncreature cards exiled this way': {
        const exiledCards = Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : [];
        return exiledCards.filter((card: any) => !getCardTypeLineLower(card).includes('creature')).length;
      }
      default: {
        const evaluated = evaluateModifyPtWhereX(state, ctx.controllerId, `X is ${normalized}`, undefined, ctx);
        if (evaluated !== null) return Math.max(0, evaluated);
        const quantity = quantityToNumber(step.amount, ctx);
        return quantity === null ? null : Math.max(0, quantity);
      }
    }
  }

  if (step.amount.kind === 'unknown') {
    const normalized = normalizeOracleText(String(step.amount.raw || ''));
    const evaluated = evaluateModifyPtWhereX(state, ctx.controllerId, `X is ${normalized}`, undefined, ctx);
    if (evaluated !== null) return Math.max(0, evaluated);
  }

  const quantity = quantityToNumber(step.amount, ctx);
  return quantity === null ? null : Math.max(0, quantity);
}
