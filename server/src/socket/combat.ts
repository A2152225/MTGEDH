/**
 * server/src/socket/combat.ts
 * 
 * Combat phase socket handlers for declaring attackers and blockers.
 * Handles the declare attackers and declare blockers steps of combat.
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName, emitToPlayer, getEffectivePower, getEffectiveToughness, broadcastManaPoolUpdate, parseManaCost, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, consumeManaFromPool, millUntilLand, getMaxGenericManaAvailable } from "./util.js";
import { appendEvent } from "../db/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import {
  getAttackProhibitionSourceForPlayer,
  hasBlanketCantAttack,
  permanentHasMustAttackRequirement,
} from "../../../rules-engine/src/attackRestrictionText.js";

import { getTapTriggers, type TriggeredAbility } from "../state/modules/triggered-abilities.js";
import { buildTapTriggeredStackItem, collectTapTriggersForTapEvent, serializeTapTriggeredStackItem } from "../state/modules/triggers/tap-untap.js";
import { canExertAsItAttacks, getAttackTriggersForCreatures, getSupportedExertAttackReward } from "../state/modules/triggers/combat.js";
import { isInterveningIfSatisfied } from "../state/modules/triggers/intervening-if.js";
import { getCurrentGoaders } from "../state/modules/goad-effects.js";
import { creatureHasHaste, permanentHasKeyword, permanentHasSummoningSickness } from "./game-actions.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { canBlockShadowAsThough } from "../state/modules/blockAsThoughShadow.js";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";
import { queueOptionalPaymentStep } from "./optional-payment-prompts.js";
import { advanceStepPersistingEvent } from "./step-advance.js";
import { inferTriggeredAbilityTargetMetadata } from "../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { processEquippedAttackRevealUntilLandPumps, emitEquippedAttackRevealPumpMessages } from "../state/modules/equippedAttackRevealPump.js";
import { orderTriggersByAPNAP } from "../state/modules/triggers/ordering.js";
import {
  normalizeAttackerSelections,
} from "./tokenGroupResolve.js";
import {
  isCurrentlyCreature,
  canPermanentAttack,
} from "./combat-handlers/combatLegalityGates.js";
import {
  emitDeclareBlockersChat,
  handleDeclareBlockers,
  persistTriggeredAbilityPush,
} from "./combat-handlers/combatDeclareBlockersRequest.js";
import { findMustBeBlockedIfAbleViolation } from "./combat-handlers/combatMustBeBlockedIfAble.js";
import { handleDeclareAttackers } from "./combat-handlers/combatDeclareAttackersRequest.js";
import { handleDeclareControlledAttackers } from "./combat-handlers/combatDeclareControlledAttackersRequest.js";
import {
  emitDeclareAttackersChat,
  formatEnergyCost,
  getDefendingPlayerIdFromAttackDeclaration,
  getOwnerAttackRestrictionReason,
  hasLegalMustAttackDefender,
  isAttackingOwnerPlaneswalker,
  processAttackTriggersAfterDeclaration,
  resolveAttackTriggerManaPaymentChoice,
  resolveDefendingPlayerIdForAttackTarget,
} from "./combat-handlers/combatDeclareAttackersSupport.js";
import {
  enqueueSupportedEnlistChoiceSteps,
  enqueueSupportedExertChoiceSteps,
  findForcedAttackViolation,
  getCreatureGoadStatus,
  processTapTriggersForAttackers,
} from "./combat-handlers/combatDeclareAttackersForceTapSupport.js";
import {
  getCombatControl,
  setCombatControl,
} from "./combat-handlers/combatControlState.js";
import { permanentHasKeywordAbility } from "../../../rules-engine/src/permanentKeywordAbilities.js";

export type { PendingAttackTriggerManaPayment } from "./combat-handlers/combatDeclareAttackersSupport.js";
export { resolveAttackTriggerManaPaymentChoice } from "./combat-handlers/combatDeclareAttackersSupport.js";

// declare-attackers chat / defender-id / attack-trigger payment helpers moved to
// ./combat-handlers/combatDeclareAttackersSupport.js


// exert/enlist choice steps, goad/forced-attack, and tap-on-attack triggers moved to
// ./combat-handlers/combatDeclareAttackersForceTapSupport.js

// isCurrentlyCreature moved to ./combat-handlers/combatLegalityGates.js
// (imported at the top of this file, together with the attack/block legality gates).

// CombatControlEffect / getCombatControl / setCombatControl moved to
// ./combat-handlers/combatControlState.js



// processAttackTriggersAfterDeclaration moved to ./combat-handlers/combatDeclareAttackersSupport.js



export { executeDeclareAttackers } from "./combat-handlers/combatDeclareAttackersExecute.js";


/**
 * Register combat phase socket handlers
 */
