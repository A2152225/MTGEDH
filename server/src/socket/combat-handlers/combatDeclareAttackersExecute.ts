// server/src/socket/combat-handlers/combatDeclareAttackersExecute.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: executeDeclareAttackers (AI / paid-attack / resolution-queue path).
// Public entry symbols: executeDeclareAttackers.

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { getCurrentGoaders } from "../../state/modules/goad-effects.js";
import { processEquippedAttackRevealUntilLandPumps, emitEquippedAttackRevealPumpMessages } from "../../state/modules/equippedAttackRevealPump.js";
import { permanentHasKeyword, permanentHasSummoningSickness } from "../game-actions.js";
import { debugWarn } from "../../utils/debug.js";
import { normalizeAttackerSelections } from "../tokenGroupResolve.js";
import { broadcastGame, ensureGame, getPlayerName, millUntilLand } from "../util.js";
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
  processTapTriggersForAttackers,
} from "./combatDeclareAttackersForceTapSupport.js";
import { getNearestOpponentDirectionAttackViolation } from "../../state/modules/nearestOpponentDirectionAttackRestriction.js";
import { playerIsLegalAttackTarget } from "../../../../rules-engine/src/playerInGameStatus.js";
import {
  collectAttackYouMaxAttackersForDefender,
  collectMaxAttackersEachCombat,
} from "../../state/modules/staticEffectSpecAttackYouTax.js";
import { collectThisTurnAttackProhibition } from "../../state/modules/attackProhibitedThisTurn.js";

