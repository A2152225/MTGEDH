// server/src/state/modules/can-respond-handlers/canRespondActivatedAbilityCondition.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: isActivatedAbilityConditionMet.
// Public entry symbols: isActivatedAbilityConditionMet.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { checkOpponentHasMoreLands } from '../stackLandCountUtils.js';
import { detectActivatedAbilityConditionRequirement } from '../activated-ability-conditions.js';
import { getActiveAbilityConditions } from '../game-state-effects.js';

export function isActivatedAbilityConditionMet(ctx: GameContext, playerId: PlayerID, fullAbilityText: string, oracleText?: string, matchIndex?: number): boolean {
  const abilityLine = typeof matchIndex === 'number' && Number.isFinite(matchIndex)
    ? String(oracleText || '').slice(Math.max(0, matchIndex), matchIndex + 500)
    : '';
  if (/activate only if an opponent controls more lands than you/i.test(`${fullAbilityText}\n${abilityLine}`)) {
    return checkOpponentHasMoreLands((ctx as any).state, playerId).anyOpponentHasMoreLands;
  }

  const requirement = detectActivatedAbilityConditionRequirement(fullAbilityText, oracleText, matchIndex);
  if (!requirement) {
    return true;
  }

  const activeConditions = getActiveAbilityConditions(ctx, playerId);
  return activeConditions[requirement.key] === true;
}
