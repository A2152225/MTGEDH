import type { BattlefieldPermanent } from '../../../shared/src';

export type DevotionColorCode = 'W' | 'U' | 'B' | 'R' | 'G';
const DEVOTION_COLOR_CODES: DevotionColorCode[] = ['W', 'U', 'B', 'R', 'G'];

export function calculateDevotion(
  battlefield: readonly BattlefieldPermanent[],
  playerId: string,
  color: DevotionColorCode,
): number {
  let devotion = 0;

  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    const manaCost = String((permanent.card as any)?.mana_cost || '');
    if (!manaCost) continue;

    const singleColorRegex = new RegExp(`\\{${color}\\}`, 'gi');
    devotion += (manaCost.match(singleColorRegex) || []).length;

    const hybridRegex = new RegExp(`\\{${color}\\/[WUBRGP]\\}|\\{[WUBRG]\\/${color}\\}`, 'gi');
    devotion += (manaCost.match(hybridRegex) || []).length;

    const twobrideRegex = new RegExp(`\\{2\\/${color}\\}`, 'gi');
    devotion += (manaCost.match(twobrideRegex) || []).length;
  }

  return devotion;
}

export function getDevotionByColor(
  battlefield: readonly BattlefieldPermanent[],
  playerId: string,
): Record<DevotionColorCode, number> {
  return {
    W: calculateDevotion(battlefield, playerId, 'W'),
    U: calculateDevotion(battlefield, playerId, 'U'),
    B: calculateDevotion(battlefield, playerId, 'B'),
    R: calculateDevotion(battlefield, playerId, 'R'),
    G: calculateDevotion(battlefield, playerId, 'G'),
  };
}

export function countControlledCreaturesOfType(
  battlefield: readonly BattlefieldPermanent[],
  playerId: string,
  creatureType: string,
): number {
  const chosenTypeLower = String(creatureType || '').trim().toLowerCase();
  if (!chosenTypeLower) return 0;

  return battlefield.filter((permanent) => {
    if (!permanent || permanent.controller !== playerId) return false;
    const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) return false;
    const subTypes = (typeLine.split(/\s*[—–-]\s*/)[1] || '').toLowerCase();
    return subTypes.includes(chosenTypeLower);
  }).length;
}

export function getAllowedDevotionColors(
  devotionByColor: Record<DevotionColorCode, number>,
): DevotionColorCode[] {
  return DEVOTION_COLOR_CODES.filter((color) => (devotionByColor[color] || 0) > 0);
}
