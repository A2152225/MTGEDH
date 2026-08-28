// server/src/socket/combat-handlers/combatDeclareAttackersRequest.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: nested declareAttackers socket.on body inside registerCombatHandlers.
// Public entry symbols: handleDeclareAttackers.

import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { getAttackProhibitionSourceForPlayer } from "../../../../rules-engine/src/attackRestrictionText.js";
import { playerIsLegalAttackTarget } from "../../../../rules-engine/src/playerInGameStatus.js";
import { processEquippedAttackRevealUntilLandPumps, emitEquippedAttackRevealPumpMessages } from "../../state/modules/equippedAttackRevealPump.js";
import { permanentHasKeyword, permanentHasSummoningSickness } from "../game-actions.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { normalizeAttackerSelections } from "../tokenGroupResolve.js";
import {
  broadcastGame,
  ensureGame,
  getPlayerName,
  millUntilLand,
} from "../util.js";
import {
  canPermanentAttack,
  isCurrentlyCreature,
} from "./combatLegalityGates.js";
import {
  emitDeclareAttackersChat,
  getOwnerAttackRestrictionReason,
  isAttackingOwnerPlaneswalker,
  processAttackTriggersAfterDeclaration,
  resolveDefendingPlayerIdForAttackTarget,
} from "./combatDeclareAttackersSupport.js";
import {
  enqueueSupportedEnlistChoiceSteps,
  enqueueSupportedExertChoiceSteps,
  findForcedAttackViolation,
  getCreatureGoadStatus,
  processTapTriggersForAttackers,
} from "./combatDeclareAttackersForceTapSupport.js";
import { setCombatControl } from "./combatControlState.js";
import { getNearestOpponentDirectionAttackViolation } from "../../state/modules/nearestOpponentDirectionAttackRestriction.js";
import {
  collectAttackYouMaxAttackersForDefender,
  collectAttackYouProhibitionForAttacker,
  collectAttackYouTaxForDefender,
  collectMaxAttackersEachCombat,
} from "../../state/modules/staticEffectSpecAttackYouTax.js";
import { collectThisTurnAttackTaxForAttacker } from "../../state/modules/staticEffectSpecAttackTaxThisTurn.js";
import { collectAttackYouTaxPhyrexianForDefender } from "../../state/modules/staticEffectSpecAttackYouTaxPhyrexian.js";
import type { AttackYouTaxPhyrexianItem } from "../../state/modules/staticEffectSpecAttackYouTaxPhyrexian.js";
import {
  buildAttackCostPhyrexianChoices,
  canAffordAttackCostPayment,
} from "./attackCostPhyrexianPayment.js";

/**
 * Declare attackers - player selects which creatures to attack with
 *
 * Payload:
 * - gameId: string
 * - attackers: Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>
 */
