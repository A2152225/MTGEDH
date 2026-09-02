/**
 * socket/resolution-handlers/playerChoiceResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: PLAYER_CHOICE case body (legacy player-selection effects, control-change,
 * dungeon target-player, ETB chosen-player, and targeted ETB trigger follow-up) plus the
 * private executeTargetedTriggerEffect helper it closed over.
 * Public entry symbols: handlePlayerChoiceResponse.
 *
 * Terminal for the case: the original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import { applyDungeonTargetPlayerEffect } from "../../state/modules/dungeon-effects.js";
import { maybeApplyOracleIrChoiceStepFromResolution, maybeResumeOracleIRStepsAfterResolution } from "../../state/modules/oracleIrServerZoneSync.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { applyPlayerSelectionEffect, handleDeclinedPlayerSelection } from "../player-selection.js";
import { broadcastGame, getPlayerName } from "../util.js";

export async function handlePlayerChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const stepData = step as any;

  if (String(stepData?.oracleIrChoiceStepJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
    if (resumed) {
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }
  }

  // Resolution Queue player choice used by legacy player-selection effects (Stuffy Doll, Xantcha, Vislor, etc.)
  if (stepData?.effectData) {
    if (response.cancelled) {
      const cardName = stepData.sourceName || 'Choose Player';
      handleDeclinedPlayerSelection(io, gameId, response.playerId as PlayerID, cardName, stepData.effectData);
      return;
    }

    let selectedPlayerId: string;
    if (typeof response.selections === 'string') {
      selectedPlayerId = response.selections;
    } else if (Array.isArray(response.selections) && response.selections.length > 0) {
      selectedPlayerId = response.selections[0];
    } else {
      debugError(1, `[Resolution] Invalid player choice response: ${JSON.stringify(response.selections)}`);
      return;
    }

    applyPlayerSelectionEffect(
      io,
      gameId,
      response.playerId as PlayerID,
      selectedPlayerId as PlayerID,
      stepData.sourceName || 'Choose Player',
      {
        ...stepData.effectData,
        opponentOnly: stepData.effectData?.opponentOnly === true || stepData.opponentOnly === true,
      },
      false
    );
    return;
  }

  if (stepData?.controlChangeData) {
    const effectData = {
      type: 'control_change',
      permanentId: String(stepData.controlChangeData?.permanentId || stepData.permanentId || step.sourceId || '').trim(),
      goadsOnChange: stepData.controlChangeData?.goadsOnChange === true,
      mustAttackEachCombat: stepData.controlChangeData?.mustAttackEachCombat === true,
      cantAttackOwner: stepData.controlChangeData?.cantAttackOwner === true,
    } as any;

    if (response.cancelled) {
      const cardName = stepData.sourceName || 'Choose Player';
      handleDeclinedPlayerSelection(io, gameId, response.playerId as PlayerID, cardName, effectData);
      return;
    }

    let selectedPlayerId: string;
    if (typeof response.selections === 'string') {
      selectedPlayerId = response.selections;
    } else if (Array.isArray(response.selections) && response.selections.length > 0) {
      selectedPlayerId = response.selections[0];
    } else {
      debugError(1, `[Resolution] Invalid control change response: ${JSON.stringify(response.selections)}`);
      return;
    }

    applyPlayerSelectionEffect(
      io,
      gameId,
      response.playerId as PlayerID,
      selectedPlayerId as PlayerID,
      stepData.sourceName || 'Choose Player',
      {
        ...effectData,
        opponentOnly: stepData.controlChangeData?.opponentOnly === true || stepData.opponentOnly === true,
      },
      false,
    );
    return;
  }

  // Handle different types of selections
  let selectedPlayerId: string;
  if (typeof response.selections === 'string') {
    selectedPlayerId = response.selections;
  } else if (Array.isArray(response.selections) && response.selections.length > 0) {
    selectedPlayerId = response.selections[0];
  } else {
    debugError(1, `[Resolution] Invalid player choice response: ${JSON.stringify(response.selections)}`);
    return;
  }
  
  debug(2, `[Resolution] Player choice response: selected player ${selectedPlayerId}`);

  if (stepData?.dungeonTargetPlayerEffect) {
    const effectData = stepData.dungeonTargetPlayerEffect;
    const ctx = (game as any).ctx || game;
    const applied = applyDungeonTargetPlayerEffect(ctx as any, selectedPlayerId as PlayerID, effectData);

    try {
      appendEvent(
        gameId,
        Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
        'dungeonTargetPlayerResolve',
        {
          playerId: String(response.playerId || '').trim(),
          selectedPlayerId: String(selectedPlayerId || '').trim(),
          resolvedStepId: String(step.id || '').trim(),
          sourceId: String(step.sourceId || '').trim(),
          sourceName: String(step.sourceName || '').trim(),
          dungeonId: String(effectData?.dungeonId || '').trim(),
          currentRoomId: String(effectData?.roomId || '').trim(),
          amount: Number(effectData?.amount || 0),
        },
      );
    } catch (err) {
      debugWarn(1, '[resolution] appendEvent(dungeonTargetPlayerResolve) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: applied
        ? `${getPlayerName(game, selectedPlayerId)} loses ${Number(effectData?.amount || 0) || 5} life from ${String(step.sourceName || 'Trap!')}.`
        : `${getPlayerName(game, response.playerId)} chose ${getPlayerName(game, selectedPlayerId)} for ${String(step.sourceName || 'Trap!')}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    return;
  }
  
  // Check if this is an ETB permanent choice (Xantcha, Curses, etc.)
  if (stepData.permanentId) {
    const permanentId = stepData.permanentId;
    const cardName = stepData.sourceName || 'Permanent';
    
    // Find the permanent on the battlefield
    const state = game.state || {};
    const battlefield = state.battlefield || [];
    const permanent = battlefield.find((p: any) => p.id === permanentId);
    
    if (permanent) {
      // Store the chosen player on the permanent
      (permanent as any).chosenPlayer = selectedPlayerId;
      
      // Append event for replay
      try {
        await appendEvent(gameId, (game as any).seq || 0, "playerChoice", {
          playerId: response.playerId,
          resolvedStepId: String(step.id || '').trim(),
          resolvedStepType: String(step.type || '').trim(),
          permanentId: permanentId,
          cardName: cardName,
          chosenPlayer: selectedPlayerId,
        });
      } catch (e) {
        debugWarn(1, "[Resolution] Failed to persist player choice event:", e);
      }
      
      // Bump sequence
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }
      
      // Send chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, response.playerId)} chose ${getPlayerName(game, selectedPlayerId)} for ${cardName}.`,
        ts: Date.now(),
      });
      
      debug(2, `[Resolution] Player choice completed: ${cardName} -> ${selectedPlayerId}`);
    }
    return;
  }
  
  // Check if this is an ETB trigger with target
  if (stepData.etbTargetTrigger && stepData.triggerItem) {
    const triggerItem = stepData.triggerItem;
    const sourceName = triggerItem.sourceName || 'Unknown';
    const description = triggerItem.description || '';
    const controller = triggerItem.controller;
    const ctx = (game as any).ctx || game;
    
    // Store the selected target on the trigger item
    triggerItem.selectedTarget = selectedPlayerId;
    
    // Execute the trigger effect with the target
    await executeTargetedTriggerEffect(ctx, controller, sourceName, description, triggerItem, selectedPlayerId);
    
    // Bump sequence
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
  }
}

/**
 * Execute a triggered ability that has a target
 * Handles effects like "exile target player's graveyard"
 */
