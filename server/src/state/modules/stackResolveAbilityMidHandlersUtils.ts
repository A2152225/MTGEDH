import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { StackActivatedAbilityHandlerContext } from './stackResolveSharedTypes.js';

export type { StackActivatedAbilityHandlerContext } from './stackResolveSharedTypes.js';

import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { canPermanentBeTargetedByPlayer } from '../../rules-engine/targeting.js';
import { getEffectivePower } from '../../socket/util.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import { applyDamageToPermanentWithCounterEffects } from './counter-common-effects.js';
import { runSBA } from './counters_tokens.js';
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from './triggers/damage-received.js';
import { attachEquipmentToCreature } from './triggerEquipmentUtils.js';

function resolveCreatureUpgradeAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const source = item?.source;
  const upgradeData = item?.upgradeData || {};
  debug(2, `[resolveCreatureUpgradeAbility] Resolving creature upgrade ability from ${sourceName} for ${controller}`);

  const battlefield = state.battlefield || [];
  const sourcePerm = battlefield.find((entry: any) => entry.id === source);
  if (!sourcePerm) {
    debug(2, `[resolveCreatureUpgradeAbility] Creature upgrade: source permanent ${source} no longer on battlefield`);
    return;
  }

  const changes: string[] = [];
  if (upgradeData.newTypes && upgradeData.newTypes.length > 0) {
    (sourcePerm as any).upgradedCreatureTypes = [...upgradeData.newTypes];
    const typeLine = (sourcePerm as any).card?.type_line || 'Creature';
    const dashMatch = typeLine.match(/^(.+?)(?:\s+[â€—-]\s+.+)?$/);
    const mainTypes = String(dashMatch?.[1] || typeLine).trim();
    (sourcePerm as any).card = (sourcePerm as any).card || {};
    (sourcePerm as any).card.type_line = `${mainTypes} - ${upgradeData.newTypes.join(' ')}`;
    changes.push(`became a ${upgradeData.newTypes.join(' ')}`);
  }

  if (upgradeData.newPower !== undefined) {
    (sourcePerm as any).basePower = upgradeData.newPower;
    changes.push(`base power is now ${upgradeData.newPower}`);
  }
  if (upgradeData.newToughness !== undefined) {
    (sourcePerm as any).baseToughness = upgradeData.newToughness;
    changes.push(`base toughness is now ${upgradeData.newToughness}`);
  }

  if (upgradeData.keywords && upgradeData.keywords.length > 0) {
    (sourcePerm as any).grantedKeywords = (sourcePerm as any).grantedKeywords || [];
    for (const keyword of upgradeData.keywords) {
      if (!(sourcePerm as any).grantedKeywords.includes(keyword)) {
        (sourcePerm as any).grantedKeywords.push(keyword);
        changes.push(`gained ${keyword}`);
      }
    }
  }

  if (upgradeData.counterCount && upgradeData.counterType) {
    (sourcePerm as any).counters = (sourcePerm as any).counters || {};
    (sourcePerm as any).counters[upgradeData.counterType] =
      ((sourcePerm as any).counters[upgradeData.counterType] || 0) + upgradeData.counterCount;
    changes.push(`got ${upgradeData.counterCount} ${upgradeData.counterType} counter(s)`);
  }

  debug(1, `[resolveCreatureUpgradeAbility] Creature upgrade applied to ${sourceName}: ${changes.join(', ')}`);
}

function resolveFightAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const fightParams = item?.fightParams || {};
  const sourceCreatureId = String(fightParams.sourceCreatureId || item?.source || '');
  const targetCreatureId = String(fightParams.targetCreatureId || item?.targets?.[0] || '');
  debug(2, `[resolveFightAbility] Resolving fight ability from ${sourceName} for ${controller}`);

  if (!sourceCreatureId || !targetCreatureId) {
    debugWarn(2, `[resolveFightAbility] Fight ability missing parameters`);
    return;
  }

  const battlefield = state.battlefield || [];
  const sourceCreature = battlefield.find((entry: any) => entry.id === sourceCreatureId);
  const targetCreature = battlefield.find((entry: any) => entry.id === targetCreatureId);

  if (!sourceCreature) {
    debug(2, `[resolveFightAbility] Fight source ${sourceName || sourceCreatureId} no longer on battlefield`);
    return;
  }
  if (!targetCreature) {
    debug(2, `[resolveFightAbility] Fight target ${fightParams.targetCreatureName || targetCreatureId} no longer on battlefield`);
    return;
  }
  if (!isCreatureNow(sourceCreature) || !isCreatureNow(targetCreature)) {
    debug(2, `[resolveFightAbility] Fight source or target is no longer a creature`);
    return;
  }
  if (!canPermanentBeTargetedByPlayer(targetCreature as any, state as any, controller as any)) {
    debug(2, `[resolveFightAbility] Fight target ${fightParams.targetCreatureName || targetCreatureId} is no longer a legal target`);
    return;
  }

  const sourcePower = getEffectivePower(sourceCreature as any);
  const targetPower = getEffectivePower(targetCreature as any);
  const sourceDamageResult = applyDamageToPermanentWithCounterEffects(sourceCreature, targetPower, 'damageMarked');
  const targetDamageResult = applyDamageToPermanentWithCounterEffects(targetCreature, sourcePower, 'damageMarked');

  try {
    const stateAny = state as any;
    stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
    if (sourceDamageResult.appliedAmount > 0) {
      stateAny.creaturesDamagedByThisCreatureThisTurn[sourceCreatureId] = stateAny.creaturesDamagedByThisCreatureThisTurn[sourceCreatureId] || {};
      stateAny.creaturesDamagedByThisCreatureThisTurn[sourceCreatureId][targetCreatureId] = true;
      (targetCreature as any).damageThisTurn = ((targetCreature as any).damageThisTurn || 0) + sourceDamageResult.appliedAmount;
      (targetCreature as any).tookDamageThisTurn = true;
    }
    if (targetDamageResult.appliedAmount > 0) {
      stateAny.creaturesDamagedByThisCreatureThisTurn[targetCreatureId] = stateAny.creaturesDamagedByThisCreatureThisTurn[targetCreatureId] || {};
      stateAny.creaturesDamagedByThisCreatureThisTurn[targetCreatureId][sourceCreatureId] = true;
      (sourceCreature as any).damageThisTurn = ((sourceCreature as any).damageThisTurn || 0) + targetDamageResult.appliedAmount;
      (sourceCreature as any).tookDamageThisTurn = true;
    }
  } catch {
    // best-effort only
  }

  const queueDamageTrigger = (perm: any, damageAmount: number) => {
    processDamageReceivedTriggers(ctx as any, perm, damageAmount, (triggerInfo) => {
      if (dispatchDamageReceivedTrigger(ctx as any, triggerInfo)) {
        return;
      }

      (state as any).pendingDamageTriggers = (state as any).pendingDamageTriggers || {};
      (state as any).pendingDamageTriggers[triggerInfo.triggerId] = {
        sourceId: triggerInfo.sourceId,
        sourceName: triggerInfo.sourceName,
        controller: triggerInfo.controller,
        damageAmount: triggerInfo.damageAmount,
        triggerType: 'dealt_damage',
        targetType: triggerInfo.targetType,
        effect: triggerInfo.effect,
        ...(triggerInfo.effectMode ? { effectMode: triggerInfo.effectMode } : {}),
        ...(triggerInfo.attackingPlayerId ? { attackingPlayerId: triggerInfo.attackingPlayerId } : {}),
        ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
      };
    });
  };

  if (sourceDamageResult.appliedAmount > 0) {
    queueDamageTrigger(targetCreature, sourceDamageResult.appliedAmount);
  }
  if (targetDamageResult.appliedAmount > 0) {
    queueDamageTrigger(sourceCreature, targetDamageResult.appliedAmount);
  }

  try {
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId) {
      appendEvent(gameId, (state as any).seq ?? 0, 'fight', {
        playerId: controller,
        sourceId: sourceCreatureId,
        targetId: targetCreatureId,
        sourcePower,
        targetPower,
      });
    }
  } catch (err) {
    debugWarn(1, '[resolveFightAbility] appendEvent(fight) failed:', err);
  }

  runSBA(ctx);
}

function resolveLevelUpAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const sourcePermanentId = String(item?.source || '');
  debug(2, `[resolveLevelUpAbility] Resolving level up ability from ${sourceName} for ${controller}`);

  const battlefield = state.battlefield || [];
  const sourcePerm = battlefield.find((entry: any) => entry.id === sourcePermanentId);
  if (!sourcePerm) {
    debug(2, `[resolveLevelUpAbility] Level up source ${sourceName || sourcePermanentId} no longer on battlefield`);
    return;
  }

  (sourcePerm as any).counters = (sourcePerm as any).counters || {};
  (sourcePerm as any).counters.level = Number((sourcePerm as any).counters.level || 0) + Number(item?.levelUpParams?.amount || 1);
  runSBA(ctx);
}

function resolveOutlastAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const sourcePermanentId = String(item?.source || '');
  debug(2, `[resolveOutlastAbility] Resolving outlast ability from ${sourceName} for ${controller}`);

  const battlefield = state.battlefield || [];
  const sourcePerm = battlefield.find((entry: any) => entry.id === sourcePermanentId);
  if (!sourcePerm) {
    debug(2, `[resolveOutlastAbility] Outlast source ${sourceName || sourcePermanentId} no longer on battlefield`);
    return;
  }

  (sourcePerm as any).counters = (sourcePerm as any).counters || {};
  (sourcePerm as any).counters['+1/+1'] = Number((sourcePerm as any).counters['+1/+1'] || 0) + Number(item?.outlastParams?.amount || 1);
  runSBA(ctx);
}

function resolveMonstrosityAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const sourcePermanentId = String(item?.source || '');
  debug(2, `[resolveMonstrosityAbility] Resolving monstrosity ability from ${sourceName} for ${controller}`);

  const battlefield = state.battlefield || [];
  const sourcePerm = battlefield.find((entry: any) => entry.id === sourcePermanentId);
  if (!sourcePerm) {
    debug(2, `[resolveMonstrosityAbility] Monstrosity source ${sourceName || sourcePermanentId} no longer on battlefield`);
    return;
  }
  if ((sourcePerm as any).isMonstrous === true || (sourcePerm as any).monstrous === true) {
    debug(2, `[resolveMonstrosityAbility] ${sourceName || sourcePermanentId} is already monstrous`);
    return;
  }

  const countersToAdd = Number(item?.monstrosityParams?.amount || 0);
  (sourcePerm as any).counters = (sourcePerm as any).counters || {};
  (sourcePerm as any).counters['+1/+1'] = Number((sourcePerm as any).counters['+1/+1'] || 0) + Math.max(0, countersToAdd);
  (sourcePerm as any).isMonstrous = true;
  (sourcePerm as any).monstrous = true;
  runSBA(ctx);
}

function resolveAdaptAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const sourcePermanentId = String(item?.source || '');
  debug(2, `[resolveAdaptAbility] Resolving adapt ability from ${sourceName} for ${controller}`);

  const battlefield = state.battlefield || [];
  const sourcePerm = battlefield.find((entry: any) => entry.id === sourcePermanentId);
  if (!sourcePerm) {
    debug(2, `[resolveAdaptAbility] Adapt source ${sourceName || sourcePermanentId} no longer on battlefield`);
    return;
  }

  const currentCounters = Number((sourcePerm as any)?.counters?.['+1/+1'] || 0);
  if (currentCounters > 0) {
    debug(2, `[resolveAdaptAbility] ${sourceName || sourcePermanentId} already has +1/+1 counters`);
    return;
  }

  const countersToAdd = Number(item?.adaptParams?.amount || 0);
  (sourcePerm as any).counters = (sourcePerm as any).counters || {};
  (sourcePerm as any).counters['+1/+1'] = currentCounters + Math.max(0, countersToAdd);
  runSBA(ctx);
}

function resolveEquipAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const equipParams = item?.equipParams || {};
  const { equipmentId, targetCreatureId, equipmentName, targetCreatureName } = equipParams;
  debug(2, `[resolveEquipAbility] Resolving equip ability from ${sourceName} for ${controller}`);

  if (!equipmentId || !targetCreatureId) {
    debugWarn(2, `[resolveEquipAbility] Equip ability missing parameters`);
    return;
  }

  attachEquipmentToCreature(ctx, state, controller, {
    equipmentId,
    targetCreatureId,
    sourceName,
    equipmentName,
    targetCreatureName,
  });
}

function resolveReconfigureAttachAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const reconfigureParams = item?.reconfigureParams || {};
  const { reconfigureId, targetCreatureId, reconfigureName, targetCreatureName } = reconfigureParams;
  debug(2, `[resolveReconfigureAttachAbility] Resolving reconfigure attach ability from ${sourceName} for ${controller}`);

  if (!reconfigureId || !targetCreatureId) {
    debugWarn(2, `[resolveReconfigureAttachAbility] Reconfigure attach ability missing parameters`);
    return;
  }

  const battlefield = state.battlefield || [];
  const equipment = battlefield.find((entry: any) => entry.id === reconfigureId);
  const targetCreature = battlefield.find((entry: any) => entry.id === targetCreatureId);

  if (!equipment) {
    debug(2, `[resolveReconfigureAttachAbility] Reconfigure source ${reconfigureName || reconfigureId} no longer on battlefield`);
    return;
  }
  if (!targetCreature) {
    debug(2, `[resolveReconfigureAttachAbility] Reconfigure target ${targetCreatureName || targetCreatureId} no longer on battlefield`);
    return;
  }
  if (!isCreatureNow(targetCreature)) {
    debug(2, `[resolveReconfigureAttachAbility] Reconfigure target ${targetCreatureName || targetCreatureId} is no longer a creature`);
    return;
  }

  if (equipment.attachedTo) {
    const previousTarget = battlefield.find((entry: any) => entry?.id === equipment.attachedTo);
    if (previousTarget && previousTarget.attachedEquipment) {
      previousTarget.attachedEquipment = (previousTarget.attachedEquipment as string[]).filter(
        (id: string) => id !== reconfigureId,
      );
      if (previousTarget.attachedEquipment.length === 0) {
        previousTarget.isEquipped = false;
      }
    }
  }

  equipment.attachedTo = targetCreatureId;
  if (!targetCreature.attachedEquipment) {
    targetCreature.attachedEquipment = [];
  }
  if (!targetCreature.attachedEquipment.includes(reconfigureId)) {
    targetCreature.attachedEquipment.push(reconfigureId);
  }
  targetCreature.isEquipped = true;

  try {
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId) {
      appendEvent(gameId, (state as any).seq ?? 0, 'reconfigurePermanent', {
        playerId: controller,
        reconfigureId,
        reconfigureName: reconfigureName || sourceName || 'Reconfigure permanent',
        targetCreatureId,
        targetCreatureName: targetCreatureName || targetCreature?.card?.name || 'Creature',
      });
    }
  } catch (err) {
    debugWarn(1, '[resolveReconfigureAttachAbility] appendEvent(reconfigurePermanent) failed:', err);
  }

  debug(2, `[resolveReconfigureAttachAbility] ${reconfigureName || 'Reconfigure permanent'} attached to ${targetCreatureName || 'creature'}`);
}

function resolveReconfigureUnattachAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  debug(2, `[resolveReconfigureUnattachAbility] Resolving reconfigure unattach ability from ${sourceName} for ${controller}`);

  const battlefield = state.battlefield || [];
  const sourcePermanentId = String(item?.source || '');
  const equipment = battlefield.find((entry: any) => entry.id === sourcePermanentId);
  if (!equipment) {
    debug(2, `[resolveReconfigureUnattachAbility] Reconfigure source ${sourceName || sourcePermanentId} no longer on battlefield`);
    return;
  }

  const previousTargetId = String((equipment as any).attachedTo || '').trim();
  const previousTarget = previousTargetId ? battlefield.find((entry: any) => entry?.id === previousTargetId) : null;

  if (equipment.attachedTo) {
    const attachedTarget = battlefield.find((entry: any) => entry?.id === equipment.attachedTo);
    if (attachedTarget && attachedTarget.attachedEquipment) {
      attachedTarget.attachedEquipment = (attachedTarget.attachedEquipment as string[]).filter(
        (id: string) => id !== equipment.id,
      );
      if (attachedTarget.attachedEquipment.length === 0) {
        attachedTarget.isEquipped = false;
      }
    }
  }

  try {
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId) {
      appendEvent(gameId, (state as any).seq ?? 0, 'reconfigureUnattachPermanent', {
        playerId: controller,
        reconfigureId: sourcePermanentId,
        reconfigureName: sourceName || equipment?.card?.name || 'Reconfigure permanent',
        targetCreatureId: previousTargetId || undefined,
        targetCreatureName: previousTarget?.card?.name || undefined,
      });
    }
  } catch (err) {
    debugWarn(1, '[resolveReconfigureUnattachAbility] appendEvent(reconfigureUnattachPermanent) failed:', err);
  }

  delete equipment.attachedTo;
  debug(2, `[resolveReconfigureUnattachAbility] ${sourceName || 'Reconfigure permanent'} became unattached`);
}

