/**
 * Origin parent: oracleIRExecutorCreatureStepUtils.ts
 * Cluster moved: getProcessedBattlefield, printed/effective P/T readers, mass tap/untap
 *   selector text, subtype/source/control lookups
 * Public: getProcessedBattlefield, readPermanentPower, readPermanentToughness, permanentIsCreature,
 *   isMassTapOrUntapSelectorText, permanentHasSubtype, getSourceBattlefieldPermanent,
 *   getControlledPermanents
 */

import type { BattlefieldPermanent, GameState } from '../../../shared/src';
import { permanentHasCreatureType } from '../../../shared/src/creatureTypes.js';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { getCounterCountOnObject } from '../oracleIRExecutorModifyPtWhereUtils';
import { isExecutorCreature } from '../oracleIRExecutorPermanentUtils';
import { applyStaticAbilitiesToBattlefield } from '../staticAbilities';

export function getProcessedBattlefield(state: GameState): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefield((state.battlefield || []) as BattlefieldPermanent[]) as BattlefieldPermanent[];
}

function readPrintedOrEffectiveStat(
  permanent: any,
  effectiveKey: 'effectivePower' | 'effectiveToughness',
  fallbacks: readonly unknown[]
): number | null {
  const effective = Number(permanent?.[effectiveKey]);
  if (Number.isFinite(effective)) return effective;

  let printed: number | null = null;
  for (const value of fallbacks) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      printed = parsed;
      break;
    }
  }
  if (printed === null) return null;

  const plus = getCounterCountOnObject(permanent, '+1/+1');
  const minus = getCounterCountOnObject(permanent, '-1/-1');
  return printed + Math.max(0, plus) - Math.max(0, minus);
}

export function readPermanentPower(permanent: any): number | null {
  return readPrintedOrEffectiveStat(permanent, 'effectivePower', [
    permanent?.basePower,
    permanent?.card?.power,
    permanent?.power,
  ]);
}

export function readPermanentToughness(permanent: any): number | null {
  return readPrintedOrEffectiveStat(permanent, 'effectiveToughness', [
    permanent?.baseToughness,
    permanent?.card?.toughness,
    permanent?.toughness,
  ]);
}

export function permanentIsCreature(permanent: any): boolean {
  return isExecutorCreature(permanent);
}

/**
 * Mass tap/untap instructions ("all/each/every …") still resolve when no
 * permanents match. Targeted instructions must keep failing so later
 * instructions are not applied after an illegal empty target.
 */
export function isMassTapOrUntapSelectorText(text: string): boolean {
  const normalized = String(text || '').replace(/[.!?,;:]+$/g, '').trim().toLowerCase();
  if (!normalized) return false;
  if (/\btarget\b/.test(normalized)) return false;
  return /\b(?:all|each|every)\b/.test(normalized);
}

export function permanentHasSubtype(permanent: any, subtype: string | undefined): boolean {
  const needle = String(subtype || '').trim();
  if (!needle) return false;
  return permanentHasCreatureType(permanent, needle);
}

export function getSourceBattlefieldPermanent(state: GameState, ctx: OracleIRExecutionContext): any | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;
  return ((state.battlefield || []) as any[]).find((permanent) => String(permanent?.id || '').trim() === sourceId) || null;
}

export function getControlledPermanents(state: GameState, controllerId: string): any[] {
  const normalizedControllerId = String(controllerId || '').trim();
  return ((state.battlefield || []) as any[]).filter(
    (permanent) => String(permanent?.controller || permanent?.controllerId || '').trim() === normalizedControllerId
  );
}