async function executeTargetedTriggerEffect(
  ctx: any,
  controller: string,
  sourceName: string,
  description: string,
  triggerItem: any,
  targetPlayerId: string
): Promise<void> {
  const state = ctx.state;
  if (!state) return;
  
  const desc = description.toLowerCase();
  
  debug(2, `[executeTargetedTriggerEffect] ${sourceName}: ${description} (target: ${targetPlayerId})`);
  
  // Pattern: "exile target player's graveyard" (Bojuka Bog, etc.)
  if (desc.includes('exile') && desc.includes('graveyard')) {
    const zones = state.zones = state.zones || {};
    const targetZones = zones[targetPlayerId] = zones[targetPlayerId] || {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    };
    
    // Move all cards from target player's graveyard to exile
    const graveyardCards = targetZones.graveyard || [];
    const exileZone = targetZones.exile || [];
    
    if (graveyardCards.length > 0) {
      // Move all graveyard cards to exile
      for (const card of graveyardCards) {
        exileZone.push({ ...card, zone: 'exile' });
      }
      
      debug(2, `[executeTargetedTriggerEffect] ${sourceName}: Exiled ${graveyardCards.length} cards from ${targetPlayerId}'s graveyard`);
      
      // Clear the graveyard
      targetZones.graveyard = [];
      targetZones.graveyardCount = 0;
      targetZones.exile = exileZone;
      targetZones.exileCount = exileZone.length;
      
      // Emit chat message
      const io = (ctx as any).io;
      if (io) {
        io.to((ctx as any).gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId: (ctx as any).gameId,
          from: 'system',
          message: `${sourceName}: Exiled ${graveyardCards.length} cards from ${targetPlayerId}'s graveyard`,
          ts: Date.now(),
        });
      }
    } else {
      debug(2, `[executeTargetedTriggerEffect] ${sourceName}: Target player's graveyard is empty`);
    }
  }

  if (desc.includes('target player') && desc.includes('loses 5 life')) {
    applyDungeonTargetPlayerEffect(ctx as any, targetPlayerId as PlayerID, {
      dungeonId: 'undercity',
      roomId: 'trap',
      amount: 5,
    });
    return;
  }
  
  // Add more targeted effect patterns here as needed
  // Pattern: "destroy target creature"
  // Pattern: "return target permanent to its owner's hand"
  // etc.
}
