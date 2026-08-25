// server/src/state/modules/turn-handlers/turnStepPushTriggers.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the nested pushTriggersToStack helper inside nextStep()
// (APNAP grouping, intervening-if skip, TRIGGER_ORDER queue, stack push).
// Public entry symbols: pushTurnStepTriggersToStack.
// nextStep remains the dispatcher and keeps a thin wrapper. Leaf must not
// import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { isInterveningIfSatisfied } from "../triggers/intervening-if.js";
import { pushTriggerDoublerCopies } from "../triggers/combat.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { persistTurnStepTriggeredAbility, persistTurnStepTriggerOrderStep } from "./turnStepTriggerPersist.js";
import { debug, debugError } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Put simultaneous step/phase triggers on the stack with APNAP ordering.
 * Called from nextStep via a thin wrapper that closes over turnPlayer and
 * the replay persist flag.
 */
export function pushTurnStepTriggersToStack(
  ctx: GameContext,
  turnPlayer: string,
  usePersistedTurnStepTriggers: boolean,
  triggers: any[],
  triggerType: string,
  idPrefix: string,
): void {
          if (triggers.length === 0) return;

          if (usePersistedTurnStepTriggers) {
            debug(2, `${ts()} [nextStep] Replay mode using persisted ${triggerType} trigger pushes; skipping live stack mutation`);
            return;
          }
          
          debug(2, `${ts()} [nextStep] Found ${triggers.length} ${triggerType} trigger(s)`);
          
          // Group by controller for proper APNAP ordering (Rule 101.4)
          const triggersByController = new Map<string, typeof triggers>();
          for (const trigger of triggers) {
            const battlefield = (ctx as any).state?.battlefield || [];
            const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
            const controller = String(
              trigger.controllerId ||
              trigger.stackItem?.controller ||
              sourcePerm?.controller ||
              turnPlayer ||
              ''
            ).trim();

            // Intervening-if (Rule 603.4): if the condition is recognized and false at trigger time,
            // the ability does not trigger and must not be put on the stack.
            // If unrecognized, keep it (conservative fallback).
            try {
              const raw = String(trigger.description || trigger.effect || '').trim();
              let textForEval = raw;
              const hasTriggerPrefix = /^(?:when|whenever|at)\b/i.test(textForEval);
              if (!hasTriggerPrefix) {
                // Many step/phase detectors store only the post-comma fragment.
                // Wrap with a trigger header so intervening-if extraction can run.
                switch (triggerType) {
                  case 'upkeep':
                    textForEval = `At the beginning of upkeep, ${textForEval}`;
                    break;
                  case 'draw_step':
                    textForEval = `At the beginning of draw step, ${textForEval}`;
                    break;
                  case 'precombat_main':
                    textForEval = `At the beginning of your precombat main phase, ${textForEval}`;
                    break;
                  case 'saga_chapter':
                  case 'saga_lore_counter':
                    textForEval = `At the beginning of your precombat main phase, ${textForEval}`;
                    break;
                  case 'postcombat_main':
                    textForEval = `At the beginning of your postcombat main phase, ${textForEval}`;
                    break;
                  case 'begin_combat':
                    textForEval = `At the beginning of combat, ${textForEval}`;
                    break;
                  case 'end_combat':
                    textForEval = `At end of combat, ${textForEval}`;
                    break;
                  case 'end_step':
                    textForEval = `At the beginning of end step, ${textForEval}`;
                    break;
                }
              }

              const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
              const ok = isInterveningIfSatisfied(
                ctx as any,
                String(controller),
                textForEval,
                sourcePerm,
                needsThatPlayerRef
                  ? {
                      thatPlayerId: String(turnPlayer),
                      referencedPlayerId: String(turnPlayer),
                      theirPlayerId: String(turnPlayer),
                    }
                  : undefined
              );
              if (ok === false) {
                debug(2, `${ts()} [nextStep] Skipping ${triggerType} trigger due to unmet intervening-if: ${trigger.cardName} - ${raw}`);
                continue;
              }
            } catch {
              // Keep trigger on any evaluation error.
            }

            const existing = triggersByController.get(controller) || [];
            existing.push(trigger);
            triggersByController.set(controller, existing);
          }
          
          // Get player order for APNAP
          const players = Array.isArray((ctx as any).state.players) 
            ? (ctx as any).state.players.map((p: any) => p.id) 
            : [];
          const activePlayerId = String((ctx as any).state?.activePlayer || turnPlayer || '').trim();
          const activeIndex = players.indexOf(activePlayerId);
          const orderedPlayers = activeIndex >= 0
            ? [...players.slice(activeIndex), ...players.slice(0, activeIndex)]
            : [turnPlayer, ...players.filter((p: string) => p !== turnPlayer)];
          
          // Process triggers in APNAP order (active player's triggers first)
          for (const playerId of orderedPlayers) {
            const playerTriggers = triggersByController.get(playerId) || [];
            
            if (playerTriggers.length === 0) {
              continue;
            }
            
            // If player has multiple triggers, require an explicit ordering via Resolution Queue
            // (TRIGGER_ORDER) before continuing.
            if (playerTriggers.length > 1) {
              debug(2, `${ts()} [nextStep] Player ${playerId} has ${playerTriggers.length} triggers to order`);
              
              // Get gameId from context for Resolution Queue
              const gameId = (ctx as any).gameId || (ctx as any).id;
              
              if (gameId) {
                // Use Resolution Queue for trigger ordering
                const triggerItems = playerTriggers.map((trigger: any) => {
                  const triggerId = `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  return {
                    id: triggerId,
                    sourceId: trigger.permanentId,
                    sourceName: trigger.cardName,
                    effect: trigger.description || trigger.effect,
                    triggerType,
                    mandatory: trigger.mandatory !== false,
                    imageUrl: trigger.imageUrl,
                    requiresChoice: trigger.requiresChoice,
                    modalOptions: Array.isArray(trigger.modalOptions) ? trigger.modalOptions : undefined,
                    stackItem: trigger.stackItem,
                  };
                });
                
                // Add all triggers to the stack first (they will be reordered by the player)
                for (const item of triggerItems) {
                  const extra = item.stackItem && typeof item.stackItem === 'object' ? item.stackItem : {};
                  const stackItem = {
                    ...extra,
                    id: item.id,
                    type: 'triggered_ability',
                    controller: playerId,
                    source: item.sourceId,
                    sourceName: item.sourceName,
                    description: item.effect,
                    triggerType,
                    mandatory: item.mandatory,
                    effect: item.effect,
                    requiresChoice: item.requiresChoice,
                    ...(Array.isArray(item.modalOptions) ? { modalOptions: item.modalOptions } : null),
                    triggeringPlayer: turnPlayer,
                  };
                  (ctx as any).state.stack.push(stackItem);
                  pushTriggerDoublerCopies((ctx as any).state, stackItem);
                  persistTurnStepTriggeredAbility(ctx, stackItem, `${triggerType} nextStep`);
                }
                
                // Add Resolution Queue step for trigger ordering
                const triggerOrderStep = ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.TRIGGER_ORDER,
                  playerId: playerId as PlayerID,
                  description: `Choose the order to put ${triggerItems.length} triggered abilities on the stack`,
                  mandatory: true,
                  triggers: triggerItems.map((item: any) => ({
                    id: item.id,
                    sourceName: item.sourceName,
                    effect: item.effect,
                    imageUrl: item.imageUrl,
                  })),
                  requireAll: true, // Player must order all triggers
                });
                persistTurnStepTriggerOrderStep(ctx, triggerOrderStep, `${triggerType} nextStep`);
                
                debug(2, `${ts()} [nextStep] Added TRIGGER_ORDER step for ${playerId} with ${triggerItems.length} triggers`);
              } else {
                debugError(1, `${ts()} [nextStep] Cannot create trigger ordering without gameId`);
              }
            } else {
              // Single trigger - push directly to stack (no ordering needed)
              const trigger = playerTriggers[0];
              const triggerId = `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const extra = trigger.stackItem && typeof trigger.stackItem === 'object' ? trigger.stackItem : {};
              const stackItem = {
                ...extra,
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: trigger.permanentId,
                sourceName: trigger.cardName,
                description: trigger.description || trigger.effect,
                triggerType,
                mandatory: trigger.mandatory !== false,
                effect: trigger.effect,
                requiresChoice: trigger.requiresChoice,  // Preserve modal choice flag
                ...(Array.isArray(trigger.modalOptions) ? { modalOptions: trigger.modalOptions } : null),
                triggeringPlayer: turnPlayer,
              };
              (ctx as any).state.stack.push(stackItem);
              pushTriggerDoublerCopies((ctx as any).state, stackItem);
              persistTurnStepTriggeredAbility(ctx, stackItem, `${triggerType} nextStep`);
              debug(2, `${ts()} [nextStep] ⚡ Pushed ${triggerType} trigger: ${trigger.cardName} - ${trigger.description || trigger.effect}${trigger.requiresChoice ? ' (modal)' : ''}`);
            }
          }
}
