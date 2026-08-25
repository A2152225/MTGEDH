// server/src/state/modules/turn-handlers/turnStepUpkeep.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: the upkeep-step body from nextStep() — delayed upkeep
// dequeues, initiative venture, cumulative upkeep mana, suspend time
// counters, rebound, and "at the beginning of your upkeep" triggers.
// Public entry symbols: runTurnStepUpkeep.
// Called from nextStep() in the parent; not part of the public turn.ts API.
// Shared nextStep closures (pushTriggersToStack) are passed in so this leaf
// does not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { getUpkeepTriggersForPlayer, autoProcessCumulativeUpkeepMana, recordUpkeepBegan } from "../upkeep-triggers.js";
import { cleanupCardLeavingExile } from "../playable-from-exile.js";
import {
  dequeuePendingUpkeepGraveyardReturnTriggers,
  dequeuePendingUpkeepDrawTriggers,
} from "./pendingDelayedTriggerDequeues.js";
import { persistTurnStepTriggeredAbility } from "./turnStepTriggerPersist.js";
import { debug } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Upkeep-step turn actions from nextStep() when entering UPKEEP (Rule 503):
 * delayed upkeep dequeues, initiative venture, cumulative upkeep mana,
 * suspend, rebound, then "at the beginning of your upkeep" triggers.
 * nextStep remains the dispatcher and supplies pushTriggersToStack.
 */
