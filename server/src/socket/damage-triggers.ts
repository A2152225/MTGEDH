import type { Server } from 'socket.io';
import type { InMemoryGame } from '../state/types';
import { broadcastGame } from './util';
import { ResolutionQueueManager, ResolutionStepType } from '../state/resolution/index.js';
import { debug, debugWarn } from '../utils/debug.js';

/**
 * Emit any queued damage-received triggers to the appropriate controllers.
 *
 * These triggers are queued into `game.state.pendingDamageTriggers` by state modules
 * (combat damage, fight, spell damage, etc) and are emitted after priority handling.
 *
 * Returns the number of trigger prompts emitted.
 */
export function emitPendingDamageTriggers(
  io: Server,
  game: InMemoryGame,
  gameId: string
): number {
  const pendingTriggers = (game.state as any).pendingDamageTriggers;
  if (!pendingTriggers || typeof pendingTriggers !== 'object') return 0;

  const triggerIds = Object.keys(pendingTriggers);
  if (triggerIds.length === 0) return 0;

  let emitted = 0;

  const players = Array.isArray((game.state as any).players) ? (game.state as any).players : [];
  const battlefield = Array.isArray((game.state as any).battlefield) ? (game.state as any).battlefield : [];
  const life = ((game.state as any).life = (game.state as any).life || {});
  const startingLife = Number((game.state as any).startingLife ?? 40);

  for (const triggerId of triggerIds) {
    const trigger = pendingTriggers[triggerId];
    if (!trigger) continue;

    const { sourceId, sourceName, controller, damageAmount, targetType, targetRestriction } = trigger;

    // Clean up the pending entry immediately to avoid double-enqueue
    delete pendingTriggers[triggerId];

    const sourcePerm = battlefield.find((p: any) => p?.id === sourceId);
    const imageUrl = sourcePerm?.card?.image_uris?.small || sourcePerm?.card?.image_uris?.normal;

    // Some triggers do not require target selection (e.g., "each opponent")
    if (String(targetType) === 'each_opponent') {
      const controllerId = String(controller || '');
      const dmg = Number(damageAmount || 0);
      if (controllerId && dmg > 0) {
        const sourceTypeLineLower = String(sourcePerm?.card?.type_line || '').toLowerCase();
        const isSourceCreature = sourceTypeLineLower.includes('creature');
        for (const p of players) {
          if (!p?.id) continue;
          if (String(p.id) === controllerId) continue;
          const currentLife = Number((life as any)[p.id] ?? startingLife);
          (life as any)[p.id] = currentLife - dmg;

          // Track per-turn damage/life-loss for intervening-if and other rules.
          try {
            (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
            (game.state as any).damageTakenThisTurnByPlayer[String(p.id)] =
              ((game.state as any).damageTakenThisTurnByPlayer[String(p.id)] || 0) + dmg;

            (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
            (game.state as any).lifeLostThisTurn[String(p.id)] = ((game.state as any).lifeLostThisTurn[String(p.id)] || 0) + dmg;

            if (isSourceCreature && sourceId) {
              (game.state as any).creaturesThatDealtDamageToPlayer = (game.state as any).creaturesThatDealtDamageToPlayer || {};
              const perPlayer = (((game.state as any).creaturesThatDealtDamageToPlayer[String(p.id)] =
                (game.state as any).creaturesThatDealtDamageToPlayer[String(p.id)] || {}) as any);

              perPlayer[String(sourceId)] = {
                creatureName: String(sourceName || sourcePerm?.card?.name || sourceId),
                totalDamage: (perPlayer[String(sourceId)]?.totalDamage || 0) + dmg,
                lastDamageTime: Date.now(),
              };
            }
          } catch {}
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName} dealt ${dmg} damage to each opponent.`,
          ts: Date.now(),
        });

        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        else if (typeof (game as any).bumpSeq === 'undefined' && typeof (game as any).seq !== 'undefined') {
          // no-op; seq bump handled elsewhere
        }
        broadcastGame(io, game, gameId);
      }

      emitted++;
      continue;
    }

    const controllerId = String(controller || '');
    if (!controllerId) continue;

    const targetTypeStr = String(targetType || 'any');
    const targetRestrictionStr = String(targetRestriction || '');

    const validTargets: any[] = [];
    const addPlayerTargets = (predicate: (p: any) => boolean) => {
      for (const p of players) {
        if (!p?.id) continue;
        if (!predicate(p)) continue;
        validTargets.push({
          id: String(p.id),
          label: String(p.name || p.id),
          description: 'player',
        });
      }
    };

    const addPermanentTargets = (predicate: (perm: any, typeLineLower: string) => boolean) => {
      for (const perm of battlefield) {
        if (!perm?.id || !perm?.card) continue;
        const typeLine = String(perm.card?.type_line || 'permanent');
        const typeLineLower = typeLine.toLowerCase();
        if (!predicate(perm, typeLineLower)) continue;
        validTargets.push({
          id: String(perm.id),
          label: String(perm.card?.name || 'Permanent'),
          description: typeLine,
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        });
      }
    };

    let targetDescription = 'any target';
    let targetTypes: string[] = ['any_target'];

    if (targetTypeStr === 'opponent') {
      targetDescription = 'target opponent';
      targetTypes = ['player'];
      addPlayerTargets(p => String(p.id) !== controllerId);
    } else if (targetTypeStr === 'controller') {
      targetDescription = 'you';
      targetTypes = ['player'];
      addPlayerTargets(p => String(p.id) === controllerId);
    } else if (targetTypeStr === 'any_non_dragon') {
      targetDescription = "any target that isn't a Dragon";
      targetTypes = ['any_target'];
      addPlayerTargets(_p => true);
      addPermanentTargets((_perm, typeLineLower) => {
        const isTargetKind = typeLineLower.includes('creature') || typeLineLower.includes('planeswalker');
        if (!isTargetKind) return false;
        return !typeLineLower.includes('dragon');
      });
    } else {
      // Default: any target (players + creature/planeswalker permanents)
      targetDescription = 'any target';
      targetTypes = ['any_target'];
      addPlayerTargets(_p => true);
      addPermanentTargets((_perm, typeLineLower) => typeLineLower.includes('creature') || typeLineLower.includes('planeswalker'));
    }

    if (validTargets.length === 0) {
      debugWarn(1, `[emitPendingDamageTriggers] No valid targets for damage trigger ${triggerId} (${sourceName})`);
      continue;
    }

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controllerId as any,
      sourceId: String(sourceId || ''),
      sourceName: String(sourceName || 'Damage Trigger'),
      sourceImage: imageUrl,
      description: `${sourceName} was dealt ${Number(damageAmount || 0)} damage. Choose a target to deal ${Number(damageAmount || 0)} damage to${targetRestrictionStr ? ` (${targetRestrictionStr})` : ''}.`,
      mandatory: true,
      validTargets,
      targetTypes,
      minTargets: 1,
      maxTargets: 1,
      targetDescription,
      damageReceivedTrigger: true,
      damageTrigger: {
        triggerId: String(triggerId),
        sourceId: String(sourceId || ''),
        sourceName: String(sourceName || ''),
        controller: controllerId,
        damageAmount: Number(damageAmount || 0),
        triggerType: 'dealt_damage',
        targetType: targetTypeStr,
        targetRestriction: targetRestrictionStr,
      },
    } as any);

    emitted++;
    debug(2, `[emitPendingDamageTriggers] Enqueued damage trigger for ${sourceName} (${damageAmount} damage) to ${controllerId}`);

  }

  // Clean up container if empty
  if (Object.keys(pendingTriggers).length === 0) {
    delete (game.state as any).pendingDamageTriggers;
  }

  return emitted;
}
