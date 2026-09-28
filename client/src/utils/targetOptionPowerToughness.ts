// client/src/utils/targetOptionPowerToughness.ts
// Current (effective) P/T for creature target options in target-selection prompts.
// Reuses the battlefield badge logic (computeDisplayPT): server-computed effectivePower /
// effectiveToughness from the game view (counters, anthems, equipment, until-end-of-turn
// pumps), falling back to base + P/T counters.
// Public entry symbols: TargetOptionPowerToughness, resolveTargetOptionPowerToughness,
//   formatTargetOptionPowerToughness.

import type { BattlefieldPermanent } from '../../../shared/src';
import { computeDisplayPT } from '../components/FreeField-handlers/freeFieldDisplayUtils';

export interface TargetOptionPowerToughness {
  power: number;
  toughness: number;
  basePower?: number;
  baseToughness?: number;
}

function isCreatureLike(target: any, perm: any): boolean {
  const typeLine = String(
    perm?.card?.type_line
      || target?.typeLine
      || target?.card?.type_line
      || target?.card?.card?.type_line
      || '',
  ).toLowerCase();
  return /\bcreature\b/.test(typeLine);
}

/**
 * @param target  raw server target entry (validTargets item) or mapped TargetOption
 * @param battlefieldPerm  the matching permanent from the client game view, if any
 */
export function resolveTargetOptionPowerToughness(
  target: any,
  battlefieldPerm?: any,
): TargetOptionPowerToughness | undefined {
  if (!isCreatureLike(target, battlefieldPerm)) return undefined;

  // Prefer the view permanent (server-computed effective P/T), then any permanent-shaped
  // payload the server attached to the target entry.
  const candidates: any[] = [
    battlefieldPerm,
    target?.card && (target.card as any).card ? target.card : undefined,
    typeof target?.effectivePower === 'number' ? { ...target, card: target.card || {} } : undefined,
  ].filter(Boolean);

  for (const perm of candidates) {
    const { baseP, baseT, p, t } = computeDisplayPT(perm as BattlefieldPermanent);
    if (typeof p === 'number' && typeof t === 'number') {
      return {
        power: p,
        toughness: t,
        ...(typeof baseP === 'number' ? { basePower: baseP } : {}),
        ...(typeof baseT === 'number' ? { baseToughness: baseT } : {}),
      };
    }
  }
  return undefined;
}

export function formatTargetOptionPowerToughness(pt: TargetOptionPowerToughness | undefined): string | undefined {
  if (!pt) return undefined;
  return `${pt.power}/${pt.toughness}`;
}