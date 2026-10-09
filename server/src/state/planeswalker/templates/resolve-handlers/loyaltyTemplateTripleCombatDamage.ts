/**
 * Origin parent: loyaltyTemplateHandPutPumpControl.ts
 * Cluster: "Choose target creature. Until your next turn, if that creature would
 *   deal combat damage to one of your opponents, it deals triple that damage..."
 * Public: TRIPLE_COMBAT_DAMAGE_TO_OPPONENTS_UNTIL_YOUR_NEXT_TURN_REGEX,
 *   tryMatchTripleCombatDamageToOpponents, tryLoyaltyTemplateTripleCombatDamage
 */

import type { GameContext } from "../../../context.js";
import type { PlayerID } from "../../../../../../shared/src/types.js";
import type { PlaneswalkerTemplateMatch } from "../types.js";
import { debug } from "../../../../utils/debug.js";

export const TRIPLE_COMBAT_DAMAGE_TO_OPPONENTS_UNTIL_YOUR_NEXT_TURN_REGEX =
  /^choose target creature\.\s*until your next turn,\s*if that creature would deal combat damage to one of your opponents,\s*it deals triple that damage to that player instead\.?$/i;

export function tryMatchTripleCombatDamageToOpponents(text: string): PlaneswalkerTemplateMatch | null {
  if (TRIPLE_COMBAT_DAMAGE_TO_OPPONENTS_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) {
    return { id: 'TRIPLE_COMBAT_DAMAGE_TO_OPPONENTS_UNTIL_YOUR_NEXT_TURN', matchedText: text };
  }
  return null;
}

function getTargets(triggerItem: any): string[] {
  const raw = triggerItem?.targets;
  if (!Array.isArray(raw)) return [];
  return raw.map((t: any) => String(typeof t === 'string' ? t : t?.id || '')).filter(Boolean);
}

export function tryLoyaltyTemplateTripleCombatDamage(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem: any,
  match: PlaneswalkerTemplateMatch,
  _state: any,
  text: string,
): boolean | undefined {
  if (match.id !== 'TRIPLE_COMBAT_DAMAGE_TO_OPPONENTS_UNTIL_YOUR_NEXT_TURN') return undefined;
  if (!TRIPLE_COMBAT_DAMAGE_TO_OPPONENTS_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) return false;

  const [targetPermanentId] = getTargets(triggerItem);
  if (!targetPermanentId) return false;

  const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
  const target = battlefield.find((perm: any) => perm && String(perm.id) === String(targetPermanentId));
  if (!target) return false;

  const stateAny = (ctx as any).state || {};
  const grantText = 'Deals triple combat damage to opponents (until your next turn)';
  target.grantedAbilities = Array.isArray(target.grantedAbilities) ? target.grantedAbilities : [];
  if (!target.grantedAbilities.includes(grantText)) target.grantedAbilities.push(grantText);

  target.untilNextTurnGrants = Array.isArray(target.untilNextTurnGrants) ? target.untilNextTurnGrants : [];
  target.untilNextTurnGrants.push({
    controllerId: controller,
    turnApplied: stateAny.turnNumber || 0,
    grantedAbilities: [grantText],
    sourceName,
    kind: 'triple_combat_damage_to_opponents',
  });

  (ctx as any).bumpSeq?.();
  debug(2, `[planeswalker/templates] ${sourceName}: resolved ${match.id} on ${targetPermanentId}`);
  return true;
}
