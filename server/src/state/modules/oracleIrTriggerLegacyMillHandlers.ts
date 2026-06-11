import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';

export interface TriggerLegacyMillParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly desc: string;
  readonly opponents: readonly any[];
  readonly state: any;
  readonly sourceName?: string;
}

export interface TriggerLegacyTargetMillParams extends TriggerLegacyMillParams {
  readonly sourceName: string;
  readonly triggerItem: any;
}

export function applyRetiredTriggerLegacyEachOpponentMills(
  _params: TriggerLegacyMillParams,
): boolean {
  return false;
}

export function applyRetiredTriggerLegacyThatPermanentControllerMills(
  _params: TriggerLegacyTargetMillParams,
): boolean {
  return false;
}

export function applyRetiredTriggerLegacyTargetPlayerMills(
  _params: TriggerLegacyTargetMillParams,
): boolean {
  return false;
}
