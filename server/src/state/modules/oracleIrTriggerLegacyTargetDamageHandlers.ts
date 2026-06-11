import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';

export function applyRetiredTriggerLegacyTargetLifeAndDamageBatch(_params: {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly opponents: readonly any[];
  readonly players: readonly any[];
  readonly battlefield: readonly any[];
}): boolean {
  return false;
}
