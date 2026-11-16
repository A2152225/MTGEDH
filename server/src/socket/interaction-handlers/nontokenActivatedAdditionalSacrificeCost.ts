// server/src/socket/interaction-handlers/nontokenActivatedAdditionalSacrificeCost.ts
// Brutal Suppression-style additional "Sacrifice a land" cost on activated
// abilities of matching nontoken permanents.

import { parseNontokenTypeActivatedAdditionalCost } from '../../state/modules/batch103Parsers.js';
import { permanentHasCreatureTypeNow } from '../../state/creatureTypeNow.js';

function isTokenPermanent(permanent: any): boolean {
  return Boolean(
    permanent?.isToken
    || permanent?.token
    || permanent?.card?.isToken
    || permanent?.card?.token
    || String(permanent?.tokenKind || permanent?.card?.tokenKind || '').trim()
  );
}

function matchesTypeWord(state: any, permanent: any, typeWord: string): boolean {
  const word = String(typeWord || '').trim().toLowerCase();
  if (!word) return false;
  if (word === 'permanent') return true;
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  if (typeLine.includes(word)) return true;
  try {
    return permanentHasCreatureTypeNow(permanent, word) === true;
  } catch {
    return false;
  }
}

export type AdditionalLandSacrifice = {
  costText: string;
  typeWord: string;
};

export function findNontokenActivatedAdditionalLandSacrifice(
  state: any,
  activatingPermanent: any,
): AdditionalLandSacrifice | null {
  if (!activatingPermanent || isTokenPermanent(activatingPermanent)) return null;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const source of battlefield) {
    if (!source || source.phasedOut === true) continue;
    const oracle = String(source.card?.oracle_text || source.oracle_text || '');
    const parsed = parseNontokenTypeActivatedAdditionalCost(oracle);
    if (!parsed) continue;
    if (!matchesTypeWord(state, activatingPermanent, parsed.typeWord)) continue;
    if (!/^sacrifice a land$/i.test(String(parsed.costText || '').trim())) continue;
    return { costText: parsed.costText, typeWord: parsed.typeWord };
  }
  return null;
}

export function applyNontokenActivatedAdditionalLandSacrifice(
  state: any,
  activatingPermanent: any,
  parsed: {
    sacrificeType: any;
    sacrificeCount: number;
    additionalLandSacrifice?: boolean;
  },
): void {
  const extra = findNontokenActivatedAdditionalLandSacrifice(state, activatingPermanent);
  if (!extra) return;
  parsed.additionalLandSacrifice = true;
  if (!parsed.sacrificeType) {
    parsed.sacrificeType = 'land';
    parsed.sacrificeCount = Math.max(1, Number(parsed.sacrificeCount || 1));
    return;
  }
  if (parsed.sacrificeType === 'land') {
    parsed.sacrificeCount = Math.max(1, Number(parsed.sacrificeCount || 1)) + 1;
  }
  // A different existing sacrifice cost still needs the extra land; the
  // activation path queues the printed sacrifice first. The additional land
  // is recorded so a follow-up prompt can be issued if that path supports it.
}
