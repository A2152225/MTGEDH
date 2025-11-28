/**
 * server/src/socket/combat.ts
 * 
 * Combat phase socket handlers for declaring attackers and blockers.
 * Handles the declare attackers and declare blockers steps of combat.
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { getAttackTriggersForCreatures, type TriggeredAbility } from "../state/modules/triggered-abilities.js";

/**
 * Check if a permanent is currently a creature (Rule 302)
 * This considers:
 * - Base type line
 * - Type-changing effects (Imprisoned in the Moon, Song of the Dryads, etc.)
 * - Animation effects (e.g., Tezzeret making artifacts creatures, Nissa animating lands)
 * - Granted types from effects
 * - Vehicles (only creatures when crewed this turn)
 * - Spacecraft with Station (creatures when charge counter threshold met)
 * - Bestow creatures (may be Auras when attached to another creature)
 * 
 * Note: This does NOT handle "can't attack" effects like Defang or Pacifism,
 * which are checked separately in the attack validation.
 * 
 * NOTE: This function is intentionally duplicated from rules-engine/src/actions/combat.ts
 * to avoid circular dependencies. Keep both versions in sync when making changes.
 * 
 * @param permanent - The permanent to check
 * @returns true if the permanent is currently a creature
 */
function isCurrentlyCreature(permanent: any): boolean {
  if (!permanent) return false;
  
  // Check type_line from card data
  const typeLine = permanent.card?.type_line?.toLowerCase() || 
                   permanent.type_line?.toLowerCase() || '';
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  
  // FIRST: Check for the isCreature flag - this is set by animation effects
  // like Tezzeret, Karn, Nissa, March of the Machines, etc.
  // This takes highest priority as it represents the current game state
  if (permanent.isCreature === true) {
    return true;
  }
  
  // Check for animation modifiers (Tezzeret, Karn, Ensoul Artifact, etc.)
  // These effects turn non-creature permanents into creatures
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      // Animation effects that make something a creature
      if (mod.type === 'animation' || mod.type === 'ANIMATION' ||
          mod.type === 'becomesCreature' || mod.type === 'BECOMES_CREATURE' ||
          mod.type === 'tezzeret' || mod.type === 'ensoulArtifact' ||
          mod.type === 'marchOfTheMachines' || mod.type === 'nissaAnimation' ||
          mod.type === 'karnAnimation' || mod.type === 'manland') {
        // Check if the animation is still active
        if (mod.active !== false) {
          return true;
        }
      }
      
      // TYPE_CHANGE modifiers can add or remove types
      if (mod.type === 'typeChange' || mod.type === 'TYPE_CHANGE' || 
          mod.type === 'imprisonedInTheMoon' || mod.type === 'songOfTheDryads' ||
          mod.type === 'typeReplacement') {
        // If modifier explicitly removes creature type
        if (mod.removesTypes?.includes('Creature')) {
          return false;
        }
        // If modifier sets a new type line that replaces the original (e.g., "Land")
        // These effects turn the permanent into something else entirely
        if (mod.newTypeLine) {
          const newType = mod.newTypeLine.toLowerCase();
          // The new type line replaces all types - check if it includes creature
          return newType.includes('creature');
        }
        // If modifier adds creature type
        if (mod.addsTypes?.includes('Creature')) {
          return true;
        }
      }
    }
  }
  
  // Check if this permanent is marked as having its types replaced
  // (e.g., by Imprisoned in the Moon making it "just a land")
  if (permanent.typesReplaced === true) {
    // Check the current effective types
    if (permanent.effectiveTypes && Array.isArray(permanent.effectiveTypes)) {
      return permanent.effectiveTypes.includes('Creature');
    }
    // If types were replaced but no creature type, it's not a creature
    return false;
  }
  
  // Check for animated flag (used for lands that become creatures, artifacts animated by Tezzeret, etc.)
  if (permanent.animated === true) {
    return true;
  }
  
  // Handle Bestow creatures - they can be Auras when cast with bestow
  // A bestow creature on the battlefield is a creature UNLESS it's currently
  // attached to another permanent as an Aura
  if (oracleText.includes('bestow')) {
    // Check if this permanent is currently attached to something (acting as an Aura)
    if (permanent.attachedTo || permanent.enchanting) {
      // It's attached to something, so it's an Aura (Enchantment), not a Creature
      return false;
    }
    // If a bestow creature is on the battlefield unattached, it's a creature
    // (This happens when the enchanted creature dies)
    if (typeLine.includes('creature')) {
      return true;
    }
  }
  
  // Handle Vehicles - they are NOT creatures unless crewed this turn
  // Vehicles have "Artifact — Vehicle" type line and "Crew N" ability
  if (typeLine.includes('vehicle')) {
    // Check if the vehicle has been crewed this turn
    // The game should set a 'crewed' flag when crew is activated
    if (permanent.crewed === true) {
      return true;
    }
    // Also check for granted creature type from crew effect
    if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
      if (permanent.grantedTypes.includes('Creature')) return true;
    }
    // Vehicle not crewed - not a creature
    return false;
  }
  
  // Handle Spacecraft with Station mechanic
  // Spacecraft become creatures when they have enough charge counters
  if (typeLine.includes('spacecraft')) {
    // Check if the spacecraft has met its station threshold
    // This is tracked by the game when station ability resolves
    if (permanent.stationed === true) {
      return true;
    }
    // Also check for granted creature type from station effect
    if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
      if (permanent.grantedTypes.includes('Creature')) return true;
    }
    // Check if counters meet the threshold (simplified check)
    // The game should manage this, but we can check for charge counters
    const chargeCounters = permanent.counters?.charge || permanent.counters?.['charge'] || 0;
    const stationThreshold = permanent.stationThreshold || 0;
    if (stationThreshold > 0 && chargeCounters >= stationThreshold) {
      return true;
    }
    // Spacecraft not stationed - not a creature
    return false;
  }
  
  // Check for explicit types array (from modifiers or card data)
  if (permanent.types && Array.isArray(permanent.types)) {
    if (permanent.types.includes('Creature')) return true;
  }
  
  // Check granted types from effects (e.g., "becomes a creature")
  if (permanent.grantedTypes && Array.isArray(permanent.grantedTypes)) {
    if (permanent.grantedTypes.includes('Creature')) return true;
  }
  
  // Check if the base type line includes creature
  if (typeLine.includes('creature')) {
    return true;
  }
  
  return false;
}

