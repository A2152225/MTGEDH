import { debugWarn } from '../../utils/debug.js';

function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();

  const dashIndex = lower.indexOf('—') !== -1 ? lower.indexOf('—') : lower.indexOf('-');
  if (dashIndex !== -1) {
    const subtypes = lower.slice(dashIndex + 1).trim().split(/\s+/);
    types.push(...subtypes.filter((t) => t.length > 0));
  }

  return types;
}

/**
 * Check if a creature entering the battlefield would have haste
 * from effects already on the battlefield.
 *
 * Used when determining if a creature should have summoning sickness.
 */
export function creatureWillHaveHaste(
  card: any,
  controller: string,
  battlefield: any[],
): boolean {
  try {
    const cardTypeLine = (card?.type_line || '').toLowerCase();
    const cardOracleText = (card?.oracle_text || '').toLowerCase();

    if (cardOracleText.includes('haste')) {
      return true;
    }

    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;

      const grantorOracle = (perm.card.oracle_text || '').toLowerCase();
      const grantorController = perm.controller;

      if (grantorController === controller) {
        if (
          grantorOracle.includes('creatures you control have haste') ||
          grantorOracle.includes('other creatures you control have haste')
        ) {
          return true;
        }

        if (
          grantorOracle.includes('as though') &&
          grantorOracle.includes('had haste') &&
          (grantorOracle.includes('creatures you control') ||
            grantorOracle.includes('activate abilities'))
        ) {
          return true;
        }

        const creatureTypes = extractCreatureTypes(cardTypeLine);
        for (const creatureType of creatureTypes) {
          const typeIndex = grantorOracle.indexOf(creatureType);
          const hasteIndex = grantorOracle.indexOf('have haste');
          if (typeIndex !== -1 && hasteIndex !== -1 && typeIndex < hasteIndex) {
            const textBetween = grantorOracle.slice(typeIndex, hasteIndex);
            if (!textBetween.includes('.')) {
              return true;
            }
          }
        }
      }

      if (
        grantorOracle.includes('all creatures have haste') ||
        grantorOracle.includes('each creature has haste')
      ) {
        return true;
      }
    }

    return false;
  } catch (err) {
    debugWarn(1, '[creatureWillHaveHaste] Error checking haste:', err);
    return false;
  }
}