export async function executeDeclareAttackers(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  attackers: Array<{
    creatureId: string;
    targetPlayerId?: string;
    targetPermanentId?: string;
    defendingPlayerId?: string;
  }>,
  options?: {
    attackCostPaid?: boolean;
    attackCostAmount?: number;
    attackCostBreakdown?: any[];
    attackCostTappedPermanents?: string[];
    attackCostSacrificedPermanents?: string[];
    attackCostPaymentManaDelta?: Record<string, number>;
  }
): Promise<void> {
  const game = ensureGame(gameId);
  if (!game) {
    throw Object.assign(new Error('Game not found'), { code: 'DECLARE_ATTACKERS_ERROR' });
  }

  const resolvedAttackers = normalizeAttackerSelections(game, playerId, attackers);

  const battlefield = game.state?.battlefield || [];
  const forcedViolation = findForcedAttackViolation(
    game,
    playerId,
    resolvedAttackers.map((attacker) => attacker.creatureId),
  );
  if (forcedViolation) {
    throw Object.assign(new Error(forcedViolation.message), { code: forcedViolation.code });
  }

  // Human declare already rejects Crawlspace / Silent Arbiter caps. The paid-attack
  // prompt path validated before enqueueing; skip a second check after payment.
  if (options?.attackCostPaid !== true) {
    const attackersVsPlayer = new Map<string, number>();
    for (const attacker of resolvedAttackers) {
      const targetPlayerId = String(attacker.targetPlayerId || '').trim();
      if (!targetPlayerId) continue;
      attackersVsPlayer.set(targetPlayerId, (attackersVsPlayer.get(targetPlayerId) || 0) + 1);
    }
    for (const [defendingPlayerId, count] of attackersVsPlayer.entries()) {
      const cap = collectAttackYouMaxAttackersForDefender(game.state, defendingPlayerId);
      if (cap.max != null && count > cap.max) {
        const defenderName = getPlayerName(game, defendingPlayerId);
        throw Object.assign(
          new Error(`No more than ${cap.max} creatures can attack ${defenderName} this combat.`),
          { code: 'TOO_MANY_ATTACKERS' },
        );
      }
    }
    const globalAttackCap = collectMaxAttackersEachCombat(game.state);
    if (globalAttackCap.max != null && resolvedAttackers.length > globalAttackCap.max) {
      throw Object.assign(
        new Error(`No more than ${globalAttackCap.max} creatures can attack this combat.`),
        { code: 'TOO_MANY_ATTACKERS' },
      );
    }
  }

  const attackerIds: string[] = [];

  // Per-combat/per-turn tracking consumed by intervening-if.
  // - attackedPlayersThisTurnByPlayer: { [attackerPlayerId]: string[] }
  // - attackedDefendingPlayersThisCombatByPlayer: { [attackerPlayerId]: string[] }
  // - mustAttackThisCombatByPermanentId: { [creatureId]: true }
  // - attackedByAssassinThisTurnByPlayer: { [attackerControllerId]: { [defendingPlayerId]: true } }
  try {
    const stateAny = game.state as any;
    stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};
    stateAny.attackedPlayersThisTurnByPlayer[String(playerId)] = Array.isArray(stateAny.attackedPlayersThisTurnByPlayer[String(playerId)])
      ? stateAny.attackedPlayersThisTurnByPlayer[String(playerId)]
      : [];
    stateAny.attackedDefendingPlayersThisCombatByPlayer = stateAny.attackedDefendingPlayersThisCombatByPlayer || {};
    // Reset per-combat (not per-turn) so extra combats are evaluated correctly.
    stateAny.attackedDefendingPlayersThisCombatByPlayer[String(playerId)] = [];
    stateAny.mustAttackThisCombatByPermanentId = {};

    // Reset per-combat enlist markers so extra combats don't inherit prior combat state.
    // These flags are written by the persisted 'enlist' event and must be cleared when a new combat begins.
    const bf = Array.isArray(battlefield) ? battlefield : [];
    for (const perm of bf) {
      if (!perm) continue;
      if ((perm as any).enlistedThisCombat) (perm as any).enlistedThisCombat = false;
      if ((perm as any).enlistedCreatureThisCombat) (perm as any).enlistedCreatureThisCombat = false;
      if ((perm as any).enlistedCreatureIdThisCombat) delete (perm as any).enlistedCreatureIdThisCombat;
    }

    // Per-combat tracker used by intervening-if templates like
    // "if this creature attacked or blocked this combat".
    stateAny.attackedOrBlockedThisCombatByPermanentId = {};

    // Per-combat snapshot used by intervening-if templates like
    // "if a Pirate and a Vehicle attacked this combat".
    {
      const players = Array.isArray((game.state as any)?.players) ? ((game.state as any).players as any[]) : [];
      const ids = players
        .map((p: any) => String(p?.id ?? p?.playerId ?? '').trim())
        .filter((id: string) => Boolean(id));

      // Reset per-combat snapshots so extra combats are evaluated correctly.
      stateAny.attackersDeclaredThisCombatByPlayer = {};
      stateAny.blockersDeclaredThisCombatByPlayer = {};
      for (const pid of ids) {
        stateAny.attackersDeclaredThisCombatByPlayer[pid] = [];
        stateAny.blockersDeclaredThisCombatByPlayer[pid] = [];
      }
      const fallbackPid = String(playerId);
      if (fallbackPid && !stateAny.attackersDeclaredThisCombatByPlayer[fallbackPid]) {
        stateAny.attackersDeclaredThisCombatByPlayer[fallbackPid] = [];
      }
      if (fallbackPid && !stateAny.blockersDeclaredThisCombatByPlayer[fallbackPid]) {
        stateAny.blockersDeclaredThisCombatByPlayer[fallbackPid] = [];
      }
    }

    // Per-turn; do not reset here.
    stateAny.attackedByAssassinThisTurnByPlayer = stateAny.attackedByAssassinThisTurnByPlayer || {};
    stateAny.attackedByAssassinThisTurnByPlayer[String(playerId)] =
      stateAny.attackedByAssassinThisTurnByPlayer[String(playerId)] || {};
  } catch {
    // best-effort only
  }

  for (const attacker of resolvedAttackers) {
    const creature = battlefield.find(
      (perm: any) => perm?.id === attacker.creatureId && perm?.controller === playerId
    );

    if (!creature) {
      throw Object.assign(new Error('Invalid attacker selection'), { code: 'DECLARE_ATTACKERS_ERROR' });
    }

    if (!isCurrentlyCreature(creature, battlefield, playerId)) {
      throw Object.assign(
        new Error(`${(creature as any).card?.name || 'Permanent'} is not a creature and cannot attack`),
        { code: 'NOT_A_CREATURE' },
      );
    }

    const canAttackCheck = canPermanentAttack(creature, battlefield, playerId, game.state);
    if (!canAttackCheck.canAttack) {
      throw Object.assign(
        new Error(`${(creature as any).card?.name || 'Creature'} can't attack (${canAttackCheck.reason})`),
        { code: 'CANT_ATTACK' },
      );
    }

    const defendingPlayerId = resolveDefendingPlayerIdForAttackTarget(
      attacker,
      battlefield,
      (game.state as any).players,
    );
    const defendingPlayer = ((game.state as any).players || []).find(
      (player: any) => String(player?.id || '').trim() === String(defendingPlayerId || '').trim(),
    );
    if (defendingPlayerId && !playerIsLegalAttackTarget(defendingPlayer, playerId)) {
      throw Object.assign(
        new Error('That player has left the game and cannot be attacked'),
        { code: 'INVALID_ATTACK_TARGET' },
      );
    }
    const ownerRestrictionReason = getOwnerAttackRestrictionReason(creature, defendingPlayerId, {
      targetIsOwnerPlaneswalker: isAttackingOwnerPlaneswalker(creature, attacker, battlefield),
      battlefield,
      gameState: game.state,
    });
    if (ownerRestrictionReason) {
      throw Object.assign(
        new Error(`${(creature as any).card?.name || 'Creature'} ${ownerRestrictionReason.toLowerCase()}`),
        { code: 'CANT_ATTACK_OWNER' },
      );
    }

    const thisTurnProhibition = collectThisTurnAttackProhibition(game.state, creature, attacker);
    if (thisTurnProhibition) {
      throw Object.assign(
        new Error(`Creatures you control can't attack that ${attacker.targetPermanentId ? 'permanent' : 'player'} this turn (${thisTurnProhibition})`),
        { code: 'ATTACK_PROHIBITED' },
      );
    }

    const directionRestriction = getNearestOpponentDirectionAttackViolation({
      state: game.state,
      attackerPlayerId: playerId,
      defendingPlayerId,
      targetPermanentId: attacker.targetPermanentId || attacker.targetPlayerId,
    });
    if (directionRestriction.illegal) {
      throw Object.assign(
        new Error(`${(creature as any).card?.name || 'Creature'} can't attack that player. ${directionRestriction.reason}`),
        { code: 'ATTACK_DIRECTION_RESTRICTED' },
      );
    }

    if ((creature as any).tapped) {
      const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance', game.state);
      if (!hasVigilance) {
        throw Object.assign(
          new Error(`${(creature as any).card?.name || 'Creature'} is tapped and cannot attack`),
          { code: 'CREATURE_TAPPED' },
        );
      }
    }

    if (permanentHasSummoningSickness(creature, battlefield, playerId)) {
      throw Object.assign(
        new Error(`${(creature as any).card?.name || 'Creature'} has summoning sickness and cannot attack`),
        { code: 'SUMMONING_SICKNESS' },
      );
    }

    attackerIds.push(attacker.creatureId);

    const targetPlayerId = attacker.targetPlayerId || attacker.defendingPlayerId;
    (creature as any).attacking = targetPlayerId || attacker.targetPermanentId;
    (creature as any).attackedThisTurn = true;

    try {
      const stateAny = game.state as any;
      stateAny.attackedOrBlockedThisCombatByPermanentId = stateAny.attackedOrBlockedThisCombatByPermanentId || {};
      stateAny.attackedOrBlockedThisCombatByPermanentId[String(attacker.creatureId)] = true;

      stateAny.attackersDeclaredThisCombatByPlayer = stateAny.attackersDeclaredThisCombatByPlayer || {};
      stateAny.attackersDeclaredThisCombatByPlayer[String(playerId)] = Array.isArray(stateAny.attackersDeclaredThisCombatByPlayer[String(playerId)])
        ? stateAny.attackersDeclaredThisCombatByPlayer[String(playerId)]
        : [];
      stateAny.attackersDeclaredThisCombatByPlayer[String(playerId)].push({
        id: String(attacker.creatureId),
        name: String((creature as any)?.card?.name ?? (creature as any)?.name ?? ''),
        type_line: String((creature as any)?.card?.type_line ?? ''),
      });
    } catch {
      // best-effort only
    }

    // Track who was attacked (player-only, not planeswalkers).
    try {
      const targetPid = String(targetPlayerId || '').trim();
      if (targetPid) {
        const stateAny = game.state as any;
        const list: string[] = stateAny.attackedPlayersThisTurnByPlayer?.[String(playerId)];
        if (Array.isArray(list) && !list.includes(targetPid)) list.push(targetPid);
      }
    } catch {
      // best-effort only
    }

    // Track who is being attacked as the defending player for this combat.
    // Includes planeswalker/battle targets by resolving their controller.
    try {
      const stateAny = game.state as any;
      const list: string[] = stateAny.attackedDefendingPlayersThisCombatByPlayer?.[String(playerId)];
      if (Array.isArray(list)) {
        let defendingPid = String(targetPlayerId || '').trim();
        if (!defendingPid) {
          const targetPermId = String(attacker.targetPermanentId || '').trim();
          if (targetPermId) {
            const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
            const targetController = String((targetPerm as any)?.controller || '').trim();
            if (targetController) defendingPid = targetController;
          }
        }
        if (defendingPid && !list.includes(defendingPid)) list.push(defendingPid);
      }
    } catch {
      // best-effort only
    }

    // Track "they were attacked this turn by an Assassin you controlled".
    // Conservative: only set true on positive evidence.
    try {
      const tl = String((creature as any)?.card?.type_line || '').toLowerCase();
      if (tl && /\bassassin\b/i.test(tl)) {
        let defendingPid = String(targetPlayerId || '').trim();
        if (!defendingPid) {
          const targetPermId = String(attacker.targetPermanentId || '').trim();
          if (targetPermId) {
            const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
            const targetController = String((targetPerm as any)?.controller || '').trim();
            if (targetController) defendingPid = targetController;
          }
        }
        if (defendingPid) {
          const stateAny = game.state as any;
          stateAny.attackedByAssassinThisTurnByPlayer = stateAny.attackedByAssassinThisTurnByPlayer || {};
          stateAny.attackedByAssassinThisTurnByPlayer[String(playerId)] =
            stateAny.attackedByAssassinThisTurnByPlayer[String(playerId)] || {};
          stateAny.attackedByAssassinThisTurnByPlayer[String(playerId)][defendingPid] = true;
        }
      }
    } catch {
      // best-effort only
    }

    // Track whether this attacker was under a must-attack requirement this combat.
    // Conservative: only mark `true` on positive evidence.
    try {
      const stateAny = game.state as any;
      const currentTurn = Number((game.state as any).turn || 0);
      const isForced =
        Boolean((creature as any).mustAttackEachCombat) ||
        Boolean((creature as any).mustAttack) ||
        getCurrentGoaders(creature, battlefield, currentTurn).length > 0;

      if (isForced) {
        stateAny.mustAttackThisCombatByPermanentId = stateAny.mustAttackThisCombatByPermanentId || {};
        stateAny.mustAttackThisCombatByPermanentId[String(attacker.creatureId)] = true;
      }
    } catch {
      // best-effort only
    }

    const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance', game.state);
    if (!hasVigilance) {
      (creature as any).tapped = true;

      // Intervening-if support: track that this player tapped a nonland permanent this turn.
      // Conservative: only set true on positive evidence.
      try {
        const stateAny = game.state as any;
        stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
        stateAny.tappedNonlandPermanentThisTurnByPlayer[String(playerId)] = true;
      } catch {}
    }
  }

  // Track total creatures attacked this turn for the attacking player (for Minas Tirith, Lightmine Field, etc.)
  (game.state as any).creaturesAttackedThisTurn = (game.state as any).creaturesAttackedThisTurn || {};
  (game.state as any).creaturesAttackedThisTurn[playerId] =
    ((game.state as any).creaturesAttackedThisTurn[playerId] || 0) + attackerIds.length;

  // Process tap triggers for creatures that became tapped from attacking
  try {
    processTapTriggersForAttackers(io, game, gameId, resolvedAttackers as any, battlefield, playerId);
  } catch (e) {
    debugWarn(1, '[combat] Failed to process tap triggers during executeDeclareAttackers:', e);
  }

  const revealPumpResults = processEquippedAttackRevealUntilLandPumps(
    game,
    resolvedAttackers,
    battlefield,
    millUntilLand,
  );
  emitEquippedAttackRevealPumpMessages(io, gameId, revealPumpResults, (defendingPlayerId) =>
    getPlayerName(game, defendingPlayerId),
  );

  // Use game's declareAttackers method if available
  if (typeof (game as any).declareAttackers === 'function') {
    try {
      (game as any).declareAttackers(playerId, attackerIds);
    } catch (e) {
      debugWarn(1, '[combat] game.declareAttackers failed:', e);
    }
  }

  if (options?.attackCostPaid === true && resolvedAttackers.length > 0 && attackerIds.length === 0) {
    throw Object.assign(new Error('Attack declaration failed after paying attack cost'), {
      code: 'DECLARE_ATTACKERS_ERROR',
    });
  }

  // Persist the event
  try {
    await appendEvent(gameId, (game as any).seq || 0, 'declareAttackers', {
      playerId,
      attackers: resolvedAttackers,
      ...(options?.attackCostPaid
        ? {
            attackCostPaid: true,
            attackCostAmount: options.attackCostAmount,
            attackCostBreakdown: options.attackCostBreakdown,
            tappedPermanents: options.attackCostTappedPermanents,
            sacrificedPermanents: options.attackCostSacrificedPermanents,
            paymentManaDelta: options.attackCostPaymentManaDelta,
          }
        : {}),
    });
  } catch (e) {
    debugWarn(1, '[combat] Failed to persist declareAttackers event:', e);
  }

  try {
    const stateAny = game.state as any;
    stateAny.attackersDeclaredBy = Array.isArray(stateAny.attackersDeclaredBy) ? stateAny.attackersDeclaredBy : [];
    if (!stateAny.attackersDeclaredBy.includes(playerId)) {
      stateAny.attackersDeclaredBy.push(playerId);
    }
  } catch (e) {
    debugWarn(1, '[combat] Failed to record attackersDeclaredBy:', e);
  }

  // Enlist (702.153): as each enlisted creature attacks, its controller may tap another creature.
  // We model this via optional Resolution Queue TARGET_SELECTION steps and persist the resulting
  // enlist action as its own event so replay is deterministic.
  try {
    enqueueSupportedExertChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
    enqueueSupportedEnlistChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)), game.state);
  } catch (e) {
    debugWarn(1, '[combat] Failed to enqueue enlist choice steps:', e);
  }

  processAttackTriggersAfterDeclaration(io, game, gameId, playerId, attackerIds, resolvedAttackers);

  emitDeclareAttackersChat(io, gameId, game, playerId, resolvedAttackers);

  // Clear any live preview now that attackers are locked in.
  io.to(gameId).emit('combatPreviewAttackers', {
    gameId,
    attackerPlayerId: playerId,
    targets: {},
  });

  broadcastGame(io, game, gameId);
}
