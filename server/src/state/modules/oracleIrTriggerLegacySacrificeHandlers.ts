import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { sacrificePermanent } from './upkeep-triggers.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyUpkeepSacrificeParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacyUpkeepSacrificeCreatureOrSelf(
  params: TriggerLegacyUpkeepSacrificeParams,
): boolean {
  const triggerTypeFromItem = params.triggerItem?.triggerType;
  const isUpkeepSacrificeTrigger = (
    triggerTypeFromItem === 'sacrifice_creature_or_self'
    || (params.desc.includes('sacrifice a creature')
      && (params.desc.includes('or sacrifice') || params.desc.includes("if you can't") || params.desc.includes('if you cannot')))
  );

  if (!isUpkeepSacrificeTrigger) {
    return false;
  }

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const gameId = (params.ctx as any).gameId || (params.ctx as any).id || params.triggerItem?.gameId || 'unknown';
  if ((params.ctx as any).isReplaying) {
    debug(2, `[executeTriggerEffect] Upkeep sacrifice: skipping resolution steps during replay`);
    return true;
  }

  const battlefield = params.state.battlefield || [];
  const controllerCreatures = battlefield.filter((perm: any) => {
    if (perm.controller !== params.controller) return false;
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  });

  const sourceId = params.triggerItem?.source || params.triggerItem?.permanentId || params.triggerItem?.sourceId;
  const sourcePermanent = battlefield.find((p: any) => p.id === sourceId);
  const sourceTypeLine = (sourcePermanent?.card?.type_line || '').toLowerCase();

  let alternativeSacrificeType = 'this permanent';
  if (sourceTypeLine.includes('artifact')) {
    alternativeSacrificeType = 'this artifact';
  } else if (sourceTypeLine.includes('enchantment')) {
    alternativeSacrificeType = 'this enchantment';
  }

  const stepConfig = {
    type: ResolutionStepType.UPKEEP_SACRIFICE,
    playerId: params.controller,
    description: `${params.sourceName}: Sacrifice a creature${controllerCreatures.length === 0 ? ` (you must sacrifice ${alternativeSacrificeType})` : ` or sacrifice ${alternativeSacrificeType}`}`,
    mandatory: true,
    sourceId,
    sourceName: params.sourceName,
    sourceImage: sourcePermanent?.card?.image_uris?.small || params.triggerItem?.card?.image_uris?.small,
    hasCreatures: controllerCreatures.length > 0,
    creatures: controllerCreatures.map((perm: any) => ({
      id: perm.id,
      name: perm.card?.name || 'Creature',
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      power: perm.card?.power || perm.basePower,
      toughness: perm.card?.toughness || perm.baseToughness,
    })),
    sourceToSacrifice: {
      id: sourceId,
      name: params.sourceName,
      imageUrl: sourcePermanent?.card?.image_uris?.small || sourcePermanent?.card?.image_uris?.normal,
    },
    alternativeSacrificeType,
  };

  if (gameId !== 'unknown') {
    ResolutionQueueManager.addStep(gameId, stepConfig);
    debug(2, `[executeTriggerEffect] ${params.sourceName}: Created upkeep sacrifice resolution step (${controllerCreatures.length} creatures available)`);
  } else {
    debugWarn(2, `[executeTriggerEffect] ${params.sourceName}: gameId is unknown, cannot create resolution step`);
    if (controllerCreatures.length === 0 && sourcePermanent) {
      debug(2, `[executeTriggerEffect] ${params.sourceName}: No creatures available, sacrificing source`);
      sacrificePermanent(params.ctx, String(sourceId), String(params.controller));
    }
  }

  return true;
}
