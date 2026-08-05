import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import {
  computeTriggerLegacyIsKynaiosEffect,
  computeTriggerLegacySourceNames,
  stripTriggerLegacyInterveningIfPrefix,
} from './oracleIrTriggerLegacyDescPrepHandlers.js';
import { shouldSkipLegacyTriggerBodyHandlers } from './oracleIrTriggerLegacyRouting.js';

export type { TriggerEffectLegacyBodyContinuation, TriggerEffectLegacyBodyResult } from './stackResolveSharedTypes.js';
import type { TriggerEffectLegacyBodyContinuation, TriggerEffectLegacyBodyResult } from './stackResolveSharedTypes.js';

function buildTriggerEffectLegacyBodyContinuation(
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  state: any,
): TriggerEffectLegacyBodyContinuation {
  let desc = String(description || '').replace(/[â€™']/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const descriptionForOracleFallback = String(description || '');
  const {
    sourceNameLower,
    triggerSourceNameLower,
  } = computeTriggerLegacySourceNames(sourceName, triggerItem);
  const isKynaiosEffect = computeTriggerLegacyIsKynaiosEffect(sourceName, triggerItem, desc);
  desc = stripTriggerLegacyInterveningIfPrefix(desc);
  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  const battlefield = state.battlefield || [];
  return {
    desc,
    descriptionForOracleFallback,
    isKynaiosEffect,
    sourceNameLower,
    triggerSourceNameLower,
    opponents,
    players,
    battlefield,
  };
}

/**
 * Legacy trigger body chain — D3 export handlers are gone (P1d).
 * Only prepares continuation metadata for the IR / uncategorized tail.
 * Never returns handled: true.
 */
export function tryApplyTriggerEffectLegacyBodyHandlers(
  _ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  state: any,
  _triggerCard: any,
): TriggerEffectLegacyBodyResult {
  const triggerType = (triggerItem as any).triggerType;
  debug(2, `[executeTriggerEffect] triggerType=${triggerType}, sourceName=${sourceName}`);
  // Ownership skip and non-skip paths are identical: no body handlers remain after D3.
  void shouldSkipLegacyTriggerBodyHandlers(description, sourceName);
  return {
    handled: false,
    ...buildTriggerEffectLegacyBodyContinuation(controller, sourceName, description, triggerItem, state),
  };
}
