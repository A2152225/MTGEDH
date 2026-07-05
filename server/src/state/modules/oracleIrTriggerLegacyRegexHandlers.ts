import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';

export {
  applyTriggerOpponentDamageFromPermanent,
  modifyTriggerEffectLife,
  queueDealsDamageToPlayerTriggersFromPermanent,
} from './triggerLifeDamageUtils.js';
export { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyDrawLifeParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
  readonly isKynaiosEffect: boolean;
}

export interface TriggerLegacyOpponentEffectParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly triggerCard?: any;
  readonly state: any;
  readonly opponents: readonly any[];
  readonly battlefield: readonly any[];
}

export function matchesDealEachOpponentAndGainLifePattern(desc: string): boolean {
  return /deals? (\d+) damage to each opponent.*you gain (\d+) life/i.test(desc);
}
