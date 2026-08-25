// server/src/state/modules/can-respond-handlers/canRespondSpellTypePredicates.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: isPermanentSpellType and isSorcerySpeedSpellCard.
// Public entry symbols: isPermanentSpellType, isSorcerySpeedSpellCard.

import { isLandTypeLine } from './canRespondSplitSecondLandPredicates.js';

export function isPermanentSpellType(typeLine: string): boolean {
  return (
    typeLine.includes('creature') ||
    typeLine.includes('artifact') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('planeswalker') ||
    typeLine.includes('battle')
  );
}

export function isSorcerySpeedSpellCard(card: any): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (isLandTypeLine(typeLine)) return false;

  return (
    typeLine.includes('creature') ||
    typeLine.includes('sorcery') ||
    typeLine.includes('artifact') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('planeswalker') ||
    typeLine.includes('battle')
  );
}