export function runTurnStepUpkeep(
  ctx: GameContext,
  turnPlayer: string,
  usePersistedTurnStepTriggers: boolean,
  pushTriggersToStack: (triggers: any[], triggerType: string, idPrefix: string) => void,
): void {
          const delayedUpkeepDraws = dequeuePendingUpkeepDrawTriggers(ctx);
          const delayedUpkeepReturns = dequeuePendingUpkeepGraveyardReturnTriggers(ctx, turnPlayer);
          pushTriggersToStack([...delayedUpkeepDraws, ...delayedUpkeepReturns], 'upkeep', 'upkeep');

          const initiativeHolder = String(((ctx as any).state as any)?.initiative || '').trim();
          if (initiativeHolder && initiativeHolder === String(turnPlayer)) {
            if (!usePersistedTurnStepTriggers) {
              const initiativeTrigger = {
                id: uid('initiative_trigger'),
                type: 'triggered_ability',
                controller: turnPlayer,
                sourceName: 'The Initiative',
                description: 'Venture into Undercity.',
                effect: 'Venture into Undercity.',
                triggerType: 'upkeep',
                mandatory: true,
                initiativeVentureTrigger: true,
              };
              ((ctx as any).state as any).stack = ((ctx as any).state as any).stack || [];
              ((ctx as any).state as any).stack.push(initiativeTrigger);
              persistTurnStepTriggeredAbility(ctx, initiativeTrigger, 'initiative upkeep');
            } else {
              debug(2, `${ts()} [nextStep] Replay mode using persisted initiative upkeep trigger push`);
            }
          }

          // FIRST: Auto-process cumulative upkeep mana effects (e.g., Braid of Fire)
          // This must happen BEFORE triggers are collected, because Braid of Fire adds mana
          // as part of cumulative upkeep, not as a separate trigger
          const processedMana = autoProcessCumulativeUpkeepMana(ctx, turnPlayer);
          if (processedMana.length > 0) {
            debug(2, `${ts()} [nextStep] Auto-processed cumulative upkeep mana for ${processedMana.length} permanent(s)`);
            for (const item of processedMana) {
              const manaStr = Object.entries(item.manaAdded)
                .map(([type, amount]) => `${amount} ${type}`)
                .join(', ');
              debug(2, `${ts()} [nextStep] ${item.cardName}: Added ${manaStr} (${item.ageCounters} age counters)`);
            }
          }
          
          // SECOND: Process suspended cards - remove time counters
          const zones = (ctx as any).state.zones || {};
          const playerZone = zones[turnPlayer];
          if (playerZone && playerZone.exile) {
            const suspendedCards = playerZone.exile.filter((c: any) => c.isSuspended && c.timeCounters > 0);
            for (const card of suspendedCards) {
              card.timeCounters--;
              debug(2, `${ts()} [nextStep] Suspend: Removed time counter from ${card.name} (${card.timeCounters} remaining)`);
              
              // If last time counter was removed, cast the spell for free
              if (card.timeCounters === 0) {
                debug(2, `${ts()} [nextStep] Suspend: ${card.name} has no time counters remaining - will be cast`);

                cleanupCardLeavingExile((ctx as any).state, card);

                // Remove from exile
                const exileIdx = playerZone.exile.indexOf(card);
                if (exileIdx !== -1) {
                  playerZone.exile.splice(exileIdx, 1);
                  playerZone.exileCount = playerZone.exile.length;
                }
                
                // Cast the spell without paying its mana cost
                // Add to stack as a spell
                const stackItem = {
                  id: uid("spell"),
                  type: 'spell',
                  card: { ...card, zone: 'stack' },
                  controller: turnPlayer,
                  targets: [],
                  wasCastFromSuspend: true, // Flag to indicate this was suspended
                };
                (ctx as any).state.stack = (ctx as any).state.stack || [];
                (ctx as any).state.stack.push(stackItem);
                
                // Emit chat message
                if ((ctx as any).io && (ctx as any).gameId) {
                  (ctx as any).io.to((ctx as any).gameId).emit("chat", {
                    id: `m_${Date.now()}`,
                    gameId: (ctx as any).gameId,
                    from: "system",
                    message: `⏰ ${card.name} cast from suspend!`,
                    ts: Date.now(),
                  });
                }
                
                debug(2, `${ts()} [nextStep] Suspend: Cast ${card.name} from suspend onto the stack`);
              }
            }
          }
          
          // THIRD: Process rebound spells - "At the beginning of your next upkeep, you may cast this card from exile"
          // Check for cards in exile with reboundPending flag that were cast on a previous turn
          const currentTurn = (ctx as any).state.turnNumber || 1;
          if (playerZone && playerZone.exile) {
            const reboundCards = playerZone.exile.filter((c: any) => 
              c.reboundPending && 
              c.reboundController === turnPlayer &&
              typeof c.reboundTurn === 'number' &&  // Ensure reboundTurn is a valid number
              c.reboundTurn < currentTurn  // Only trigger on the next turn, not same turn
            );
            
            for (const card of reboundCards) {
              debug(2, `${ts()} [nextStep] Rebound: Found ${card.name} ready to cast from exile`);
              
              // Create a triggered ability for the rebound - player may cast it
              if (!usePersistedTurnStepTriggers) {
                const reboundTriggerId = uid("rebound_trigger");
                const reboundTrigger = {
                  id: reboundTriggerId,
                  type: 'triggered_ability',
                  controller: turnPlayer,
                  source: card.id,
                  sourceName: card.name,
                  description: `You may cast ${card.name} from exile without paying its mana cost.`,
                  triggerType: 'rebound',
                  mandatory: false, // "you may cast"
                  reboundCardId: card.id, // Track which card this is for
                  card: card, // Include card data for display
                };
                
                (ctx as any).state.stack = (ctx as any).state.stack || [];
                (ctx as any).state.stack.push(reboundTrigger);
                persistTurnStepTriggeredAbility(ctx, reboundTrigger, 'rebound upkeep');
              } else {
                debug(2, `${ts()} [nextStep] Replay mode using persisted rebound trigger push for ${card.name}`);
              }
              
              // Mark the card as having triggered (so it doesn't trigger again)
              // The card will be moved to graveyard when the trigger resolves (whether cast or declined)
              card.reboundTriggered = true;
              
              // Emit chat message
              if (!usePersistedTurnStepTriggers && (ctx as any).io && (ctx as any).gameId) {
                (ctx as any).io.to((ctx as any).gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId: (ctx as any).gameId,
                  from: "system",
                  message: `🔄 Rebound: ${card.name}'s rebound trigger!`,
                  ts: Date.now(),
                });
              }
              
              debug(2, `${ts()} [nextStep] Rebound: Added trigger for ${card.name} to stack`);
            }
          }

          const upkeepTriggers = getUpkeepTriggersForPlayer(ctx, turnPlayer);
          pushTriggersToStack(upkeepTriggers, 'upkeep', 'upkeep');
          recordUpkeepBegan((ctx as any).state, String(turnPlayer));
}
