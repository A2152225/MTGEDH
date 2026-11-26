/**
 * Graveyard-resident creature-entry triggers ("whenever a creature enters, return this card from
 * your graveyard..."). Re-exported from triggerEtbPermanentEffects.ts.
 */
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { reactToCausedTrigger } from './triggers/round67GameTriggers.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import { buildInterveningIfSubjectSnapshot } from './triggerSourceUtils.js';
import { persistTriggeredAbilityPush } from './triggerEtbEntryEffects.js';

export function queueGraveyardResidentCreatureEntryTriggers(
  ctx: GameContext,
  enteringPermanent: any,
  enteringController: PlayerID,
  enteringIsCreature: boolean,
): void {
  if (!enteringIsCreature || (ctx as any).isReplaying) return;

  const state = (ctx as any).state;
  const zones = state?.zones || {};
  const enteredFrom = String(
    enteringPermanent?.enteredFromZone ??
    enteringPermanent?.card?.enteredFromZone ??
    ''
  ).toLowerCase();
  const castFrom = String(
    enteringPermanent?.castSourceZone ??
    enteringPermanent?.card?.castSourceZone ??
    enteringPermanent?.source ??
    enteringPermanent?.card?.source ??
    ''
  ).toLowerCase();
  if (enteredFrom !== 'graveyard' && castFrom !== 'graveyard') {
    return;
  }

  const pendingGraveyardResidentTriggers: any[] = [];

  for (const [zoneOwnerId, playerZones] of Object.entries(zones as Record<string, any>)) {
    const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
    for (const card of graveyard) {
      const oracle = String(card?.oracle_text || '').replace(/[’]/g, "'");
      if (!oracle) continue;

      const effectMatch = oracle.match(
        /whenever\s+a\s+creature(\s+you\s+control)?\s+enters(?:\s+the\s+battlefield)?,?\s*(if\s+it\s+entered\s+from\s+your\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+your\s+graveyard,\s*return\s+(?:this\s+card|~|[^.]+?)\s+from\s+your\s+graveyard\s+to\s+the\s+battlefield\s+tapped\s+at\s+the\s+beginning\s+of\s+the\s+next\s+end\s+step)\.?/i
      );
      if (!effectMatch) continue;

      const requiresController = Boolean(effectMatch[1]);
      if (requiresController && String(enteringController) !== String(zoneOwnerId)) {
        continue;
      }

      const effectText = String(effectMatch[2] || '').trim();
      try {
        const fullText = `Whenever a creature${requiresController ? ' you control' : ''} enters the battlefield, ${effectText}`;
        const satisfied = isInterveningIfSatisfied(ctx as any, String(zoneOwnerId), fullText, enteringPermanent);
        if (satisfied === false) {
          continue;
        }
      } catch (err) {
        reportHookFailure('intervening-if.eval.generic', err, { source: 'triggerEtbPermanentEffects' });
        // Keep the trigger if the generic evaluator cannot decide.
      }

      const triggerId = uid('trigger');
      const stackItem = {
        id: triggerId,
        type: 'triggered_ability',
        controller: String(zoneOwnerId),
        source: String(card?.id || triggerId),
        permanentId: String(card?.id || triggerId),
        sourceName: String(card?.name || 'Graveyard trigger'),
        description: effectText,
        effect: effectText,
        triggerType: 'creature_etb',
        mandatory: true,
        card: { ...(card as any) },
        targetZone: 'graveyard',
        targetDestination: 'battlefield',
        targetGraveyardScope: 'your',
        destinationUsesSelectedCardOwner: true,
        battlefieldControllerMode: 'owner',
        battlefieldTapped: true,
        delayedReturnAt: 'next_end_step',
        boundGraveyardCardId: String(card?.id || ''),
        boundGraveyardOwnerId: String(zoneOwnerId),
        interveningIfSubjectPermanentId: enteringPermanent?.id,
        interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(enteringPermanent),
      } as any;

      pendingGraveyardResidentTriggers.push(stackItem);
      debug(2, `[triggerETBEffectsForPermanent] ${stackItem.sourceName} triggered from graveyard: ${effectText}`);
    }
  }

  state.stack = state.stack || [];
  const orderedGraveyardResidentTriggers = orderTriggersByAPNAP(
    ctx as any,
    pendingGraveyardResidentTriggers.map((stackItem, originalIndex) => ({
      controllerId: String(stackItem?.controller || ''),
      originalIndex,
      stackItem,
    })),
  ).map((entry: any) => entry.stackItem);

  for (const stackItem of orderedGraveyardResidentTriggers) {
    state.stack.push(stackItem);
    persistTriggeredAbilityPush(ctx, stackItem);
    try { reactToCausedTrigger(ctx, stackItem, { event: 'etb', permanent: enteringPermanent }); } catch { /* best-effort */ }
  }
}