function resolveFortifyAbility(ctx: GameContext, item: any, controller: PlayerID): void {
  const state = (ctx as any).state;
  const sourceName = item?.sourceName || 'Unknown';
  const fortifyParams = item?.fortifyParams || {};
  const { fortificationId, targetLandId, fortificationName, targetLandName } = fortifyParams;
  debug(2, `[resolveFortifyAbility] Resolving fortify ability from ${sourceName} for ${controller}`);

  if (!fortificationId || !targetLandId) {
    debugWarn(2, `[resolveFortifyAbility] Fortify ability missing parameters`);
    return;
  }

  const battlefield = state.battlefield || [];
  const fortification = battlefield.find((entry: any) => entry.id === fortificationId);
  const targetLand = battlefield.find((entry: any) => entry.id === targetLandId);

  if (!fortification) {
    debug(2, `[resolveFortifyAbility] Fortification ${fortificationName || fortificationId} no longer on battlefield`);
    return;
  }
  if (!targetLand) {
    debug(2, `[resolveFortifyAbility] Target land ${targetLandName || targetLandId} no longer on battlefield`);
    return;
  }

  const targetTypeLine = (targetLand.card?.type_line || '').toLowerCase();
  if (!targetTypeLine.includes('land')) {
    debug(2, `[resolveFortifyAbility] Target ${targetLandName || targetLandId} is no longer a land`);
    return;
  }

  if (fortification.attachedTo) {
    const previousTarget = battlefield.find((entry: any) => entry?.id === fortification.attachedTo);
    if (previousTarget && previousTarget.attachedEquipment) {
      previousTarget.attachedEquipment = (previousTarget.attachedEquipment as string[]).filter(
        (id: string) => id !== fortificationId,
      );
      if (previousTarget.attachedEquipment.length === 0) {
        previousTarget.isEquipped = false;
      }
    }
  }

  fortification.attachedTo = targetLandId;
  if (!targetLand.attachedEquipment) {
    targetLand.attachedEquipment = [];
  }
  if (!targetLand.attachedEquipment.includes(fortificationId)) {
    targetLand.attachedEquipment.push(fortificationId);
  }

  try {
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId) {
      appendEvent(gameId, (state as any).seq ?? 0, 'fortifyPermanent', {
        playerId: controller,
        fortificationId,
        fortificationName: fortificationName || sourceName || 'Fortification',
        targetLandId,
        targetLandName: targetLandName || targetLand?.card?.name || 'Land',
      });
    }
  } catch (err) {
    debugWarn(1, '[resolveFortifyAbility] appendEvent(fortifyPermanent) failed:', err);
  }

  debug(2, `[resolveFortifyAbility] ${fortificationName || 'Fortification'} fortified ${targetLandName || 'land'}`);
}

export function tryResolveStackActivatedAbilityMidHandlers(
  ctx: GameContext,
  options: StackActivatedAbilityHandlerContext,
): boolean {
  const { item, controller } = options;
  if (item?.type !== 'ability') return false;

  const abilityType = item?.abilityType;
  if (abilityType === 'creature-upgrade') {
    resolveCreatureUpgradeAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'fight') {
    resolveFightAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'level_up') {
    resolveLevelUpAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'outlast') {
    resolveOutlastAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'monstrosity') {
    resolveMonstrosityAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'adapt') {
    resolveAdaptAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'equip') {
    resolveEquipAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'reconfigure_attach') {
    resolveReconfigureAttachAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'reconfigure_unattach') {
    resolveReconfigureUnattachAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }
  if (abilityType === 'fortify') {
    resolveFortifyAbility(ctx, item, controller);
    ctx.bumpSeq();
    return true;
  }

  return false;
}

