import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import type { PlayerID } from "../../../shared/src/types";
import { ResolutionQueueManager } from "../state/resolution/index.js";
import { ResolutionStepType } from "../state/resolution/types.js";

/**
 * Generic player selection system
 * 
 * A unified, scalable system for any effect that requires selecting a player.
 * Supports multiple effect types that execute after player selection:
 * - 'set_chosen_player': Set chosenPlayer property on permanent (Stuffy Doll)
 * - 'control_change': Transfer control to selected player (Vislor Turlough, Xantcha)
 * - 'target_player': Target player for spell/ability effect
 * - Custom handlers can be added easily
 */

/**
 * Effect types that execute after player selection
 */
export type PlayerSelectionEffectType = 
  | 'set_chosen_player'    // Set permanent.chosenPlayer property (Stuffy Doll)
  | 'control_change'       // Change permanent control (Vislor Turlough, Xantcha)
  | 'target_player'        // Target player for spell/ability
  | 'custom';              // Custom effect with handler function

/**
 * Effect data for different effect types
 */
export interface PlayerSelectionEffectData {
  type: PlayerSelectionEffectType;
  
  // Common fields
  permanentId?: string;
  spellId?: string;
  abilityId?: string;
  
  // Control change specific
  goadsOnChange?: boolean;
  mustAttackEachCombat?: boolean;
  cantAttackOwner?: boolean;
  drawCards?: number;
  
  // Custom effect handler
  customHandler?: (
    io: Server,
    gameId: string,
    choosingPlayerId: PlayerID,
    selectedPlayerId: PlayerID,
    effectData: PlayerSelectionEffectData
  ) => void;
}

/**
 * Pending player selection request
 */
// NOTE: Legacy socket-based pending selection maps were removed.
// Player selection now flows through the Resolution Queue as ResolutionStepType.PLAYER_CHOICE.

/**
 * Request player selection from a player
 * 
 * @param io - Socket.IO server
 * @param gameId - Game ID
 * @param playerId - Player who needs to make selection
 * @param cardName - Name of card requiring selection
 * @param description - Description of what they're choosing for
 * @param effectData - Data defining what happens after selection
 * @param allowOpponentsOnly - If true, can only select opponents
 * @param isOptional - If true, player can decline selection
 * @returns Selection ID
 */
export function requestPlayerSelection(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  cardName: string,
  description: string,
  effectData: PlayerSelectionEffectData,
  allowOpponentsOnly: boolean = false,
  isOptional: boolean = false
): string {
  const game = ensureGame(gameId);
  if (!game) {
    debugError(1, `[playerSelection] Game not found: ${gameId}`);
    return '';
  }
  
  const players = game.state?.players || [];
  const validPlayers = allowOpponentsOnly
    ? players.filter((p: any) => p && p.id !== playerId && !p.hasLost)
    : players.filter((p: any) => p && !p.hasLost);

  // De-dupe per permanent/spell
  const queue = ResolutionQueueManager.getQueue(gameId);
  const existing = queue.steps.find((s: any) => {
    if (s.type !== ResolutionStepType.PLAYER_CHOICE) return false;
    if (s.playerId !== playerId) return false;

    const samePermanent = effectData.permanentId && s.permanentId === effectData.permanentId;
    const sameSpell = effectData.spellId && s.spellId === effectData.spellId;
    return Boolean(samePermanent || sameSpell);
  });

  if (existing) {
    debug(2, `[playerSelection] Step already pending for ${cardName} (${existing.id})`);
    return existing.id;
  }

  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.PLAYER_CHOICE,
    playerId,
    description,
    mandatory: !isOptional,
    sourceId: effectData.permanentId || effectData.spellId,
    sourceName: cardName,
    permanentId: effectData.permanentId,
    spellId: effectData.spellId,
    opponentOnly: allowOpponentsOnly,
    isOptional,
    effectData,
    players: validPlayers.map((p: any) => ({
      id: p.id,
      name: p.name || p.id,
      life: game.state?.life?.[p.id] ?? 40,
      libraryCount: (game.state?.zones?.[p.id] as any)?.libraryCount ?? 0,
      isOpponent: p.id !== playerId,
      isSelf: p.id === playerId,
    })),
  });

  debug(2, `[playerSelection] Queued player choice for ${cardName} (${step.id}) from ${playerId}`);
  return step.id;
}