export async function handleDeclareAttackers(
  io: Server,
  socket: Socket,
  payload?: {
    gameId?: unknown;
    attackers?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const attackers = payload?.attackers;

  if (!gameId || typeof gameId !== 'string') {
    socket.emit?.('error', { code: 'DECLARE_ATTACKERS_ERROR', message: 'Missing gameId' } as any);
    return;
  }
  if (!Array.isArray(attackers)) {
    socket.emit?.('error', { code: 'DECLARE_ATTACKERS_ERROR', message: 'Invalid attackers payload' } as any);
    return;
  }

  try {

    const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
    if (!playerId) {
      socket.emit?.('error', { code: 'DECLARE_ATTACKERS_ERROR', message: 'Player not identified' } as any);
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
    let resolvedAttackers;
    try {
      resolvedAttackers = normalizeAttackerSelections(game, playerId, attackers as any[]);
    } catch (normalizeError: any) {
      socket.emit("error", {
        code: normalizeError?.code || "INVALID_ATTACKER",
        message: normalizeError?.message || "Invalid attacker selection",
      });
      return;
    }
    const attackerIds: string[] = [];
    const currentTurn = (game.state as any).turn || 0;

    // Pillowfort attack-you tax from oracle StaticEffectSpec, per attacking creature
    // (Ghostly Prison is uniform; Elephant Grass is color-gated).
    let totalAttackCostRequired = 0;
    const attackCostBreakdown: { playerId: string; cost: number; sources: string[] }[] = [];
    const attackCostByDefender = new Map<string, { cost: number; sources: string[] }>();
    const attackCostPhyrexianItems: AttackYouTaxPhyrexianItem[] = [];

    for (const attacker of resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>) {
      const defendingPlayerId = resolveDefendingPlayerIdForAttackTarget(attacker, battlefield, players);
      if (!defendingPlayerId) continue;
      const attackingCreature = battlefield.find((perm: any) =>
        perm.id === attacker.creatureId && perm.controller === playerId
      );
      const tax = collectAttackYouTaxForDefender(game.state, defendingPlayerId, attackingCreature);
      const thisTurnTax = collectThisTurnAttackTaxForAttacker(game.state, defendingPlayerId);
      const phyrexianTax = collectAttackYouTaxPhyrexianForDefender(game.state, defendingPlayerId, attackingCreature);
      attackCostPhyrexianItems.push(...phyrexianTax.items);
      const combinedCost = tax.cost + thisTurnTax.cost;
      if (combinedCost <= 0 && phyrexianTax.items.length === 0) continue;
      totalAttackCostRequired += combinedCost;
      const combinedSources = [
        ...tax.sources,
        ...thisTurnTax.sources,
        ...phyrexianTax.items.map((item) => item.source),
      ];
      const existing = attackCostByDefender.get(defendingPlayerId);
      if (existing) {
        existing.cost += combinedCost;
        for (const source of combinedSources) {
          if (!existing.sources.includes(source)) existing.sources.push(source);
        }
      } else {
        attackCostByDefender.set(defendingPlayerId, {
          cost: combinedCost,
          sources: combinedSources,
        });
      }
    }

    for (const [playerIdKey, costInfo] of attackCostByDefender.entries()) {
      attackCostBreakdown.push({
        playerId: playerIdKey,
        cost: costInfo.cost,
        sources: costInfo.sources,
      });
    }

    const attackersVsPlayer = new Map<string, number>();
    for (const attacker of resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>) {
      const targetPlayerId = String(attacker.targetPlayerId || '').trim();
      if (!targetPlayerId) continue;
      attackersVsPlayer.set(targetPlayerId, (attackersVsPlayer.get(targetPlayerId) || 0) + 1);
    }
    for (const [defendingPlayerId, count] of attackersVsPlayer.entries()) {
      const cap = collectAttackYouMaxAttackersForDefender(game.state, defendingPlayerId);
      if (cap.max != null && count > cap.max) {
        const defenderName = getPlayerName(game, defendingPlayerId);
        socket.emit('error', {
          code: 'TOO_MANY_ATTACKERS',
          message: `No more than ${cap.max} creatures can attack ${defenderName} this combat.`,
        });
        return;
      }
    }

    const globalAttackCap = collectMaxAttackersEachCombat(game.state);
    if (globalAttackCap.max != null && resolvedAttackers.length > globalAttackCap.max) {
      socket.emit('error', {
        code: 'TOO_MANY_ATTACKERS',
        message: `No more than ${globalAttackCap.max} creatures can attack this combat.`,
      });
      return;
    }
    
    for (const attacker of resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>) {
      const targetPlayerId = String(attacker.targetPlayerId || '').trim();
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

      if (targetPlayerId) {
        const specProhibition = collectAttackYouProhibitionForAttacker(game.state, targetPlayerId, creature);
        const attackProhibitionSource = specProhibition
          || getAttackProhibitionSourceForPlayer(battlefield, targetPlayerId);
        if (attackProhibitionSource) {
          socket.emit('error', {
            code: 'ATTACK_PROHIBITED',
            message: `${getPlayerName(game, targetPlayerId)} can't be attacked while ${attackProhibitionSource} is on the battlefield.`,
          });
          return;
        }
      }

      // Check if permanent is actually a creature (Rule 508.1a)
      // Enchantments, artifacts without animation, lands, etc. cannot attack
      // Pass battlefield and controller for proper devotion calculation (Gods)
      if (!isCurrentlyCreature(creature, battlefield, playerId)) {
        socket.emit("error", {
          code: "NOT_A_CREATURE",
          message: `${(creature as any).card?.name || "This permanent"} is not a creature and cannot attack`,
        });
        return;
      }

      // Check for defender and "as though it didn't have defender" effects (Rule 508.1c)
      const canAttackCheck = canPermanentAttack(creature, battlefield, playerId, game.state);
      if (!canAttackCheck.canAttack) {
        socket.emit("error", {
          code: "CANT_ATTACK",
          message: `${(creature as any).card?.name || "Creature"} can't attack (${canAttackCheck.reason})`,
        });
        return;
      }

      const defendingPlayerId = resolveDefendingPlayerIdForAttackTarget(attacker, battlefield, players);
      const defendingPlayer = players.find(
        (player: any) => String(player?.id || '').trim() === String(defendingPlayerId || '').trim(),
      );
      if (defendingPlayerId && !playerIsLegalAttackTarget(defendingPlayer, playerId)) {
        socket.emit("error", {
          code: "INVALID_ATTACK_TARGET",
          message: "That player has left the game and cannot be attacked",
        });
        return;
      }
      const ownerRestrictionReason = getOwnerAttackRestrictionReason(creature, defendingPlayerId, {
        targetIsOwnerPlaneswalker: isAttackingOwnerPlaneswalker(creature, attacker, battlefield),
      });
      if (ownerRestrictionReason) {
        socket.emit("error", {
          code: "CANT_ATTACK_OWNER",
          message: `${(creature as any).card?.name || "Creature"} ${ownerRestrictionReason.toLowerCase()}.`,
        });
        return;
      }

      const directionRestriction = getNearestOpponentDirectionAttackViolation({
        state: game.state,
        attackerPlayerId: playerId,
        defendingPlayerId,
        targetPermanentId: attacker.targetPermanentId || attacker.targetPlayerId,
      });
      if (directionRestriction.illegal) {
        socket.emit("error", {
          code: "ATTACK_DIRECTION_RESTRICTED",
          message: `${(creature as any).card?.name || "Creature"} can't attack that player. ${directionRestriction.reason}`,
        });
        return;
      }

      // Check if creature is tapped (can't attack if tapped, unless vigilance)
      if ((creature as any).tapped) {
        const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
        if (!hasVigilance) {
          socket.emit("error", {
            code: "CREATURE_TAPPED",
            message: `${(creature as any).card?.name || "Creature"} is tapped and cannot attack`,
          });
          return;
        }
      }

      // Check for summoning sickness (can't attack unless haste)
      if (permanentHasSummoningSickness(creature, battlefield, playerId)) {
        socket.emit("error", {
          code: "SUMMONING_SICKNESS",
          message: `${(creature as any).card?.name || "Creature"} has summoning sickness and cannot attack`,
        });
        return;
      }

      // ========================================================================
      // GOAD validation (Rule 701.15b)
      // Goaded creatures must attack a player other than the goader if able
      // ========================================================================
      // Check if creature is goaded (either via goadedBy tracking or The Sound of Drums aura)
      const goadInfo = getCreatureGoadStatus(creature, battlefield, playerId, currentTurn);
      
      if (goadInfo.isGoaded) {
        // Creature is currently goaded
        const targetPlayerId = attacker.targetPlayerId;
        
        if (targetPlayerId) {
          // Check if attacking a goader when other options exist
          const isAttackingGoader = goadInfo.goaders.includes(targetPlayerId);
          
          if (isAttackingGoader) {
            // Get all possible opponents (not the controller)
            const players = (game.state as any).players || [];
            const allOpponents = players
              .filter((p: any) => playerIsLegalAttackTarget(p, playerId))
              .map((p: any) => p.id);
            
            // Check if there are non-goader opponents available
            const nonGoaderOpponents = allOpponents.filter((oppId: string) =>
              !goadInfo.goaders.includes(oppId)
              && !getNearestOpponentDirectionAttackViolation({
                state: game.state,
                attackerPlayerId: playerId,
                defendingPlayerId: oppId,
              }).illegal
            );
            
            if (nonGoaderOpponents.length > 0) {
              // Rule violation: attacking a goader when other options exist
              const goaderNames = goadInfo.goaders
                .map((gId: string) => getPlayerName(game, gId))
                .join(', ');
              socket.emit("error", {
                code: "GOAD_VIOLATION",
                message: `${(creature as any).card?.name || "Creature"} is goaded by ${goaderNames} and cannot attack them (must attack another opponent if able).`,
              });
              return;
            }
            // Attacking goader is OK only when they're the only option
            debug(2, `[combat] ${(creature as any).card?.name} is attacking goader ${targetPlayerId} (only option available)`);
          }
        }
      }

      const forcedAttackPlayerId = String((creature as any).encoreAttackPlayerId || '').trim();
      if (forcedAttackPlayerId) {
        const players = Array.isArray((game.state as any).players) ? (game.state as any).players : [];
        const forcedOpponentStillActive = players.some((player: any) => playerIsLegalAttackTarget(player, playerId) && String(player?.id || '') === forcedAttackPlayerId);
        if (forcedOpponentStillActive) {
          const declaredTargetPlayerId = String(attacker.targetPlayerId || '').trim();
          if (declaredTargetPlayerId !== forcedAttackPlayerId) {
            socket.emit("error", {
              code: "ATTACK_REQUIREMENT",
              message: `${(creature as any).card?.name || "Creature"} must attack ${getPlayerName(game, forcedAttackPlayerId)} this turn if able.`,
            });
            return;
          }
        }
      }
    }

    const forcedViolation = findForcedAttackViolation(
      game,
      playerId,
      resolvedAttackers.map((entry) => String(entry.creatureId || '')),
    );
    if (forcedViolation) {
      socket.emit("error", {
        code: forcedViolation.code,
        message: forcedViolation.message,
      });
      return;
    }

    if (totalAttackCostRequired > 0 || attackCostPhyrexianItems.length > 0) {
      const attackerIdsToExclude = resolvedAttackers.map((entry) => String(entry.creatureId || ''));
      const afford = canAffordAttackCostPayment(game.state, playerId, {
        generic: totalAttackCostRequired,
        items: attackCostPhyrexianItems,
        excludedPermanentIds: attackerIdsToExclude,
      });

      if (!afford.ok) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA_FOR_ATTACK",
          message: `Cannot attack. Need to pay ${attackCostPhyrexianItems.length > 0 ? '{W/P} and ' : ''}{${totalAttackCostRequired}} for ${attackCostBreakdown.map(b => b.sources.join(', ')).join('; ')}. ${afford.error || ''}`.trim(),
        });
        return;
      }

      const existingPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
        .find((step: any) => step?.attackCostPayment === true);

      if (!existingPrompt) {
        const phyrexianChoices = buildAttackCostPhyrexianChoices(attackCostPhyrexianItems);
        const phyrexianLabel = phyrexianChoices.length > 0
          ? `${phyrexianChoices.map((choice) => choice.symbol).join('')} (or 2 life each)`
          : '';
        const genericLabel = totalAttackCostRequired > 0 ? `{${totalAttackCostRequired}}` : '';
        const costLabel = [phyrexianLabel, genericLabel].filter(Boolean).join(' and ') || '{0}';
        const attackCostStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: playerId as any,
          sourceName: 'Attack Cost',
          description: `Pay ${costLabel} to attack (${attackCostBreakdown.map((entry) => entry.sources.join(', ')).join('; ')})`,
          mandatory: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            { id: 'pay_attack_cost', label: `Pay ${costLabel} and attack` },
            { id: 'cancel_attack', label: 'Cancel attack' },
          ],
          attackCostPayment: true,
          attackCostAmount: totalAttackCostRequired,
          attackCostBreakdown,
          attackCostPhyrexianItems,
          attackCostPhyrexianChoices: phyrexianChoices,
          attackers: resolvedAttackers,
        } as any);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'resolveTopOfStackPrompt', {
            playerId,
            sourceId: 'attack-cost',
            queuedResolutionStep: { ...(attackCostStep as any) },
          });
        } catch (err) {
          debugWarn(1, '[combat] appendEvent(resolveTopOfStackPrompt attackCostPayment) failed:', err);
        }
      }

      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      broadcastGame(io, game, gameId);
      return;
    }

    for (const attacker of resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>) {
      const creature = battlefield.find((perm: any) =>
        perm.id === attacker.creatureId &&
        perm.controller === playerId
      );
      if (!creature) continue;

      attackerIds.push(attacker.creatureId);

      // Mark creature as attacking
      (creature as any).attacking = attacker.targetPlayerId || attacker.targetPermanentId;

      // Track that this creature attacked this turn (for Minas Tirith, etc.)
      (creature as any).attackedThisTurn = true;

      // Tap the attacker (unless it has vigilance)
      const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
      if (!hasVigilance) {
        (creature as any).tapped = true;
      }
    }
    
    // Track total creatures attacked this turn for the attacking player (for Minas Tirith, Lightmine Field, etc.)
    (game.state as any).creaturesAttackedThisTurn = (game.state as any).creaturesAttackedThisTurn || {};
    (game.state as any).creaturesAttackedThisTurn[playerId] = ((game.state as any).creaturesAttackedThisTurn[playerId] || 0) + attackerIds.length;
    debug(2, `[combat] Player ${playerId} has now attacked with ${(game.state as any).creaturesAttackedThisTurn[playerId]} creature(s) this turn`);

    emitEquippedAttackRevealPumpMessages(
      io,
      gameId,
      processEquippedAttackRevealUntilLandPumps(
        game,
        resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string }>,
        battlefield,
        millUntilLand,
      ),
      (defendingPlayerId) => getPlayerName(game, defendingPlayerId),
    );

    // Enlist (702.153): as each enlisted creature attacks, its controller may tap another creature.
    // The live declareAttackers socket path still has its own inline combat flow, so enqueue the
    // optional enlist choice here as well to match executeDeclareAttackers used by AI and paid attacks.
    try {
      enqueueSupportedExertChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
      enqueueSupportedEnlistChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
    } catch (e) {
      debugWarn(1, '[combat] Failed to enqueue enlist choice steps:', e);
    }

    // Process tap triggers for creatures that became tapped from attacking
    processTapTriggersForAttackers(io, game, gameId, attackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>, battlefield, playerId);

    // Use game's declareAttackers method if available
    if (typeof (game as any).declareAttackers === "function") {
      try {
        (game as any).declareAttackers(playerId, attackerIds);
      } catch (e) {
        debugWarn(1, "[combat] game.declareAttackers failed:", e);
      }
    }

    // Persist the event
    try {
      await appendEvent(gameId, (game as any).seq || 0, "declareAttackers", {
        playerId,
        attackers: resolvedAttackers,
      });
    } catch (e) {
      debugWarn(1, "[combat] Failed to persist declareAttackers event:", e);
    }

    try {
      const stateAny = game.state as any;
      stateAny.attackersDeclaredBy = Array.isArray(stateAny.attackersDeclaredBy) ? stateAny.attackersDeclaredBy : [];
      if (!stateAny.attackersDeclaredBy.includes(playerId)) {
        stateAny.attackersDeclaredBy.push(playerId);
      }
    } catch (e) {
      debugWarn(1, "[combat] Failed to record attackersDeclaredBy:", e);
    }

    emitDeclareAttackersChat(
      io,
      gameId,
      game,
      playerId,
      resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>,
    );

    processAttackTriggersAfterDeclaration(
      io,
      game,
      gameId,
      playerId,
      attackerIds,
      resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>,
    );

    // Check for Odric, Master Tactician style effects
    // "Whenever Odric, Master Tactician and at least three other creatures attack"
    const attackerCount = attackerIds.length;
    try {
      if (attackerCount >= 4) {
        // Look for Odric or similar cards among the attacking creatures
        for (const attacker of attackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>) {
          const permanent = battlefield.find((p: any) => p?.id === attacker.creatureId);
          if (!permanent || !permanent.card) continue;
          
          const cardName = (permanent.card.name || '').toLowerCase();
          const oracleText = (permanent.card.oracle_text || '').toLowerCase();
          
          // Check for Odric's specific trigger condition
          if ((cardName.includes('odric') && oracleText.includes('at least three other creatures attack')) ||
              (oracleText.includes('at least three other creatures attack') && oracleText.includes('you choose which creatures block'))) {
            
            debug(2, `[combat] Odric-style effect detected: ${permanent.card.name} - setting combat control for blockers`);
            
            // Set combat control for blockers
            setCombatControl(game, {
              controllerId: playerId,
              sourceId: permanent.id,
              sourceName: permanent.card.name,
              controlsAttackers: false,
              controlsBlockers: true,
            });
            
            // Broadcast chat message
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `🎯 ${permanent.card.name}: ${getPlayerName(game, playerId)} will choose which creatures block and how they block this combat!`,
              ts: Date.now(),
            });
            
            break; // Only apply once
          }
        }
      }
    } catch (odricErr) {
      debugWarn(1, "[combat] Error checking Odric-style effects:", odricErr);
    }

    // Bump sequence and broadcast
    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    broadcastGame(io, game, gameId);

    debug(2, `[combat] Player ${playerId} declared ${attackerCount} attackers in game ${gameId}`);

    // NOTE: Do NOT auto-advance the step here!
    // Per MTG rules, after attackers are declared, all players get priority
    // to cast instants and activate abilities before moving to declare blockers.
    // The step will advance when all players pass priority in succession.
    // The client should emit "passPriority" or "nextStep" when ready to proceed.
    
  } catch (err: any) {
    debugError(1, `[combat] declareAttackers error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "DECLARE_ATTACKERS_ERROR",
      message: err?.message ?? String(err),
    });
  }
}
