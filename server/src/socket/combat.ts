/**
 * server/src/socket/combat.ts
 * 
 * Combat phase socket handlers for declaring attackers and blockers.
 * Handles the declare attackers and declare blockers steps of combat.
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";

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
          const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
          const hasHaste = oracleText.includes("haste");
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
        if (!oracleText.includes("vigilance")) {
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
