// Origin parent: client/src/utils/manaSourceBuilder.ts
// Cluster moved: sacrifice-cost candidate matching for "Sacrifice a creature: Add ..." mana sources.
// Public entry symbols: matchesSacrificeRequirement, sacrificeCandidateMemberCount,
//   countSacrificeCostActivations.

import type { BattlefieldPermanent } from '../../../shared/src';
import type { ManaPaymentSource } from './manaUtils';
import { groupedTokenMemberCount } from './expandGroupedTokens';

type SacrificeCost = NonNullable<ManaPaymentSource['sacrificeCost']>;

export function matchesSacrificeRequirement(
  candidate: BattlefieldPermanent,
  source: BattlefieldPermanent,
  playerId: string,
  sacrificeCost: SacrificeCost,
): boolean {
  const card = candidate?.card as any;
  if (!candidate || !card || typeof card !== 'object' || !card.name) return false;
  if (candidate.controller !== playerId) return false;
  if (sacrificeCost.mustBeOther && String(candidate.id || '') === String(source.id || '')) return false;

  const typeLine = String(card.type_line || '').toLowerCase();
  switch (sacrificeCost.permanentType) {
    case 'creature':
      if (!typeLine.includes('creature')) return false;
      if (sacrificeCost.creatureSubtype) {
        return typeLine.includes(String(sacrificeCost.creatureSubtype).toLowerCase());
      }
      return true;
    case 'artifact':
      return typeLine.includes('artifact');
    case 'enchantment':
      return typeLine.includes('enchantment');
    case 'land':
      return typeLine.includes('land');
    case 'permanent':
      return true;
    case 'artifact_or_creature':
      return typeLine.includes('artifact') || typeLine.includes('creature');
    case 'nonland_permanent':
      return !typeLine.includes('land');
    default:
      return false;
  }
}

/** Real permanents a battlefield entry stands for (emit stacks identical tokens and lands). */
export function sacrificeCandidateMemberCount(candidate: BattlefieldPermanent): number {
  return groupedTokenMemberCount(candidate);
}

/** How many times the sacrifice cost can be paid from the player's permanents. */
export function countSacrificeCostActivations(
  playerBattlefield: readonly BattlefieldPermanent[],
  source: BattlefieldPermanent,
  playerId: string,
  sacrificeCost: SacrificeCost,
): number {
  let members = 0;
  for (const candidate of playerBattlefield) {
    if (matchesSacrificeRequirement(candidate, source, playerId, sacrificeCost)) {
      members += sacrificeCandidateMemberCount(candidate);
    }
  }
  return Math.max(0, Math.floor(members / Math.max(1, sacrificeCost.count)));
}
