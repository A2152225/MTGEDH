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
  let desc = String(description || '').replace(/[â€™]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  let descriptionForOracleFallback = String(description || '');
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

export function tryApplyTriggerEffectLegacyBodyHandlers(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  state: any,
  triggerCard: any,
): TriggerEffectLegacyBodyResult {
  if (shouldSkipLegacyTriggerBodyHandlers(description, sourceName)) {
    return {
      handled: false,
      ...buildTriggerEffectLegacyBodyContinuation(controller, sourceName, description, triggerItem, state),
    };
  }

  let desc = String(description || '').replace(/[â€™]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  const {
    sourceNameLower,
    triggerSourceNameLower,
  } = computeTriggerLegacySourceNames(sourceName, triggerItem);
  const isKynaiosEffect = computeTriggerLegacyIsKynaiosEffect(sourceName, triggerItem, desc);

  desc = stripTriggerLegacyInterveningIfPrefix(desc);

  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  const battlefield = state.battlefield || [];

  const triggerType = (triggerItem as any).triggerType;
  debug(2, `[executeTriggerEffect] triggerType=${triggerType}, sourceName=${sourceName}`);

  return {
    handled: false,
    desc,
    descriptionForOracleFallback: String(description || ''),
    isKynaiosEffect,
    sourceNameLower,
    triggerSourceNameLower,
    opponents,
    players,
    battlefield,
  };
}
