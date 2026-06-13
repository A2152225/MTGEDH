import type { BattlefieldPermanent } from '../../../shared/src';
import { getLandwalkUnblockableReason } from '../../../shared/src/combatLandwalk';
import { hasCurrentKeyword } from './creatureUtils';

export function canBlockAttacker(
  blocker: BattlefieldPermanent,
  attacker: BattlefieldPermanent,
  battlefield: BattlefieldPermanent[],
): { canBlock: boolean; reason?: string } {
  const landwalkReason = getLandwalkUnblockableReason(attacker, blocker.controller, battlefield);
  if (landwalkReason) {
    return { canBlock: false, reason: landwalkReason };
  }

  if (hasCurrentKeyword(attacker, 'flying', battlefield)) {
    if (!hasCurrentKeyword(blocker, 'flying', battlefield) && !hasCurrentKeyword(blocker, 'reach', battlefield)) {
      return { canBlock: false, reason: "Can't block flying" };
    }
  }

  if (hasCurrentKeyword(attacker, 'shadow', battlefield)) {
    if (!hasCurrentKeyword(blocker, 'shadow', battlefield)) {
      return { canBlock: false, reason: "Can't block shadow" };
    }
  }

  if (hasCurrentKeyword(attacker, 'horsemanship', battlefield)) {
    if (!hasCurrentKeyword(blocker, 'horsemanship', battlefield)) {
      return { canBlock: false, reason: "Can't block horsemanship" };
    }
  }

  return { canBlock: true };
}
