import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyDamageToPermanentWithCounterEffects } from './counter-common-effects.js';
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from './triggers/damage-received.js';
import { debug } from '../../utils/debug.js';
import {
  applyTriggerOpponentDamageFromPermanent,
  modifyTriggerEffectLife,
  queueDealsDamageToPlayerTriggersFromPermanent,
} from './triggerLifeDamageUtils.js';

export function applyRetiredTriggerLegacyTargetLifeAndDamageBatch(params: {
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
  const {
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
    opponents,
    players,
    battlefield,
  } = params;

  const targetLosesMatch = desc.match(/target (?:player|opponent) loses (\d+) life/i);
  if (targetLosesMatch && !desc.includes('you gain')) {
    const loseAmount = parseInt(targetLosesMatch[1], 10);
    const targets = triggerItem.targets || [];
    const targetPlayer = targets[0] || (opponents[0]?.id);

    if (targetPlayer) {
      modifyTriggerEffectLife(state, targetPlayer, -loseAmount);
    }
    return true;
  }

  const thatPlayerLosesMatch = desc.match(/that player loses (\d+) life/i);
  if (thatPlayerLosesMatch) {
    const loseAmount = parseInt(thatPlayerLosesMatch[1], 10);
    const thatPlayer =
      String(
        triggerItem?.triggeringPlayer ||
          triggerItem?.targetPlayer ||
          triggerItem?.defendingPlayer ||
          triggerItem?.targets?.[0] ||
          ''
      ) || null;
    if (thatPlayer) {
      modifyTriggerEffectLife(state, thatPlayer, -loseAmount);
    }
    return true;
  }

  const singleYouLoseLifeMatch = desc.match(/you lose (\d+) life/i);
  if (singleYouLoseLifeMatch && !desc.includes('draw')) {
    const amount = parseInt(singleYouLoseLifeMatch[1], 10);
    modifyTriggerEffectLife(state, controller, -amount);
    return true;
  }

  const dealsTargetDamageMatch = desc.match(/deals? (\d+) damage to (?:target|any target|that creature|it)/i);
  if (!dealsTargetDamageMatch) {
    return false;
  }

  const damage = parseInt(dealsTargetDamageMatch[1], 10);
  const targets = triggerItem.targets || [];

  if (targets.length === 0) {
    return true;
  }

  const targetId = targets[0];
  const targetPlayer = players.find((p: any) => p.id === targetId);
  if (targetPlayer) {
    const sourcePermanentId = String((triggerItem as any)?.source || (triggerItem as any)?.permanentId || '');
    const actualDamage = applyTriggerOpponentDamageFromPermanent(
      ctx,
      controller,
      state,
      battlefield,
      String(targetId),
      damage,
      sourcePermanentId || undefined,
    );

    try {
      if (sourcePermanentId && actualDamage > 0) {
        queueDealsDamageToPlayerTriggersFromPermanent(ctx, sourcePermanentId, String(targetId), actualDamage);

        try {
          const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
          const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
          if (sourcePerm && sourceTL.includes('creature')) {
            const creatureName = String(sourcePerm?.card?.name || 'Unknown Creature');
            (state as any).creaturesThatDealtDamageToPlayer = (state as any).creaturesThatDealtDamageToPlayer || {};
            const perPlayer = ((state as any).creaturesThatDealtDamageToPlayer[String(targetId)] =
              (state as any).creaturesThatDealtDamageToPlayer[String(targetId)] || {});
            perPlayer[String(sourcePermanentId)] = {
              creatureName,
              totalDamage: (perPlayer[String(sourcePermanentId)]?.totalDamage || 0) + actualDamage,
              lastDamageTime: Date.now(),
            };
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return true;
  }

  const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targetId);
  if (!targetPerm) {
    return true;
  }

  const damageResult = applyDamageToPermanentWithCounterEffects(targetPerm, damage, 'damageMarked');
  if (damageResult.prevented) {
    return true;
  }

  targetPerm.damageThisTurn = (targetPerm.damageThisTurn || 0) + damage;
  targetPerm.tookDamageThisTurn = true;

  try {
    const sourcePermanentId = String((triggerItem as any)?.source || (triggerItem as any)?.permanentId || '');
    if (sourcePermanentId) {
      const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
      const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
      const targetTL = String(targetPerm?.card?.type_line || '').toLowerCase();
      if (sourcePerm && sourceTL.includes('creature') && targetTL.includes('creature')) {
        const stateAny = state as any;
        stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
        stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] =
          stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] || {};
        stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId][String(targetId)] = true;
      }
    }
  } catch {
    /* ignore */
  }

  try {
    dispatchDamageReceivedTrigger(ctx, targetPerm, damage, sourceName);
    processDamageReceivedTriggers(ctx, targetPerm, damage);
  } catch (err) {
    debug(2, `[executeTriggerEffect] damage-received trigger processing failed:`, err);
  }

  return true;
}