/**
 * Register combat phase socket handlers
 */
export function registerCombatHandlers(io: Server, socket: Socket): void {
  /**
   * Declare attackers - player selects which creatures to attack with
   * 
   * Payload:
   * - gameId: string
   * - attackers: Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>
   */
  socket.on("declareAttackers", async ({
    gameId,
    attackers,
  }: {
    gameId: string;
    attackers: Array<{
      creatureId: string;
      targetPlayerId?: string;
      targetPermanentId?: string;
    }>;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "DECLARE_ATTACKERS_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Verify it's the player's turn and correct step
      if (game.state.turnPlayer !== playerId) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "You can only declare attackers on your turn",
        });
        return;
      }

      const step = String((game.state as any).step || "").toLowerCase();
      if (step !== "declareattackers" && step !== "declare_attackers") {
        socket.emit("error", {
          code: "WRONG_STEP",
          message: "Can only declare attackers during the declare attackers step",
        });
        return;
      }

      // Validate attackers are valid creatures controlled by the player
      const battlefield = game.state?.battlefield || [];
      const attackerIds: string[] = [];
      
      for (const attacker of attackers) {
        const creature = battlefield.find((perm: any) => 
          perm.id === attacker.creatureId && 
          perm.controller === playerId
        );
        
        if (!creature) {
          socket.emit("error", {
            code: "INVALID_ATTACKER",
            message: `Creature ${attacker.creatureId} not found or not controlled by you`,
          });
          return;
        }

        // Check if permanent is actually a creature (Rule 508.1a)
        // Enchantments, artifacts without animation, lands, etc. cannot attack
        if (!isCurrentlyCreature(creature)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(creature as any).card?.name || "This permanent"} is not a creature and cannot attack`,
          });
          return;
        }

        // Check if creature is tapped (can't attack if tapped, unless vigilance)
        if ((creature as any).tapped) {
          const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
          const hasVigilance = oracleText.includes("vigilance");
          if (!hasVigilance) {
            socket.emit("error", {
              code: "CREATURE_TAPPED",
              message: `${(creature as any).card?.name || "Creature"} is tapped and cannot attack`,
            });
            return;
          }
        }

        // Check for summoning sickness (can't attack unless haste)
        if ((creature as any).summoningSickness) {
          // More robust haste detection using keyword ability patterns
          const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
          const rawKeywords = (creature as any).card?.keywords;
          const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
          const rawGrantedAbilities = (creature as any).grantedAbilities;
          const grantedAbilities = Array.isArray(rawGrantedAbilities) ? rawGrantedAbilities : [];
          
          // Check for haste in multiple places:
          // 1. Keywords array from Scryfall data
          // 2. Granted abilities from effects
          // 3. Oracle text (with more specific matching to avoid false positives)
          const hasHaste = 
            keywords.some((k: string) => k.toLowerCase() === 'haste') ||
            grantedAbilities.some((a: string) => a.toLowerCase() === 'haste') ||
            // Match "haste" as a standalone word or at beginning of ability text
            /\bhaste\b/i.test(oracleText);
          
          if (!hasHaste) {
            socket.emit("error", {
              code: "SUMMONING_SICKNESS",
              message: `${(creature as any).card?.name || "Creature"} has summoning sickness and cannot attack`,
            });
            return;
          }
        }

        attackerIds.push(attacker.creatureId);
        
        // Mark creature as attacking
        (creature as any).attacking = attacker.targetPlayerId || attacker.targetPermanentId;
        
        // Tap the attacker (unless it has vigilance)
        const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
        const rawKeywords = (creature as any).card?.keywords;
        const keywords = Array.isArray(rawKeywords) ? rawKeywords : [];
        const hasVigilance = 
          keywords.some((k: string) => k.toLowerCase() === 'vigilance') ||
          /\bvigilance\b/i.test(oracleText);
        if (!hasVigilance) {
          (creature as any).tapped = true;
        }
      }

      // Use game's declareAttackers method if available
      if (typeof (game as any).declareAttackers === "function") {
        try {
          (game as any).declareAttackers(playerId, attackerIds);
        } catch (e) {
          console.warn("[combat] game.declareAttackers failed:", e);
        }
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareAttackers", {
          playerId,
          attackers,
        });
      } catch (e) {
        console.warn("[combat] Failed to persist declareAttackers event:", e);
      }

      // Broadcast chat message
      const attackerCount = attackers.length;
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} declares ${attackerCount} attacker${attackerCount !== 1 ? "s" : ""}.`,
        ts: Date.now(),
      });

      // Process attack triggers
      try {
        const attackingCreatures = battlefield.filter((perm: any) => 
          attackerIds.includes(perm.id)
        );
        
        // Get the first defender as the default defending player
        const firstDefender = attackers[0]?.targetPlayerId;
        
        if (attackingCreatures.length > 0 && firstDefender) {
          // Create a minimal context for trigger detection
          const ctx = {
            state: game.state,
            bumpSeq: () => {
              if (typeof (game as any).bumpSeq === "function") {
                (game as any).bumpSeq();
              }
            }
          };
          
          const triggers = getAttackTriggersForCreatures(
            ctx as any,
            attackingCreatures,
            playerId,
            firstDefender
          );
          
          // Push triggers to stack and notify clients
          if (triggers.length > 0) {
            console.log(`[combat] Found ${triggers.length} attack trigger(s) for game ${gameId}`);
            
            for (const trigger of triggers) {
              // Push trigger onto the stack
              game.state.stack = game.state.stack || [];
              const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              game.state.stack.push({
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: trigger.permanentId,
                sourceName: trigger.cardName,
                description: trigger.description,
                triggerType: trigger.triggerType,
                value: trigger.value,
                mandatory: trigger.mandatory,
              });
              
              // Notify players about the trigger
              io.to(gameId).emit("triggeredAbility", {
                gameId,
                triggerId,
                playerId,
                sourcePermanentId: trigger.permanentId,
                sourceName: trigger.cardName,
                triggerType: trigger.triggerType,
                description: trigger.description,
                mandatory: trigger.mandatory,
              });
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`,
                ts: Date.now(),
              });
            }
          }
        }
      } catch (triggerErr) {
        console.warn("[combat] Error processing attack triggers:", triggerErr);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      // Emit combat state update for UI
      io.to(gameId).emit("combatStateUpdated", {
        gameId,
        phase: "declareAttackers",
        attackers: attackers.map(a => ({
          permanentId: a.creatureId,
          defending: a.targetPlayerId || a.targetPermanentId,
        })),
      });

      console.log(`[combat] Player ${playerId} declared ${attackerCount} attackers in game ${gameId}`);

      // After declaring attackers, advance to declare blockers step
      // This prevents the game from getting stuck in the declare attackers step
      if (typeof (game as any).nextStep === "function") {
        try {
          (game as any).nextStep();
          
          // Persist the step advance event
          try {
            await appendEvent(gameId, (game as any).seq || 0, "nextStep", {
              playerId,
              fromStep: "DECLARE_ATTACKERS",
              toStep: "DECLARE_BLOCKERS",
            });
          } catch (e) {
            console.warn("[combat] Failed to persist nextStep event:", e);
          }
          
          // Broadcast updated state after step change
          broadcastGame(io, game, gameId);
          
          console.log(`[combat] Advanced to declare blockers step for game ${gameId}`);
        } catch (e) {
          console.warn("[combat] game.nextStep failed after declareAttackers:", e);
        }
      }
      
    } catch (err: any) {
      console.error(`[combat] declareAttackers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "DECLARE_ATTACKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Declare blockers - defending player selects which creatures block which attackers
   * 
   * Payload:
   * - gameId: string
   * - blockers: Array<{ blockerId: string; attackerId: string }>
   */
  socket.on("declareBlockers", async ({
    gameId,
    blockers,
  }: {
    gameId: string;
    blockers: Array<{
      blockerId: string;
      attackerId: string;
    }>;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        socket.emit("error", {
          code: "DECLARE_BLOCKERS_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      const step = String((game.state as any).step || "").toLowerCase();
      if (step !== "declareblockers" && step !== "declare_blockers") {
        socket.emit("error", {
          code: "WRONG_STEP",
          message: "Can only declare blockers during the declare blockers step",
        });
        return;
      }

      // Validate blockers
      const battlefield = game.state?.battlefield || [];
      
      for (const blocker of blockers) {
        // Find the blocker creature
        const blockerCreature = battlefield.find((perm: any) => 
          perm.id === blocker.blockerId && 
          perm.controller === playerId
        );
        
        if (!blockerCreature) {
          socket.emit("error", {
            code: "INVALID_BLOCKER",
            message: `Creature ${blocker.blockerId} not found or not controlled by you`,
          });
          return;
        }

        // Check if permanent is actually a creature (Rule 509.1a)
        // Enchantments, artifacts without animation, lands, etc. cannot block
        if (!isCurrentlyCreature(blockerCreature)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(blockerCreature as any).card?.name || "This permanent"} is not a creature and cannot block`,
          });
          return;
        }

        // Check if blocker is tapped
        if ((blockerCreature as any).tapped) {
          socket.emit("error", {
            code: "BLOCKER_TAPPED",
            message: `${(blockerCreature as any).card?.name || "Creature"} is tapped and cannot block`,
          });
          return;
        }

        // Find the attacker being blocked
        const attackerCreature = battlefield.find((perm: any) => 
          perm.id === blocker.attackerId && 
          (perm as any).attacking
        );
        
        if (!attackerCreature) {
          socket.emit("error", {
            code: "INVALID_ATTACKER",
            message: `Attacker ${blocker.attackerId} not found or is not attacking`,
          });
          return;
        }

        // Mark the blocker as blocking
        (blockerCreature as any).blocking = (blockerCreature as any).blocking || [];
        (blockerCreature as any).blocking.push(blocker.attackerId);

        // Mark the attacker as being blocked
        (attackerCreature as any).blockedBy = (attackerCreature as any).blockedBy || [];
        (attackerCreature as any).blockedBy.push(blocker.blockerId);
      }

      // Use game's declareBlockers method if available
      if (typeof (game as any).declareBlockers === "function") {
        try {
          (game as any).declareBlockers(playerId, blockers);
        } catch (e) {
          console.warn("[combat] game.declareBlockers failed:", e);
        }
      }

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareBlockers", {
          playerId,
          blockers,
        });
      } catch (e) {
        console.warn("[combat] Failed to persist declareBlockers event:", e);
      }

      // Broadcast chat message
      const blockerCount = blockers.length;
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} declares ${blockerCount} blocker${blockerCount !== 1 ? "s" : ""}.`,
        ts: Date.now(),
      });

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
      // Emit combat state update for UI
      io.to(gameId).emit("combatStateUpdated", {
        gameId,
        phase: "declareBlockers",
        blockers: blockers.map(b => ({
          blockerId: b.blockerId,
          attackerId: b.attackerId,
        })),
      });

      console.log(`[combat] Player ${playerId} declared ${blockerCount} blockers in game ${gameId}`);

      // After declaring blockers, advance to combat damage step
      // This prevents the game from getting stuck in the declare blockers step
      if (typeof (game as any).nextStep === "function") {
        try {
          (game as any).nextStep();
          
          // Persist the step advance event
          try {
            await appendEvent(gameId, (game as any).seq || 0, "nextStep", {
              playerId,
              fromStep: "DECLARE_BLOCKERS",
              toStep: "DAMAGE",
            });
          } catch (e) {
            console.warn("[combat] Failed to persist nextStep event:", e);
          }
          
          // Broadcast updated state after step change
          broadcastGame(io, game, gameId);
          
          console.log(`[combat] Advanced to combat damage step for game ${gameId}`);
        } catch (e) {
          console.warn("[combat] game.nextStep failed after declareBlockers:", e);
        }
      }
      
    } catch (err: any) {
      console.error(`[combat] declareBlockers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "DECLARE_BLOCKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Skip declaring attackers - pass without attacking
   */
  socket.on("skipDeclareAttackers", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      if (game.state.turnPlayer !== playerId) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "You can only skip declaring attackers on your turn",
        });
        return;
      }

      // Advance to next step
      if (typeof (game as any).nextStep === "function") {
        await (game as any).nextStep();
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} attacks with no creatures.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[combat] skipDeclareAttackers error:`, err);
    }
  });

  /**
   * Skip declaring blockers - pass without blocking
   */
  socket.on("skipDeclareBlockers", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as PlayerID | undefined;
      
      if (!game || !playerId) {
        return;
      }

      // Advance to damage step
      if (typeof (game as any).nextStep === "function") {
        await (game as any).nextStep();
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} chooses not to block.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`[combat] skipDeclareBlockers error:`, err);
    }
  });
}
