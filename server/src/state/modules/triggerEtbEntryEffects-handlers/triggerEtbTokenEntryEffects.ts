/**
 * Extracted from triggerEtbEntryEffects.ts: token battlefield-entry ETB effects.
 * Cluster moved: triggerETBEffectsForToken.
 * Public: triggerETBEffectsForToken
 *
 * Leaf must not import triggerEtbEntryEffects.ts or triggerEtbEntryEffects-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { debug } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { getETBTriggersForPermanent } from '../triggered-abilities.js';
import { isInterveningIfSatisfied } from '../triggers/intervening-if.js';
import { orderTriggersByAPNAP } from '../triggers/ordering.js';
import { stampPermanentControlEntryForEcho } from '../upkeep-triggers.js';
import {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
} from '../triggerSourceUtils.js';
import { pushTriggerDoublerCopies } from '../triggers/combat.js';
import { persistTriggeredAbilityPush } from './triggerEtbPersistTriggeredAbility.js';
import { recordBattlefieldEntryTurnTracking } from './triggerEtbBattlefieldEntryTracking.js';
import { queueTemporaryEtbTriggersForEntry } from './triggerEtbTemporaryEntryTriggers.js';
import {
  matchesRequiredTypePhrase,
  shouldQueueChosenTypeCreatureEtbTrigger,
  tryBuildTypedPermanentEtbStackItem,
} from './triggerEtbTypedPermanentMatch.js';

export function triggerETBEffectsForToken(
  ctx: GameContext,
  token: any,
  controller: PlayerID
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;

  stampPermanentControlEntryForEcho(state, token, String(controller));
  
  const typeLineLower = String(token.card?.type_line || '').toLowerCase();
  const isCreature = typeLineLower.includes('creature');
  const isEnchantment = typeLineLower.includes('enchantment');
  const isToken = true; // By definition, this is a token

  // Track "entered this turn" counters for intervening-if templates.
  // (Tokens can matter here: e.g. Treasures for artifact ETBs.)
  recordBattlefieldEntryTurnTracking(state, controller, token);
  const pendingExternalEtbTriggers: any[] = [];
  
  // Check all other permanents for triggers that fire when creatures/permanents enter
  for (const perm of state.battlefield) {
    if (!perm || perm.id === token.id) continue;
    
    const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      if (trigger.triggerType === 'creature_etb' && isCreature) {
        // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
        if ((trigger as any).nontokenOnly && isToken) {
          continue; // Skip - this trigger only fires for nontoken creatures
        }

        // Check if this trigger requires token creatures.
        if ((trigger as any).tokenOnly && !isToken) {
          continue;
        }
        
        // Check if this trigger requires the entering creature to be controlled by the trigger's controller
        // (e.g., Aura Shards: "Whenever a creature you control enters")
        if ((trigger as any).controlledOnly) {
          const triggerController = perm.controller || controller;
          if (controller !== triggerController) {
            continue; // Skip - entering creature is not controlled by trigger's controller
          }
        }
        
        // Check if this trigger requires a specific type phrase (e.g., "token creature", "artifact creature", "Bear").
        const requiredTypeRaw = typeof (trigger as any).requiredTypePhrase === 'string' ? String((trigger as any).requiredTypePhrase) : '';
        const requiredType = requiredTypeRaw.replace(/\bcreatures\b/gi, 'creature').replace(/\bartifacts\b/gi, 'artifact').trim();
        if (requiredType) {
          const enteringTypeLine = String(token.card?.type_line || '');
          if (!matchesRequiredTypePhrase(enteringTypeLine, requiredType, isToken)) {
            continue;
          }
        }
        
        // Determine trigger controller
        const triggerController = perm.controller || controller;

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        // These ETB triggers come from OTHER permanents (not the entering token), so we must filter here.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            const controlledOnly = !!(trigger as any).controlledOnly;
            textForEval = controlledOnly
              ? `Whenever a creature you control enters the battlefield, ${textForEval}`
              : `Whenever a creature enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            token,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        // Push trigger onto the stack
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }

      if (trigger.triggerType === 'chosen_type_creature_etb' && isCreature) {
        if (!shouldQueueChosenTypeCreatureEtbTrigger(trigger, perm, token, controller, isToken, isCreature)) {
          continue;
        }

        const triggerController = perm.controller || controller;
        const triggerId = uid('trigger');
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s chosen-type ETB trigger for token: ${trigger.description}`);
      }

      if (trigger.triggerType === 'chosen_type_creature_etb_or_attack' && isCreature) {
        if (!shouldQueueChosenTypeCreatureEtbTrigger(trigger, perm, token, controller, isToken, isCreature)) {
          continue;
        }

        const triggerController = perm.controller || controller;
        const triggerId = uid('trigger');
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s chosen-type enters-or-attacks trigger for token: ${trigger.description}`);
      }
      
      // another_permanent_etb triggers
      if (trigger.triggerType === 'another_permanent_etb') {
        // Check if this trigger only fires on creatures (creatureOnly flag)
        if ((trigger as any).creatureOnly && !isCreature) {
          continue; // Skip - this trigger only fires on creatures
        }
        
        const triggerController = perm.controller || controller;

                const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
                const needsThatPlayerRef = /\bthat player\b/i.test(desc);
                const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;
        
        // For another_permanent_etb, check if the entering permanent is controlled by the trigger's controller
        // This is the "under your control" restriction
        if (controller !== triggerController) {
          continue; // Skip - entering permanent is not controlled by trigger's controller
        }

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever another permanent enters the battlefield under your control, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            token,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // permanent_etb triggers (Altar of the Brood style - triggers on ANY permanent)
      if (trigger.triggerType === 'permanent_etb') {
        const triggerController = perm.controller || controller;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever a permanent enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            token,
            /\bthat player\b/i.test(textForEval) && String(controller || '')
              ? {
                  thatPlayerId: String(controller),
                  referencedPlayerId: String(controller),
                  theirPlayerId: String(controller),
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // opponent_creature_etb triggers (Suture Priest, Authority of the Consuls)
      // These trigger when a creature enters under an OPPONENT's control
      if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
        const triggerController = perm.controller;
        // Only fire if the entering creature is controlled by an opponent of the trigger controller
        if (triggerController && triggerController !== controller) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          try {
            const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
            let textForEval = desc;
            if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
              textForEval = `Whenever a creature enters the battlefield under an opponent's control, ${textForEval}`;
            }
            const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
            const satisfied = isInterveningIfSatisfied(
              ctx as any,
              String(triggerController),
              textForEval,
              token,
              needsThatPlayerRef && String(controller || '')
                ? {
                    thatPlayerId: String(controller),
                    referencedPlayerId: String(controller),
                    theirPlayerId: String(controller),
                  }
                : undefined
            );
            if (satisfied === false) {
              debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
              continue;
            }
          } catch {
            // Conservative fallback: keep the trigger if evaluation fails.
          }

          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          const stackItem = {
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: perm.id,
            permanentId: perm.id,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            effect: trigger.effect || trigger.description,
            card: perm.card,
            sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
            // Store the entering creature's controller for effects like "that player loses 1 life"
            targetPlayer: controller,
            interveningIfSubjectPermanentId: token.id,
            interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
          } as any;
          pendingExternalEtbTriggers.push(stackItem);
          
          debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
        }
      }

      const typedEtbStackItem = tryBuildTypedPermanentEtbStackItem(
        ctx,
        trigger,
        perm,
        token,
        String(controller),
      );
      if (typedEtbStackItem) {
        pendingExternalEtbTriggers.push(typedEtbStackItem);
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s typed ETB trigger for token: ${trigger.description}`);
      }
    }
  }

  state.stack = state.stack || [];
  const orderedExternalEtbTriggers = orderTriggersByAPNAP(
    ctx as any,
    pendingExternalEtbTriggers.map((stackItem, originalIndex) => ({
      controllerId: String(stackItem?.controller || ''),
      originalIndex,
      stackItem,
    })),
  ).map((entry: any) => entry.stackItem);

  for (const stackItem of orderedExternalEtbTriggers) {
    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);
    persistTriggeredAbilityPush(ctx, stackItem);
  }

  queueTemporaryEtbTriggersForEntry(ctx, token, controller, {
    isCreature,
    isEnchantment,
    isToken,
  });
}