export function registerCombatHandlers(io: Server, socket: Socket): void {
  /**
   * Live preview for attacker allocations (UI only).
   * Lets other players/spectators see allocation as it's being made.
   */
  socket.on('combatPreviewAttackers', async (payload?: {
    gameId?: unknown;
    targets?: unknown;
  }) => {
    try {
      const gameId = payload?.gameId;
      const targets = payload?.targets;

      if (!gameId || typeof gameId !== 'string') return;

      const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
      if (!playerId) return;

      const socketGameId = (socket.data as any)?.gameId;
      if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        return;
      }

      const game = ensureGame(gameId);
      if (!game) return;

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === playerId);
      if (!me || me?.spectator || me?.isSpectator) return;

      const combatControl = getCombatControl(game);
      const canPreviewAsController = !!combatControl && combatControl.controlsAttackers && combatControl.controllerId === playerId;

      // Normally the turn player previews. Under combat control, the combat controller previews.
      if (game.state.turnPlayer !== playerId && !canPreviewAsController) return;

      const step = String((game.state as any).step || '').toLowerCase();
      if (step !== 'declareattackers' && step !== 'declare_attackers') return;

      if (!targets || typeof targets !== 'object') return;

      // Sanitize: allow only controlled creatures and only player-id targets.
      const battlefield = (game.state?.battlefield || []) as any[];
      const playerIds = new Set(players.map((p: any) => String(p?.id)));
      const controlledCreatureIds = new Set(
        battlefield
          .filter((p: any) => {
            if (!p) return false;
            if (canPreviewAsController) {
              return isCurrentlyCreature(p, battlefield as any, (p as any)?.controller as any);
            }
            return p.controller === playerId;
          })
          .map((p: any) => String(p?.id))
      );

      const sanitized: Record<string, string> = {};
      const entries = Object.entries(targets);
      for (const [creatureIdRaw, targetIdRaw] of entries) {
        const creatureId = String(creatureIdRaw);
        const targetId = String(targetIdRaw);
        if (!controlledCreatureIds.has(creatureId)) continue;
        if (!playerIds.has(targetId)) continue;
        sanitized[creatureId] = targetId;
      }

      io.to(gameId).emit('combatPreviewAttackers', {
        gameId,
        attackerPlayerId: game.state.turnPlayer,
        targets: sanitized,
      });
    } catch {
      // Best-effort UI preview; ignore errors
    }
  });

  /**
   * Declare attackers - player selects which creatures to attack with
   *
   * Payload:
   * - gameId: string
   * - attackers: Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>
   */
  socket.on("declareAttackers", (payload?: { gameId?: unknown; attackers?: unknown }) => handleDeclareAttackers(io, socket, payload));

  socket.on("declareBlockers", (payload?: { gameId?: unknown; blockers?: unknown }) => handleDeclareBlockers(io, socket, payload));

  /**
   * Skip declaring attackers - pass without attacking
   */
  socket.on("skipDeclareAttackers", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;

    if (!gameId || typeof gameId !== 'string') return;

    try {
      const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
      if (!playerId) return;

      const socketGameId = (socket.data as any)?.gameId;
      if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' } as any);
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' } as any);
        return;
      }

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === playerId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
        return;
      }

      if (game.state.turnPlayer !== playerId) {
        socket.emit("error", {
          code: "NOT_YOUR_TURN",
          message: "You can only skip declaring attackers on your turn",
        });
        return;
      }

      const step = String((game.state as any).step || '').toLowerCase();
      if (step !== 'declareattackers' && step !== 'declare_attackers') {
        socket.emit('error', {
          code: 'WRONG_STEP',
          message: 'Can only skip declaring attackers during the declare attackers step',
        });
        return;
      }

      const forcedViolation = findForcedAttackViolation(game, playerId, []);
      if (forcedViolation) {
        socket.emit('error', {
          code: forcedViolation.code,
          message: forcedViolation.message,
        });
        return;
      }

      // Record authoritative evidence for last-turn attack templates.
      // Also persist a declareAttackers event with zero attackers so replay can reconstruct.
      try {
        const stateAny = game.state as any;
        stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};
        stateAny.attackedPlayersThisTurnByPlayer[String(playerId)] = [];
        stateAny.attackedDefendingPlayersThisCombatByPlayer = stateAny.attackedDefendingPlayersThisCombatByPlayer || {};
        stateAny.attackedDefendingPlayersThisCombatByPlayer[String(playerId)] = [];

        await appendEvent(gameId, (game as any).seq || 0, 'declareAttackers', {
          playerId,
          attackers: [],
        });
        stateAny.attackersDeclaredBy = Array.isArray(stateAny.attackersDeclaredBy) ? stateAny.attackersDeclaredBy : [];
        if (!stateAny.attackersDeclaredBy.includes(playerId)) {
          stateAny.attackersDeclaredBy.push(playerId);
        }
      } catch (e) {
        debugWarn(2, '[combat] Failed to persist skipDeclareAttackers declareAttackers event:', e);
      }

      // Advance to next step after the empty declaration is recorded.
      if (advanceStepPersistingEvent(io, game as any, gameId, {
        playerId,
        reason: 'skipDeclareAttackers',
      })) {
        // advanced
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} attacks with no creatures.`,
        ts: Date.now(),
      });

      // Clear any live preview now that attackers are locked in.
      io.to(gameId).emit('combatPreviewAttackers', {
        gameId,
        attackerPlayerId: playerId,
        targets: {},
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      debugError(1, `[combat] skipDeclareAttackers error:`, err);
    }
  });

  /**
   * Skip declaring blockers - pass without blocking
   */
  socket.on("skipDeclareBlockers", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;

    if (!gameId || typeof gameId !== 'string') return;

    try {
      const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
      if (!playerId) return;

      const socketGameId = (socket.data as any)?.gameId;
      if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' } as any);
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' } as any);
        return;
      }

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === playerId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
        return;
      }

      const state = game.state as any;
      state.blockersDeclaredBy = state.blockersDeclaredBy || [];
      if (state.blockersDeclaredBy.includes(playerId)) {
        debug(1, `[combat] ${playerId} already declared/skipped blockers, ignoring duplicate skip`);
        return;
      }

      const mustBlockViolation = findMustBeBlockedIfAbleViolation({
        state: game.state,
        defendingPlayerId: playerId,
        assignments: [],
      });
      if (mustBlockViolation) {
        socket.emit('error', {
          code: mustBlockViolation.code,
          message: mustBlockViolation.message,
        });
        return;
      }

      // Mark that blockers have been declared (skipped) for this player
      // This allows step advancement to proceed past DECLARE_BLOCKERS
      state.blockersDeclaredBy.push(playerId);
      debug(1, `[combat] ${playerId} skipped declaring blockers`);
      {
        const { queueParsedAttacksUnblockedTriggersOnce } = await import("../state/modules/triggers/combatBlockedIrTriggers.js");
        queueParsedAttacksUnblockedTriggersOnce(game as any, String(playerId), gameId);
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
      
      // Note: Don't call nextStep() here - let the normal priority passing advance the step
      // when all players pass priority in succession
      
    } catch (err: any) {
      debugError(1, `[combat] skipDeclareBlockers error:`, err);
    }
  });

  /**
   * Apply combat control effect (Master Warcraft, Odric, Master Tactician)
   * Sets up the game state so that a player controls combat decisions
   * 
   * Payload:
   * - gameId: string
   * - sourceId: string - The permanent/spell that grants combat control
   * - sourceName: string - Name of the source for display
   * - controlsAttackers: boolean - Whether this effect controls attacker declarations
   * - controlsBlockers: boolean - Whether this effect controls blocker declarations
   */
  socket.on("applyCombatControl", async (payload?: {
    gameId?: unknown;
    sourceId?: unknown;
    sourceName?: unknown;
    controlsAttackers?: unknown;
    controlsBlockers?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const sourceId = payload?.sourceId;
    const sourceName = payload?.sourceName;
    const controlsAttackers = payload?.controlsAttackers;
    const controlsBlockers = payload?.controlsBlockers;

    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'COMBAT_CONTROL_ERROR', message: 'Missing gameId' } as any);
        return;
      }
      if (!sourceId || typeof sourceId !== 'string' || !sourceName || typeof sourceName !== 'string') {
        socket.emit?.('error', { code: 'COMBAT_CONTROL_ERROR', message: 'Invalid combat control source' } as any);
        return;
      }
      if (typeof controlsAttackers !== 'boolean' || typeof controlsBlockers !== 'boolean') {
        socket.emit?.('error', { code: 'COMBAT_CONTROL_ERROR', message: 'Invalid combat control flags' } as any);
        return;
      }

      const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
      if (!playerId) {
        socket.emit?.('error', { code: 'COMBAT_CONTROL_ERROR', message: 'Player not identified' } as any);
        return;
      }

      const socketGameId = (socket.data as any)?.gameId;
      if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' } as any);
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' } as any);
        return;
      }

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === playerId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
        return;
      }

      // Set combat control effect using helper
      setCombatControl(game, {
        controllerId: playerId,
        sourceId,
        sourceName,
        controlsAttackers,
        controlsBlockers,
      });

      // Broadcast chat message
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🎯 ${sourceName}: ${getPlayerName(game, playerId)} controls ${
          controlsAttackers && controlsBlockers ? "attackers and blockers" :
          controlsAttackers ? "attackers" : "blockers"
        } this combat.`,
        ts: Date.now(),
      });

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);

      // Notify the controlling player that they need to make combat decisions
      const combatControl = getCombatControl(game);
      emitToPlayer(io, playerId, "combatControlActive", {
        gameId,
        combatControl,
        mode: controlsAttackers ? 'attackers' : 'blockers',
      });

      debug(2, `[combat] Player ${playerId} gained combat control via ${sourceName} in game ${gameId}`);
      
    } catch (err: any) {
      debugError(1, `[combat] applyCombatControl error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "COMBAT_CONTROL_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Declare attackers under combat control
   * Used when a player controls combat via Master Warcraft or similar effects
   * 
   * Payload:
   * - gameId: string
   * - attackers: Array<{ creatureId: string; targetPlayerId: string }>
   */
  socket.on("declareControlledAttackers", (payload?: { gameId?: unknown; attackers?: unknown }) => handleDeclareControlledAttackers(io, socket, payload));

  /**
   * Declare blockers under combat control
   * Used when a player controls combat via Odric or similar effects
   * 
   * Payload:
   * - gameId: string
   * - blockers: Array<{ blockerId: string; attackerId: string }>
   */
  socket.on("declareControlledBlockers", async (payload?: {
    gameId?: unknown;
    blockers?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const blockersRaw = payload?.blockers;

    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'CONTROLLED_BLOCKERS_ERROR', message: 'Missing gameId' } as any);
        return;
      }
      if (!Array.isArray(blockersRaw)) {
        socket.emit?.('error', { code: 'CONTROLLED_BLOCKERS_ERROR', message: 'Invalid blockers payload' } as any);
        return;
      }

      const blockers = blockersRaw
        .filter((entry: any) => entry && typeof entry === 'object')
        .map((entry: any) => ({
          blockerId: typeof entry.blockerId === 'string' ? entry.blockerId : null,
          attackerId: typeof entry.attackerId === 'string' ? entry.attackerId : null,
        }));
      if (blockers.some((entry) => !entry.blockerId || !entry.attackerId)) {
        socket.emit?.('error', { code: 'CONTROLLED_BLOCKERS_ERROR', message: 'Invalid blockers payload' } as any);
        return;
      }

      const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
      if (!playerId) {
        socket.emit?.('error', { code: 'CONTROLLED_BLOCKERS_ERROR', message: 'Player not identified' } as any);
        return;
      }

      const socketGameId = (socket.data as any)?.gameId;
      if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' } as any);
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' } as any);
        return;
      }

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === playerId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
        return;
      }

      // Verify player has combat control
      const combatControl = getCombatControl(game);
      if (!combatControl || combatControl.controllerId !== playerId) {
        socket.emit("error", {
          code: "NO_COMBAT_CONTROL",
          message: "You don't have combat control",
        });
        return;
      }

      if (!combatControl.controlsBlockers) {
        socket.emit("error", {
          code: "NO_BLOCKER_CONTROL",
          message: "You don't control blocker declarations",
        });
        return;
      }

      const battlefield = game.state?.battlefield || [];
      
      // Validate each blocker
      for (const blocker of blockers) {
        const blockerCreature = battlefield.find((perm: any) => 
          perm.id === blocker.blockerId
        );
        
        if (!blockerCreature) {
          socket.emit("error", {
            code: "INVALID_BLOCKER",
            message: `Creature ${blocker.blockerId} not found`,
          });
          return;
        }

        // Check if permanent is a creature (includes devotion check for Gods)
        if (!isCurrentlyCreature(blockerCreature, battlefield, playerId)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(blockerCreature as any).card?.name || "This permanent"} is not a creature`,
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

        // Check evasion abilities (flying, shadow, horsemanship)
        
        // Flying (accurate keyword helper: grants, equipment, counters, "loses flying")
        if (permanentHasKeywordAbility(attackerCreature, 'flying', battlefield)) {
          const hasFlying = permanentHasKeywordAbility(blockerCreature, 'flying', battlefield);
          const hasReach = permanentHasKeywordAbility(blockerCreature, 'reach', battlefield);
          if (!hasFlying && !hasReach) {
            socket.emit("error", {
              code: "CANT_BLOCK_FLYING",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (flying)`,
            });
            return;
          }
        }
        
        // Shadow
        if (permanentHasKeywordAbility(attackerCreature, 'shadow', battlefield)) {
          if (!permanentHasKeywordAbility(blockerCreature, 'shadow', battlefield) && !canBlockShadowAsThough(blockerCreature, battlefield)) {
            socket.emit("error", {
              code: "CANT_BLOCK_SHADOW",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (shadow)`,
            });
            return;
          }
        }
        
        // Horsemanship
        if (permanentHasKeywordAbility(attackerCreature, 'horsemanship', battlefield)) {
          if (!permanentHasKeywordAbility(blockerCreature, 'horsemanship', battlefield)) {
            socket.emit("error", {
              code: "CANT_BLOCK_HORSEMANSHIP",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (horsemanship)`,
            });
            return;
          }
        }

        // Mark the blocker as blocking
        (blockerCreature as any).blocking = (blockerCreature as any).blocking || [];
        (blockerCreature as any).blocking.push(blocker.attackerId);

        // Mark the attacker as being blocked
        (attackerCreature as any).blockedBy = (attackerCreature as any).blockedBy || [];
        (attackerCreature as any).blockedBy.push(blocker.blockerId);
      }

      // Update combat state
      const existingAttackers = game.state.combat?.attackers || [];
      const updatedAttackers = existingAttackers.map((a: any) => {
        const blockersForAttacker = blockers.filter(b => b.attackerId === a.permanentId);
        return {
          ...a,
          blockedBy: blockersForAttacker.map(b => b.blockerId),
        };
      });

      game.state.combat = {
        ...game.state.combat!,
        phase: 'declareBlockers',
        attackers: updatedAttackers,
        blockers: blockers.map(b => ({
          permanentId: b.blockerId,
          blocking: [b.attackerId],
        })),
      };

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareControlledBlockers", {
          playerId,
          blockers,
          combatControl: combatControl.sourceName,
        });
      } catch (e) {
        debugWarn(1, "[combat] Failed to persist declareControlledBlockers event:", e);
      }

      emitDeclareBlockersChat(
        io,
        gameId,
        game,
        playerId,
        blockers,
        `🎯 ${combatControl.sourceName}: `,
      );

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);

      debug(2, `[combat] Player ${playerId} declared ${blockers.length} controlled blockers in game ${gameId}`);
      
    } catch (err: any) {
      debugError(1, `[combat] declareControlledBlockers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CONTROLLED_BLOCKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Clear combat control effect
   * Called when combat ends or the control effect expires
   */
  socket.on("clearCombatControl", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;

    try {
      if (!gameId || typeof gameId !== 'string') return;

      const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
      if (!playerId) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
        return;
      }

      const socketGameId = (socket.data as any)?.gameId;
      if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
        socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' } as any);
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' } as any);
        return;
      }

      const players = ((game.state as any)?.players || []) as any[];
      const me = players.find((p: any) => p?.id === playerId);
      if (!me || me?.spectator || me?.isSpectator) {
        socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
        return;
      }

      if (game.state.combat && getCombatControl(game)) {
        delete (game.state.combat as any).combatControl;
      }

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      debugError(1, `[combat] clearCombatControl error:`, err);
    }
  });
}

