import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyRetiredTriggerLegacyCounterInlineBatch } from './oracleIrTriggerLegacyCounterHandlers.js';
import { applyRetiredTriggerLegacyPTModificationBatch } from './oracleIrTriggerLegacyPTModificationHandlers.js';
import { applyRetiredTriggerLegacyTapUntapInlineBatch } from './oracleIrTriggerLegacyTapUntapHandlers.js';
import { applyRetiredTriggerLegacyTargetLifeAndDamageBatch } from './oracleIrTriggerLegacyTargetDamageHandlers.js';
import { applyRetiredTriggerLegacyGraveyardZoneChangeBatch } from './oracleIrTriggerLegacyGraveyardZoneHandlers.js';
import { applyRetiredTriggerLegacyManaAndCombatBatch } from './oracleIrTriggerLegacyManaAndCombatHandlers.js';
import {
  applyRetiredTriggerLegacyCallTheCoppercoatsTokens,
  applyRetiredTriggerLegacyCreateXTokensByControlledTypeCount,
  applyRetiredTriggerLegacyDeployToTheFrontTokens,
  applyRetiredTriggerLegacyInterveningSubjectCopyToken,
  applyRetiredTriggerLegacyTappedAttackingCopyToken,
  applyRetiredTriggerLegacyTypedCountTokenFallbacks,
} from './oracleIrTriggerLegacyTokenHandlers.js';
import {
  applyRetiredTriggerLegacyCurseDefendingPlayer,
  applyRetiredTriggerLegacyDarienDamageTokens,
} from './oracleIrTriggerLegacyCardSpecificHandlers.js';
import { applyRetiredTriggerLegacyKeywordTriggerFallback } from './oracleIrTriggerLegacyKeywordHandlers.js';
import {
  applyRetiredTriggerLegacyLoseGameReplacement,
  applyRetiredTriggerLegacyThousandLifeLoseGame,
  applyRetiredTriggerLegacyUpkeepEffectDoubling,
} from './oracleIrTriggerLegacyLifeAndGameHandlers.js';
import { applyRetiredTriggerLegacyBothPlayersPutPermanentFromHand } from './oracleIrTriggerLegacyResolutionHandlers.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyLateEffectBatchParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly triggerCard: any;
  readonly state: any;
  readonly opponents: readonly any[];
  readonly players: readonly any[];
  readonly battlefield: readonly any[];
}

export function applyRetiredTriggerLegacyLateEffectRegexBatch(
  params: TriggerLegacyLateEffectBatchParams,
): boolean {
  const {
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    triggerCard,
    state,
    opponents,
    players,
    battlefield,
  } = params;

  if (skipRetiredTriggerLegacyHandler(desc, sourceName)) {
    return false;
  }

  if (applyRetiredTriggerLegacyCounterInlineBatch({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyInterveningSubjectCopyToken({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyPTModificationBatch({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyTappedAttackingCopyToken({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyTargetLifeAndDamageBatch({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    opponents,
    players,
    battlefield,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyTapUntapInlineBatch({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyGraveyardZoneChangeBatch({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyManaAndCombatBatch({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyCreateXTokensByControlledTypeCount({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyTypedCountTokenFallbacks({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyDarienDamageTokens({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyDeployToTheFrontTokens({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyCallTheCoppercoatsTokens({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyKeywordTriggerFallback({
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    triggerCard,
    battlefield,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyCurseDefendingPlayer({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyThousandLifeLoseGame({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyUpkeepEffectDoubling({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    battlefield,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyLoseGameReplacement({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyBothPlayersPutPermanentFromHand({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    players,
    battlefield,
  })) {
    return true;
  }

  return false;
}
