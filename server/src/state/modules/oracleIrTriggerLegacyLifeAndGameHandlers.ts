import type { PlayerID } from '../../../../shared/src/index.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyLifeAndGameParams {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly battlefield?: readonly any[];
}

export function applyRetiredTriggerLegacyLoseGameReplacement(
  params: TriggerLegacyLifeAndGameParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!/the next time you would lose the game this turn, instead draw three cards and your life total becomes 5/i.test(String(params.desc || ''))) {
    return false;
  }

  params.state.pendingLoseGameReplacements = Array.isArray(params.state.pendingLoseGameReplacements)
    ? params.state.pendingLoseGameReplacements
    : [];
  params.state.pendingLoseGameReplacements.push({
    playerId: params.controller,
    drawCount: 3,
    lifeTotal: 5,
    sourceName: params.sourceName,
    expiresAt: 'end_of_turn',
  });
  debug(2, `[executeTriggerEffect] ${params.sourceName}: registered lose-the-game replacement for ${params.controller}`);
  return true;
}
