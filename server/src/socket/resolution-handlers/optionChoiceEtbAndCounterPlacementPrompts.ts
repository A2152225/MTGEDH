/**
 * socket/resolution-handlers/optionChoiceEtbAndCounterPlacementPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the ETB "choose an ability" prompt keyed by `stepData.permanentId` (store the one
 * or many chosen options on the battlefield permanent and persist an `optionChoice` event) and the
 * multi-player counter-placement round keyed by `counterPlacementTrigger` / `agitatorAntTrigger`
 * (record each player's accept-or-decline, and once no such step is left in the queue, add the
 * +1/+1 counters and run the "if a player does" rider - goad, or the can't-attack-you restriction).
 * Public entry symbols: handleEtbPermanentOptionChoice, handleCounterPlacementTriggerChoice.
 *
 * `handleEtbPermanentOptionChoice` always returned, so its call site is `await handler(...); return;`.
 * `handleCounterPlacementTriggerChoice` deliberately does NOT return in the parent: the original
 * block fell through to the `step.action` checks below it, so its call site is a bare
 * `handler(...);` with no return. It stays synchronous (the original body had no awaits) so the
 * fallthrough does not gain a microtask boundary.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { updateCounters } from "../../state/modules/counters_tokens.js";
import {
  ResolutionQueueManager,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { getPlayerName } from "../util.js";

/** ETB "choose flying or first strike" style prompt: remember the pick on the permanent. */
export async function handleEtbPermanentOptionChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const selectedOption = response.selections;
  const playerId = response.playerId;

  const permanentId = stepData.permanentId;
  const cardName = stepData.sourceName || 'Permanent';

  // Extract the selected option value(s)
  let chosenOptions: string[];
  if (Array.isArray(selectedOption)) {
    // Multiple selections (e.g., Greymond choosing 2 abilities)
    chosenOptions = selectedOption.map((opt: any) => {
      if (typeof opt === 'string') return opt;
      if (typeof opt === 'object' && opt !== null) {
        return opt.value || opt.id || String(opt);
      }
      return String(opt);
    });
  } else if (typeof selectedOption === 'string') {
    chosenOptions = [selectedOption];
  } else if (typeof selectedOption === 'object' && selectedOption !== null) {
    // Handle if it's an option object with value field
    const value = (selectedOption as any).value || (selectedOption as any).id || String(selectedOption);
    chosenOptions = [value];
  } else {
    debugWarn(2, `[Resolution] Invalid option choice: ${JSON.stringify(selectedOption)}`);
    return;
  }

  // Find the permanent on the battlefield
  const state = game.state || {};
  const battlefield = state.battlefield || [];
  const permanent = battlefield.find((p: any) => p.id === permanentId);

  if (permanent) {
    // Store the chosen option(s) on the permanent
    if (chosenOptions.length === 1) {
      (permanent as any).chosenOption = chosenOptions[0];
    } else {
      (permanent as any).chosenOptions = chosenOptions;
    }

    // Append event for replay
    try {
      await appendEvent(gameId, (game as any).seq || 0, "optionChoice", {
        playerId: playerId,
        permanentId: permanentId,
        cardName: cardName,
        chosenOptions: chosenOptions,
        resolvedStepId: String((step as any).id || '').trim(),
      });
    } catch (e) {
      debugWarn(1, "[Resolution] Failed to persist option choice event:", e);
    }

    // Bump sequence
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    // Send chat message
    const optionsText = chosenOptions.length === 1
      ? `"${chosenOptions[0]}"`
      : chosenOptions.map(o => `"${o}"`).join(' and ');
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} chose ${optionsText} for ${cardName}.`,
      ts: Date.now(),
    });

    debug(2, `[Resolution] Option choice completed: ${cardName} -> ${chosenOptions.join(', ')}`);
  }
}

/**
 * "Each player may put two +1/+1 counters on a creature they control. If a player does, ..."
 * (Agitator Ant, Orzhov Advokist, ...). Does not return control to the caller - the parent keeps
 * checking the `step.action` branches after this one.
 */
export function handleCounterPlacementTriggerChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const stepData = step as any;
  const selectedOption = response.selections;
  const playerId = response.playerId;

  const state = game.state;
  const battlefield = state.battlefield || [];

  // Initialize tracking if this is the first response
  if (!state._counterPlacementSelections) {
    state._counterPlacementSelections = {};
  }

  // Store this player's selection AND track if they accepted
  // Handle different types of selections
  let creatureId: string | undefined;
  let playerAccepted = false;

  if (Array.isArray(selectedOption) && selectedOption.length > 0) {
    const firstSelection = selectedOption[0];
    if (typeof firstSelection === 'string' && firstSelection !== 'decline') {
      creatureId = firstSelection;
      playerAccepted = true;
    }
  } else if (typeof selectedOption === 'string' && selectedOption !== 'decline') {
    creatureId = selectedOption;
    playerAccepted = true;
  }

  // Track both the selection AND the acceptance status
  state._counterPlacementSelections[playerId] = {
    creatureId: creatureId || null,
    accepted: playerAccepted,
  };

  debug(2, `[Resolution] Counter placement: ${playerId} ${playerAccepted ? `chose creature ${creatureId}` : 'declined'}`);

  // Check if this was the last player to respond
  const queue = ResolutionQueueManager.getQueue(gameId);
  const remainingSteps = queue.steps.filter((s: any) => s.counterPlacementTrigger || s.agitatorAntTrigger);

  if (remainingSteps.length === 0) {
    // All players have made their choices - now apply counters and any additional effects
    debug(2, `[Resolution] Counter placement: All players responded, applying counters`);
    const selections = state._counterPlacementSelections || {};
    const playersWhoAccepted: string[] = []; // Track who accepted for "If a player does" effects
    const creaturesWithCounters: Array<{ id: string; playerId: string }> = [];

    // Get the effect metadata from stepData
    const effectType = stepData.effectType || 'none';
    const conditionalEffect = stepData.conditionalEffect || {};
    const sourceName = stepData.sourceName || 'Counter placement effect';
    const sourceController = stepData.sourceController || state.turnPlayer;
    const goadedByPlayerId = String(state.turnPlayer || sourceController || '').trim();

    // Apply +1/+1 counters ONLY to creatures whose controllers accepted
    for (const [playerId, selection] of Object.entries(selections)) {
      const selectionData = selection as any;

      // Check if this is the new format with accepted tracking or old format
      const accepted = selectionData.accepted !== undefined ? selectionData.accepted : !!selectionData;
      const creatureId = selectionData.creatureId || (typeof selectionData === 'string' ? selectionData : null);

      if (!accepted || !creatureId) continue;

      playersWhoAccepted.push(playerId);
      const creature = battlefield.find((p: any) => p.id === creatureId);

      if (creature) {
        updateCounters(game as any, creatureId, { '+1/+1': 2 });
        creaturesWithCounters.push({ id: creatureId, playerId });

        debug(2, `[Resolution] Counter placement: Added 2 +1/+1 counters to ${creature.card?.name || creatureId}`);

        // Emit chat message
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}_${Math.random()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${playerId} put 2 +1/+1 counters on ${creature.card?.name || 'a creature'}`,
          ts: Date.now(),
        });
      }
    }

    // Apply "If a player does" conditional effects ONLY to players who accepted
    if (playersWhoAccepted.length > 0) {
      if (effectType === 'goad' || conditionalEffect.onAccept === 'goad') {
        // Agitator Ant: Goad all creatures that received counters
        for (const { id: creatureId } of creaturesWithCounters) {
          const creature = battlefield.find((p: any) => p.id === creatureId);
          if (creature) {
            creature.goaded = creature.goaded || {};
            creature.goaded[goadedByPlayerId] = true; // Goaded until controller's next turn
            debug(2, `[Resolution] ${sourceName}: Goaded ${creature.card?.name || creatureId}`);
          }
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}_${Math.random()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: Goaded ${creaturesWithCounters.length} creature(s)`,
          ts: Date.now(),
        });
      } else if (effectType === 'cant_attack' || conditionalEffect.onAccept === 'cant_attack_controller') {
        // Orzhov Advokist: "If a player does, creatures that player controls can't attack you"
        // Apply restriction ONLY to players who accepted (put counters on a creature)
        for (const playerId of playersWhoAccepted) {
          // Mark all creatures controlled by this player as unable to attack the source controller
          const playerCreatures = battlefield.filter((p: any) => p.controller === playerId);
          for (const creature of playerCreatures) {
            creature.cantAttackPlayers = creature.cantAttackPlayers || {};
            // Can't attack until source controller's next turn
            creature.cantAttackPlayers[sourceController] = {
              until: 'next_turn',
              sourcePlayer: sourceController,
            };
            debug(2, `[Resolution] ${sourceName}: ${creature.card?.name || creature.id} (controlled by ${playerId}) can't attack ${sourceController}`);
          }
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}_${Math.random()}`,
          gameId,
          from: 'system',
          message: `${sourceName}: ${playersWhoAccepted.length} player(s) placed counters and can't attack you until your next turn`,
          ts: Date.now(),
        });
      }
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'counterPlacementResolve', {
        resolvedStepId: String((step as any).id || '').trim(),
        sourceName,
        sourceController,
        goadedByPlayerId: goadedByPlayerId || undefined,
        effectType,
        conditionalEffectOnAccept: String(conditionalEffect.onAccept || '').trim() || undefined,
        playersWhoAccepted,
        creaturesWithCounters: creaturesWithCounters.map((entry) => ({
          permanentId: entry.id,
          playerId: entry.playerId,
        })),
      });
    } catch (e) {
      debugWarn(1, '[Resolution] appendEvent(counterPlacementResolve) failed:', e);
    }

    // Clean up tracking
    delete state._counterPlacementSelections;

    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
  }
}
