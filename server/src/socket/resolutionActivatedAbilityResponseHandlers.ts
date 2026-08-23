/**
 * socket/resolutionActivatedAbilityResponseHandlers.ts
 *
 * ACTIVATED_ABILITY response handler (crystal / group_draw / x_activated).
 * Extracted from resolution.ts; wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { broadcastGame } from "./util.js";

function invalidateAutomationAfterHiddenDraw(game: any, affectedPlayerIds: string[], reason: string): void {
  const stateAny = game?.state as any;
  if (!stateAny || affectedPlayerIds.length === 0) return;

  const affectedSet = new Set(affectedPlayerIds.map(playerId => String(playerId || '')));
  const justSkipped = stateAny.justSkippedToPhase;
  if (justSkipped?.playerId && affectedSet.has(String(justSkipped.playerId))) {
    delete stateAny.justSkippedToPhase;
    debug(2, `[Resolution] Cleared justSkippedToPhase for ${justSkipped.playerId} after ${reason}`);
  }

  const autoPassForTurn = stateAny.autoPassForTurn;
  if (!autoPassForTurn || typeof autoPassForTurn !== 'object') return;

  for (const playerId of affectedSet) {
    if (autoPassForTurn[playerId]) {
      delete autoPassForTurn[playerId];
      debug(2, `[Resolution] Cleared autoPassForTurn for ${playerId} after ${reason}`);
    }
  }
}

export async function handleActivatedAbilityResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  // Type guard to ensure we have the correct step type
  if (step.type !== ResolutionStepType.ACTIVATED_ABILITY) {
    debugWarn(1, `[Resolution] handleActivatedAbilityResponse called with wrong step type: ${step.type}`);
    return;
  }
  
  const stepData = step as any;  // Still needed for accessing type-specific fields
  const permanentId = stepData.permanentId;
  const abilityType = stepData.abilityType;
  const abilityData = stepData.abilityData || {};
  const playerId = step.playerId;
  
  debug(1, `[Resolution] Executing activated ability: type=${abilityType}, permanent=${permanentId}`);
  
  // Find the permanent on the battlefield
  const battlefield = game.state?.battlefield || [];
  const perm = battlefield.find((p: any) => p.id === permanentId);
  
  if (!perm) {
    debugWarn(1, `[Resolution] Activated ability permanent not found: ${permanentId}`);
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Activated ability fizzled (permanent not found)`,
      ts: Date.now(),
    });
    return;
  }
  
  const card = (perm as any).card;
  const cardName = (card?.name || '').toLowerCase();
  
  try {
    switch (abilityType) {
      case 'crystal': {
        // Import Crystal abilities dynamically
        const { 
          executeWindCrystalAbility, 
          executeFireCrystalAbility, 
          executeWaterCrystalAbility, 
          executeEarthCrystalAbility, 
          executeDarknessCrystalAbility 
        } = await import("../state/modules/triggers/crystal-abilities.js");
        
        let result: { success: boolean; message?: string; error?: string } = { success: false };
        let message = '';
        
        switch (cardName) {
          case 'the wind crystal': {
            const windResult = executeWindCrystalAbility(game as any, playerId);
            result = { 
              success: windResult.success, 
              message: `The Wind Crystal: ${windResult.affectedCreatures.length} creatures gained flying and lifelink until end of turn` 
            };
            message = result.message || '';
            break;
          }
          
          case 'the fire crystal': {
            const targets = stepData.targets || [];
            if (targets.length === 0) {
              debugWarn(1, `[Resolution] Fire Crystal: no target provided`);
              result = { success: false, error: "No target" };
              break;
            }
            const fireResult = executeFireCrystalAbility(game as any, playerId, targets[0]);
            result = fireResult.success 
              ? { success: true, message: `The Fire Crystal: Created a token copy (will be sacrificed at end step)` }
              : { success: false, error: fireResult.error };
            message = result.message || result.error || '';
            break;
          }
          
          case 'the water crystal': {
            const waterResult = executeWaterCrystalAbility(game as any, playerId);
            if (waterResult.success) {
              const totalMilled = waterResult.results.reduce((sum, r) => sum + r.milledCount, 0);
              const opponentCount = waterResult.results.length;
              result = { 
                success: true, 
                message: `The Water Crystal: ${opponentCount} opponent(s) milled ${totalMilled} total cards` 
              };
              message = result.message || '';
            } else {
              result = { success: false, error: waterResult.error };
            }
            break;
          }
          
          case 'the earth crystal': {
            const targets = stepData.targets || [];
            if (targets.length === 0) {
              debugWarn(1, `[Resolution] Earth Crystal: no targets provided`);
              result = { success: false, error: "No targets" };
              break;
            }
            const earthResult = executeEarthCrystalAbility(
              game as any, 
              playerId, 
              targets,
              abilityData.distribution
            );
            if (earthResult.success && earthResult.results) {
              const details = earthResult.results.map(r => `+${r.countersAdded}`).join(', ');
              result = { success: true, message: `The Earth Crystal: Distributed +1/+1 counters (${details})` };
              message = result.message || '';
            } else {
              result = { success: false, error: earthResult.error };
            }
            break;
          }
          
          case 'the darkness crystal': {
            const targets = stepData.targets || [];
            if (targets.length === 0) {
              debugWarn(1, `[Resolution] Darkness Crystal: no target provided`);
              result = { success: false, error: "No target" };
              break;
            }
            const darknessResult = executeDarknessCrystalAbility(
              game as any, 
              playerId, 
              permanentId,
              targets[0]
            );
            result = darknessResult.success
              ? { success: true, message: `The Darkness Crystal: Returned ${darknessResult.creatureName} to battlefield tapped with +2/+2` }
              : { success: false, error: darknessResult.error };
            message = result.message || result.error || '';
            break;
          }
        }
        
        if (message) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message,
            ts: Date.now(),
          });
        }
        break;
      }
      
      case 'group_draw': {
        // Execute group draw effect
        // Use the groupDrawEffect from abilityData (passed when ability was added to queue)
        const groupDrawEffect = abilityData?.groupDrawEffect;
        
        if (!groupDrawEffect) {
          debugWarn(1, `[Resolution] Group draw effect not found in abilityData for ${cardName}`);
          break;
        }
        
        const affectedPlayers = [];
        const players = game.state.players || [];
        
        switch (groupDrawEffect.affectedPlayers) {
          case 'all':
            // All players draw (Temple Bell, Howling Mine)
            for (const player of players) {
              if (typeof game.drawCards === 'function') {
                game.drawCards(player.id, groupDrawEffect.drawAmount);
                affectedPlayers.push(player.id);
              }
            }
            break;
            
          case 'each_opponent':
            // Each opponent draws (Master of the Feast)
            for (const player of players) {
              if (player.id !== playerId && typeof game.drawCards === 'function') {
                game.drawCards(player.id, groupDrawEffect.drawAmount);
                affectedPlayers.push(player.id);
              }
            }
            break;
            
          case 'you':
            // Only controller draws
            if (typeof game.drawCards === 'function') {
              game.drawCards(playerId, groupDrawEffect.drawAmount);
              affectedPlayers.push(playerId);
            }
            break;
        }

        invalidateAutomationAfterHiddenDraw(game, affectedPlayers, `${groupDrawEffect.cardName || cardName} draw`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${groupDrawEffect.cardName}: ${affectedPlayers.length} player(s) drew ${groupDrawEffect.drawAmount} card(s)`,
          ts: Date.now(),
        });
        break;
      }
      
      case 'x_activated': {
        // Execute X ability
        const { detectXAbility, executeXAbility } = await import("../state/modules/x-activated-abilities.js");
        const xValue = stepData.xValue;
        const xAbilityInfo = abilityData.xAbilityInfo;
        
        if (!xAbilityInfo) {
          debugWarn(1, `[Resolution] X ability info not found for ${cardName}`);
          break;
        }
        
        const result = executeXAbility(
          game as any,
          playerId,
          perm,
          xValue,
          xAbilityInfo
        );
        
        // Mark as activated this turn if once per turn
        if (xAbilityInfo.oncePerTurn) {
          (perm as any).activatedThisTurn = true;
        }
        
        // Generate message based on result
        let message = result.message;
        if (!message && result.destroyedCount !== undefined) {
          message = `${card?.name || 'Permanent'} (X=${xValue}): Destroyed ${result.destroyedCount} permanent(s) with mana value ${xValue}`;
        }
        
        if (message) {
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message,
            ts: Date.now(),
          });
        }
        break;
      }
      
      default:
        debugWarn(1, `[Resolution] Unknown activated ability type: ${abilityType}`);
    }
  } catch (err) {
    debugError(1, `[Resolution] Error executing activated ability:`, err);
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `Error executing activated ability: ${err}`,
      ts: Date.now(),
    });
  }
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
  
  // Broadcast updated state
  broadcastGame(io, game, gameId);
}
