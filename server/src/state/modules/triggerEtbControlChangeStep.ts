/**
 * Entering-permanent control change prompt (enters under / may give an opponent control).
 * Used by triggerETBEffectsForPermanent (triggerEtbPermanentEffects.ts).
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';

/** Pending control change effects (Vislor Turlough, Xantcha, Akroan Horse): queue the opponent choice once. */
export function queuePendingEntryControlChangeStep(
  ctx: GameContext,
  state: any,
  permanent: any,
  controller: PlayerID,
): void {
  if ((permanent as any).pendingControlChange) {
    const controlChangeInfo = (permanent as any).pendingControlChange;
    if (permanent.chosenPlayer || (permanent as any).asEntersControlChangeQueued) {
      delete (permanent as any).pendingControlChange;
    } else {
    debug(2, `[triggerETBEffectsForPermanent] ${permanent.card?.name} has pending control change: ${controlChangeInfo.type}`);
    
    // Queue a resolution step for the control change
    const gameId = (ctx as any).gameId || 'unknown';
    
    if (
      controlChangeInfo.type === 'may_give_opponent' ||
      controlChangeInfo.type === 'enters_under_opponent_control' ||
      controlChangeInfo.type === 'opponent_gains'
    ) {
      const isOptional = controlChangeInfo.type === 'may_give_opponent';
      const alreadyQueued = ResolutionQueueManager.getQueue(gameId).steps.some(
        (step: any) => step?.type === ResolutionStepType.PLAYER_CHOICE && String(step?.permanentId || '') === String(permanent.id),
      );
      if (alreadyQueued) {
        debug(2, `[triggerETBEffectsForPermanent] Skipping duplicate control change step for ${permanent.card?.name}`);
      } else {
      const validOpponents = Array.isArray(state.players)
        ? state.players
            .filter((player: any) => player && String(player.id || '') !== String(controller) && !player.hasLost)
            .map((player: any) => ({
              id: String(player.id || ''),
              name: String(player.name || player.id || ''),
              life: Number(state?.life?.[player.id] ?? player.life ?? 40),
              libraryCount: Number((state?.zones?.[player.id] as any)?.libraryCount ?? 0),
              isOpponent: true,
              isSelf: false,
            }))
            .filter((player: any) => player.id)
        : [];
      
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: controller,
        description: isOptional 
          ? `${permanent.card?.name}: You may have an opponent gain control of it`
          : `${permanent.card?.name}: Choose an opponent to control this permanent`,
        mandatory: !isOptional,
        sourceId: permanent.id,
        sourceName: permanent.card?.name,
        permanentId: permanent.id,
        sourceImage: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
        promptTitle: isOptional ? "Control Change (Optional)" : "Choose Opponent",
        promptDescription: isOptional
          ? `Do you want to give control of ${permanent.card?.name} to an opponent? If you do, it will be goaded.`
          : `Choose which opponent will control ${permanent.card?.name}.`,
        options: [], // Will be filled with opponent list by the resolution handler
        opponentOnly: true,
        players: validOpponents,
        controlChangeData: {
          permanentId: permanent.id,
          isOptional,
          goadsOnChange: controlChangeInfo.goadsOnChange || false,
          mustAttackEachCombat: controlChangeInfo.mustAttackEachCombat || false,
          cantAttackOwner: controlChangeInfo.cantAttackOwner || false,
        },
      });
      debug(2, `[triggerETBEffectsForPermanent] Queued control change step for ${permanent.card?.name} (optional: ${isOptional})`);
      }
    }
    }
  }
}
