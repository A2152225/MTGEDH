// server/src/socket/combat-handlers/combatR36DefenderConditionedAttack.ts
// R36: static grants "can't attack unless <condition about defending player>" (Red Lock family,
// "you control more lands than defending player"). The static pass does not know the defender, so the
// spec carries the condition text and this gate evaluates it once the attack target is chosen.
// Public entry symbols: defenderConditionedAttackReason.

import { getContinuousGrantedAbilitiesForPermanent } from '../../state/modules/staticEffectSpec.js';
import { parseStaticSelfCondition } from '../../state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalSelfGrants.js';
import { evalR35StaticCondition } from '../../state/modules/staticEffectSpecR35Conditions.js';

const PREFIX = "can't attack unless ";

export function defenderConditionedAttackReason(
  creature: any,
  defendingPlayerId: string | undefined,
  battlefield: readonly any[] | undefined,
  gameState?: unknown,
): string | null {
  const defender = String(defendingPlayerId || '').trim();
  if (!defender || !creature) return null;
  const field = Array.isArray(battlefield) ? battlefield : [];
  let abilities: string[] = [];
  try {
    abilities = getContinuousGrantedAbilitiesForPermanent(creature, { ...((gameState as any) || {}), battlefield: field });
  } catch {
    abilities = [];
  }
  for (const ability of abilities) {
    const text = String(ability || '');
    if (!text.startsWith(PREFIX) || !/defending player/.test(text)) continue;
    const condition = parseStaticSelfCondition(text.slice(PREFIX.length));
    if (!condition) continue;
    const ok = evalR35StaticCondition(condition, { ...creature, attacking: defender }, field, gameState);
    if (ok === false) return text;
  }
  return null;
}
