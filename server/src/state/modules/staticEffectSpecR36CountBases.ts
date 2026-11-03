// server/src/state/modules/staticEffectSpecR36CountBases.ts
// R36 "for each" phrases for counted P/T statics (census long tail):
//   "for each Aura on the battlefield" (Aura Gnarlid)                    -> countWho all
//   "for each Swamp your opponents control" (Crusading Knight)            -> countWho opponents (subtypes too)
//   "for each creature card in your opponents' graveyards" (Wight of Precinct Six) / "in all graveyards"
// Evaluated by staticEffectSpecCountBases (controller_permanents_of_type / controller_graveyard_cards_of_type).
// Public entry symbols: parseR36CountGrant.

import type { StaticEffectGrant } from './staticEffectSpecTypes.js';

export function parseR36CountGrant(phrase: string): Partial<StaticEffectGrant> | null {
  const p = String(phrase || '').trim();
  let m = p.match(/^(other )?([a-z]+) on the battlefield$/);
  if (m && !/^(?:card|permanent|token|other|nonland)$/.test(m[2])) {
    return { countBasis: 'controller_permanents_of_type', countCardType: m[2], countWho: 'all', ...(m[1] ? { countExcludeSource: true } : {}) } as any;
  }
  m = p.match(/^([a-z]+) (?:your opponents control|an opponent controls)$/);
  if (m && !/^(?:card|token|other|nonland)$/.test(m[1])) {
    return { countBasis: 'controller_permanents_of_type', countCardType: m[1] === 'permanent' ? '' : m[1], countWho: 'opponents' } as any;
  }
  m = p.match(/^(?:([a-z]+) )?cards? in (your opponents'|an opponent's|all) graveyards?$/);
  if (m) {
    return { countBasis: 'controller_graveyard_cards_of_type', countCardType: m[1] || '', countWho: m[2] === 'all' ? 'all' : 'opponents' } as any;
  }
  return null;
}