/**
 * Auto-select a random player when timeout occurs
 */
/**
 * Handle declined optional selection
 */
export function handleDeclinedPlayerSelection(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  cardName: string,
  effectData: PlayerSelectionEffectData
): void {
  const game = ensureGame(gameId);
  if (!game) return;
  
  // For control change effects, keep permanent under original controller
  if (effectData.type === 'control_change') {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} chose not to give control of ${cardName}.`,
      ts: Date.now(),
    });
  } else {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} declined to choose a player for ${cardName}.`,
      ts: Date.now(),
    });
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  
  // Broadcast is handled by the caller (Resolution Queue flow)
}

/**
 * Execute the effect after player selection
 */
export function applyPlayerSelectionEffect(
  io: Server,
  gameId: string,
  choosingPlayerId: PlayerID,
  selectedPlayerId: PlayerID,
  cardName: string,
  effectData: PlayerSelectionEffectData,
  wasTimeout: boolean = false
): void {
  const game = ensureGame(gameId);
  if (!game) return;
  
  const battlefield = game.state?.battlefield || [];
  
  switch (effectData.type) {
    case 'set_chosen_player': {
      // Set chosenPlayer property on permanent (Stuffy Doll)
      if (effectData.permanentId) {
        const permanent = battlefield.find((p: any) => p && p.id === effectData.permanentId);
        if (permanent) {
          (permanent as any).chosenPlayer = selectedPlayerId;
          delete (permanent as any).pendingPlayerSelection;
          debug(2, `[playerSelection] Set chosenPlayer for ${cardName} to ${selectedPlayerId}`);
        }
      }
      break;
    }
    
    case 'control_change': {
      // Transfer control of permanent (Vislor Turlough, Xantcha)
      if (effectData.permanentId) {
        const permanent = battlefield.find((p: any) => p && p.id === effectData.permanentId);
        if (permanent) {
          permanent.controller = selectedPlayerId;
          delete (permanent as any).pendingPlayerSelection;
          
          // Apply goad if specified
          if (effectData.goadsOnChange) {
            const currentTurn = (game.state as any).turnNumber || (game.state as any).turn || 0;
            const goadedBy = (permanent as any).goadedBy || [];
            const goadedUntil = (permanent as any).goadedUntil || {};
            
            if (!goadedBy.includes(choosingPlayerId)) {
              (permanent as any).goadedBy = [...goadedBy, choosingPlayerId];
              (permanent as any).goadedUntil = {
                ...goadedUntil,
                [choosingPlayerId]: currentTurn + 2, // Goaded until their next turn
              };
            }
          }
          
          // Draw cards if specified (Humble Defector draws for the activating player)
          if (effectData.drawCards && effectData.drawCards > 0) {
            if (typeof (game as any).drawCards === 'function') {
              (game as any).drawCards(choosingPlayerId, effectData.drawCards);
            } else {
              const lib = (game as any).libraries?.get(choosingPlayerId) || [];
              const zones = (game.state as any).zones || {};
              const z = zones[choosingPlayerId] = zones[choosingPlayerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
              z.hand = z.hand || [];
              for (let i = 0; i < effectData.drawCards && lib.length > 0; i++) {
                const drawn = lib.shift();
                if (drawn) (z.hand as any[]).push({ ...drawn, zone: 'hand' });
              }
              z.handCount = z.hand.length;
              z.libraryCount = lib.length;
            }

            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${getPlayerName(game, choosingPlayerId)} draws ${effectData.drawCards} card${effectData.drawCards !== 1 ? 's' : ''}.`,
              ts: Date.now(),
            });
          }

          // Apply attack restrictions (Xantcha style)
          if (effectData.mustAttackEachCombat) {
            (permanent as any).mustAttackEachCombat = true;
          }
          if (effectData.cantAttackOwner) {
            (permanent as any).cantAttackOwner = true;
            (permanent as any).ownerId = choosingPlayerId;
          }
          
          debug(2, `[playerSelection] Transferred control of ${cardName} to ${selectedPlayerId}`);
        }
      }
      break;
    }
    
    case 'target_player': {
      // Store target player for spell/ability resolution
      // This would be handled by the resolution system
      debug(2, `[playerSelection] Selected target player ${selectedPlayerId} for ${cardName}`);
      break;
    }
    
    case 'custom': {
      // Execute custom handler
      if (effectData.customHandler) {
        effectData.customHandler(io, gameId, choosingPlayerId, selectedPlayerId, effectData);
      }
      break;
    }
  }
  
  // Broadcast chat message
  const selectedPlayerName = getPlayerName(game, selectedPlayerId);
  const choosingPlayerName = getPlayerName(game, choosingPlayerId);
  
  let message = '';
  if (effectData.type === 'control_change') {
    message = `${choosingPlayerName}'s ${cardName} ${wasTimeout ? 'randomly went' : 'went'} to ${selectedPlayerName}.`;
  } else {
    message = `${choosingPlayerName}'s ${cardName} ${wasTimeout ? 'randomly chose' : 'chose'} ${selectedPlayerName}.`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Persist event
  appendEvent(gameId, (game as any).seq ?? 0, "playerSelection", {
    choosingPlayerId,
    selectedPlayerId,
    cardName,
    effectType: effectData.type,
    permanentId: effectData.permanentId,
    wasTimeout,
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  // Broadcast is handled by the caller (Resolution Queue flow)
}

/**
 * Register socket handlers for player selection
 */
// Legacy register/hasPending functions removed; Resolution Queue owns pending tracking.

/**
 * Detect if a card requires player selection on ETB
 * Returns effect data for the appropriate effect type
 */
export function detectETBPlayerSelection(card: any): {
  required: boolean;
  description: string;
  effectData: PlayerSelectionEffectData | null;
  allowOpponentsOnly: boolean;
  isOptional: boolean;
} {
  if (!card) return { required: false, description: "", effectData: null, allowOpponentsOnly: false, isOptional: false };
  
  const name = (card.name || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Stuffy Doll - "As Stuffy Doll enters, choose a player"
  if (name.includes("stuffy doll")) {
    return {
      required: true,
      description: "Choose a player for Stuffy Doll's damage trigger",
      effectData: { type: 'set_chosen_player' },
      allowOpponentsOnly: false,
      isOptional: false,
    };
  }
  
  // Xantcha - "As Xantcha enters, choose an opponent"
  if (name.includes("xantcha")) {
    return {
      required: true,
      description: "Choose an opponent to control Xantcha",
      effectData: { type: 'control_change', mustAttackEachCombat: true },
      allowOpponentsOnly: true,
      isOptional: false,
    };
  }
  
  // Vislor Turlough - "You may have an opponent gain control"
  if (name.includes("vislor turlough")) {
    return {
      required: true,
      description: "Choose an opponent to control Vislor Turlough (optional)",
      effectData: { type: 'control_change', goadsOnChange: true },
      allowOpponentsOnly: true,
      isOptional: true,
    };
  }
  
  // Generic: "as ~ enters, choose a player"
  const entersChoosePlayerPattern = /as (?:~|this (?:creature|permanent)) enters(?: the battlefield)?,?\s+choose (?:a player|an opponent)/i;
  if (entersChoosePlayerPattern.test(oracleText)) {
    const opponentsOnly = /choose an opponent/i.test(oracleText);
    const isOptional = /you may/i.test(oracleText);
    
    // Determine effect type based on oracle text
    let effectType: PlayerSelectionEffectType = 'set_chosen_player';
    const effectData: PlayerSelectionEffectData = { type: effectType };
    
    // Check if it's a control change effect
    if (oracleText.includes('under the control of') || oracleText.includes('gains control')) {
      effectData.type = 'control_change';
    }
    
    return {
      required: true,
      description: `Choose ${opponentsOnly ? 'an opponent' : 'a player'} for ${card.name}`,
      effectData,
      allowOpponentsOnly: opponentsOnly,
      isOptional,
    };
  }
  
  return { required: false, description: "", effectData: null, allowOpponentsOnly: false, isOptional: false };
}
