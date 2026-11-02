// server/src/state/modules/alternativeCostOptions.ts
// B39: generic "X or Y" activation costs (Bloodthorn Flail "Equip\u2014Pay {3} or discard a card.").
// The shared equip parser stores the cost as "{3} or Discard a card"; this splits it into the options the
// player chooses between (OPTION_CHOICE), each of which is then paid by the existing single-cost stages.
// B40: payableAlternativeCostOptions drops options the player can't currently pay.
// Public entry symbols: parseAlternativeCostOptions, isAlternativeCostOptionPayable, payableAlternativeCostOptions.

export type CanPayManaFn = (state: any, playerId: string, cost: string) => boolean;
import { energyCostError, parseEnergyCost } from './equipNonManaCosts.js';
import { equipDiscardCandidates, equipLifeCostError, equipSacrificeCandidates, parseEquipDiscardCost, parseEquipLifeCost, parseEquipSacrificeCost } from './equipNonManaCosts.js';

function normalizePiece(raw: string): string {
  let s = String(raw || '').trim().replace(/[.]+$/, '');
  if (/^pay\s+\{/i.test(s)) s = s.replace(/^pay\s+/i, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function parseAlternativeCostOptions(cost: string | undefined | null): string[] | null {
  const parts = String(cost || '').split(/\s+or\s+/i).map(normalizePiece).filter(Boolean);
  if (parts.length < 2) return null;
  return parts;
}

/** True when playerId can pay this single cost now. Unknown cost shapes are treated as payable. */
export function isAlternativeCostOptionPayable(state: any, playerId: string, option: string, excludeIds: readonly string[] = [], canPayMana?: CanPayManaFn): boolean {
  if (parseEnergyCost(option) !== null) return energyCostError(state, playerId, option) === null; // B41
  if (parseEquipDiscardCost(option)) return equipDiscardCandidates(state, playerId, option).length > 0;
  if (parseEquipSacrificeCost(option)) return equipSacrificeCandidates(state, playerId, option, excludeIds).length > 0;
  if (parseEquipLifeCost(option) !== null) return equipLifeCostError(state, playerId, option) === null;
  if (/^(\{[^}]+\})+$/.test(String(option || '').trim())) {
    if (!canPayMana) return true;
    try { return canPayMana(state, playerId, option); } catch { return true; }
  }
  return true;
}

export function payableAlternativeCostOptions(state: any, playerId: string, options: readonly string[], excludeIds: readonly string[] = [], canPayMana?: CanPayManaFn): string[] {
  return options.filter((o) => isAlternativeCostOptionPayable(state, playerId, o, excludeIds, canPayMana));
}
