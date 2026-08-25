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

export type { PendingAttackTriggerManaPayment } from "./combat-handlers/combatDeclareAttackersSupport.js";
export { resolveAttackTriggerManaPaymentChoice } from "./combat-handlers/combatDeclareAttackersSupport.js";

// declare-attackers chat / defender-id / attack-trigger payment helpers moved to
// ./combat-handlers/combatDeclareAttackersSupport.js


function enqueueSupportedExertChoiceSteps(
  gameId: string,
  battlefield: any[],
  playerId: string,
  attackerIds: string[],
): void {
  for (const attackerId of attackerIds) {
    const attacker = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === String(attackerId));
    if (!attacker) continue;

    if (!canExertAsItAttacks((attacker as any)?.card)) continue;

    const rewardDescription = getSupportedExertAttackReward((attacker as any)?.card);

    const oracleText = String((attacker as any)?.card?.oracle_text || '');
    if (/hasn't been exerted this turn/i.test(oracleText) && (attacker as any).exertedThisTurn === true) {
      continue;
    }

    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as any)
      .find((step: any) =>
        step?.type === ResolutionStepType.OPTION_CHOICE &&
        (step as any)?.exertChoice === true &&
        String(step?.sourceId || '') === String(attackerId),
      );
    if (existing) continue;

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      sourceId: String(attackerId),
      sourceName: String((attacker as any)?.card?.name || 'Exert'),
      sourceImage: (attacker as any)?.card?.image_uris?.small || (attacker as any)?.card?.image_uris?.normal,
      description: 'Exert — You may exert this creature as it attacks.',
      mandatory: false,
      options: [
        { id: 'exert', label: "Exert (won't untap during your next untap step)" },
        { id: 'normal', label: 'Do not exert' },
      ],
      minSelections: 1,
      maxSelections: 1,
      exertChoice: true,
      exertAttackerId: String(attackerId),
      exertRewardDescription: rewardDescription,
    } as any);
  }
}

function enqueueSupportedEnlistChoiceSteps(
  gameId: string,
  battlefield: any[],
  decisionPlayerId: string,
  attackerIds: string[],
): void {
  for (const attackerId of attackerIds) {
    const attacker = battlefield.find((p: any) => p && String(p.id) === String(attackerId));
    if (!attacker) continue;

    const oracleText = String((attacker as any)?.card?.oracle_text || '');
    if (!/\benlist\b/i.test(oracleText)) continue;

    const attackerControllerId = String((attacker as any)?.controller || '');

    const valid = battlefield
      .filter((p: any) => {
        if (!p) return false;
        if (String(p.controller || '') !== attackerControllerId) return false;
        if (String(p.id) === String(attackerId)) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        if (p.tapped) return false;
        if (p.attacking) return false;
        if (permanentHasSummoningSickness(p, battlefield as any, attackerControllerId)) return false;
        return true;
      })
      .map((p: any) => ({
        id: String(p.id),
        label: `${p.card?.name || 'Creature'} (${getEffectivePower(p)}/${getEffectiveToughness(p)})`,
        description: String(p.card?.type_line || 'Creature'),
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    if (valid.length === 0) continue;

    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, decisionPlayerId as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.enlistChoice === true && String(s?.sourceId) === String(attackerId));

    if (!existing) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: decisionPlayerId as any,
        sourceId: attackerId,
        sourceName: String((attacker as any)?.card?.name || 'Enlist'),
        sourceImage: (attacker as any)?.card?.image_uris?.small || (attacker as any)?.card?.image_uris?.normal,
        description: 'Enlist — You may tap another untapped nonattacking creature you control.',
        mandatory: false,
        validTargets: valid,
        targetTypes: ['enlist_creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature to tap for enlist',
        enlistChoice: true,
        enlistAttackerId: attackerId,
      } as any);
    }
  }
}


/**
 * Get goad status for a creature.
 * A creature is goaded if:
 * 1. It has active goaders in its goadedBy array (from direct goad effects)
 * 2. It's enchanted by The Sound of Drums or similar auras that continuously goad
 * 
 * Returns { isGoaded: boolean, goaders: PlayerID[] }
 */
function getCreatureGoadStatus(
  creature: any,
  battlefield: any[],
  creatureController: PlayerID,
  currentTurn: number
): { isGoaded: boolean; goaders: PlayerID[] } {
  const goaders = getCurrentGoaders(creature, battlefield, currentTurn);

  return {
    isGoaded: goaders.length > 0,
    goaders
  };
}

type ForcedAttackViolation = {
  code: 'GOAD_MUST_ATTACK' | 'MUST_ATTACK';
  message: string;
};

function creatureCanBeForcedToAttack(
  perm: any,
  battlefield: any[],
  playerId: PlayerID,
  players: any[],
): boolean {
  if ((perm as any).tapped) return false;
  if (permanentHasKeyword(perm, battlefield, playerId, 'defender')) return false;
  if (hasBlanketCantAttack(perm.card?.oracle_text || '')) return false;
  if (permanentHasSummoningSickness(perm, battlefield, playerId)) return false;
  if (!canPermanentAttack(perm, battlefield, playerId).canAttack) return false;
  return (Array.isArray(players) ? players : []).some(
    (player: any) => player?.id && player.id !== playerId && !player.hasLost,
  );
}

/**
 * Rule 701.15b / 701.38b: goaded creatures (and "attacks each combat if able")
 * must be declared as attackers when they are able.
 */
function findForcedAttackViolation(
  game: any,
  playerId: PlayerID,
  attackerIds: readonly string[],
): ForcedAttackViolation | null {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const currentTurn = Number((game?.state as any)?.turn || 0);
  const players = Array.isArray((game?.state as any)?.players) ? (game.state as any).players : [];
  const attacking = new Set(attackerIds.map((id) => String(id)));

  const goadedNames: string[] = [];
  const mustAttackNames: string[] = [];

  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    if (!isCurrentlyCreature(perm, battlefield, playerId)) continue;
    if (attacking.has(String(perm.id))) continue;
    if (!creatureCanBeForcedToAttack(perm, battlefield, playerId, players)) continue;

    const goadInfo = getCreatureGoadStatus(perm, battlefield, playerId, currentTurn);
    if (goadInfo.isGoaded) {
      goadedNames.push(perm.card?.name || 'Unknown');
      continue;
    }

    if (
      permanentHasMustAttackRequirement(perm, battlefield) &&
      hasLegalMustAttackDefender(perm, playerId, players)
    ) {
      mustAttackNames.push(perm.card?.name || 'Unknown');
    }
  }

  if (goadedNames.length > 0) {
    return {
      code: 'GOAD_MUST_ATTACK',
      message: `The following goaded creature(s) must attack if able: ${goadedNames.join(', ')}`,
    };
  }
  if (mustAttackNames.length > 0) {
    return {
      code: 'MUST_ATTACK',
      message: `The following creature(s) attack each combat if able: ${mustAttackNames.join(', ')}`,
    };
  }
  return null;
}

/**
 * Process tap triggers for attacking creatures
 * This handles cards like Magda, Brazen Outlaw: "Whenever a Dwarf you control becomes tapped, create a Treasure token."
 * 
 * @param io - Socket.IO server instance
 * @param game - Game state
 * @param gameId - Game ID
 * @param attackers - Array of attacker objects with creatureId
 * @param battlefield - Battlefield array
 * @param attackingPlayerId - Player who is declaring attackers (may differ from creature controllers in controlled combat)
 */
function processTapTriggersForAttackers(
  io: Server,
  game: any,
  gameId: string,
  attackers: any[],
  battlefield: any[],
  attackingPlayerId: PlayerID
): void {
  try {
    const ctx = {
      state: game.state,
      bumpSeq: () => {
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
      }
    };
    
    // Check for tap triggers for creatures tapped in this declare-attackers event.
    const tappedAttackerIds: string[] = [];
    for (const attacker of attackers) {
      const creature = battlefield.find((p: any) => p?.id === attacker.creatureId);
      if (!creature) continue;

      const hasVigilance = permanentHasKeyword(creature, battlefield, attackingPlayerId, 'vigilance');
      if (!hasVigilance && creature.tapped) {
        tappedAttackerIds.push(String(creature.id));
      }
    }

    const allTapTriggers = collectTapTriggersForTapEvent(
      ctx as any,
      tappedAttackerIds,
      String(attackingPlayerId),
    );
    
    // Push tap triggers to stack and notify clients
    if (allTapTriggers.length > 0) {
      debug(2, `[combat] Found ${allTapTriggers.length} tap trigger(s) for game ${gameId}`);

      const orderedTapTriggers = orderTriggersByAPNAP(
        ctx as any,
        allTapTriggers.map((entry) => ({
          controllerId: String(entry?.trigger?.controllerId || attackingPlayerId || ''),
          entry,
        })),
      ).map((orderedEntry: any) => orderedEntry.entry);
      
      for (const tapTrigger of orderedTapTriggers) {
        const trigger = tapTrigger.trigger;
        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        const triggerControllerId = (trigger.controllerId || attackingPlayerId) as PlayerID;
        const sourcePerm = battlefield.find((p: any) => String(p?.id || '') === String(trigger.permanentId || ''));
        try {
          const controller = String(triggerControllerId);
          const textForEval = (() => {
            const raw = String(trigger.description || trigger.effect || "").trim();
            if (!raw) return raw;
            if (/^(?:when|whenever|at)\b/i.test(raw)) return raw;
            return `Whenever ~ becomes tapped, ${raw}`;
          })();
          const ok = isInterveningIfSatisfied(
            ctx as any,
            controller,
            textForEval,
            sourcePerm,
            /\bthat player\b/i.test(textForEval)
              ? {
                  thatPlayerId: String(triggerControllerId),
                  referencedPlayerId: String(triggerControllerId),
                  theirPlayerId: String(triggerControllerId),
                }
              : undefined
          );
          if (ok === false) {
            debug(2, `[combat] Skipping tap trigger due to unmet intervening-if: ${trigger.cardName} - ${trigger.description}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }

        // Push trigger onto stack
        game.state.stack = game.state.stack || [];
        const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const stackItem: any = buildTapTriggeredStackItem({
          ...trigger,
          controllerId: String(triggerControllerId),
        } as any, tapTrigger.tappedPermanentId, triggerId, battlefield.find((p: any) => String(p?.id || '') === String(tapTrigger.tappedPermanentId || '')), sourcePerm);
        game.state.stack.push(stackItem);

        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', serializeTapTriggeredStackItem(stackItem));
        } catch (err) {
          debugWarn(1, '[combat] appendEvent(pushTriggeredAbility tap trigger) failed:', err);
        }
        
        debug(2, `[combat] Tap trigger: ${trigger.cardName} - ${trigger.description}`);
      }
      
      // Broadcast the updated game state after adding triggers
      broadcastGame(io, game, gameId);
    }
  } catch (e) {
    debugError(1, "[combat] Failed to process tap triggers:", e);
  }
}


// isCurrentlyCreature moved to ./combat-handlers/combatLegalityGates.js
// (imported at the top of this file, together with the attack/block legality gates).

/**
 * Combat control effect type for type-safe access
 */
interface CombatControlEffect {
  controllerId: PlayerID;
  sourceId: string;
  sourceName: string;
  controlsAttackers: boolean;
  controlsBlockers: boolean;
  mandatoryAttackers?: readonly string[];
  mandatoryBlockers?: Readonly<Record<string, readonly string[]>>;
  preventedAttackers?: readonly string[];
  preventedBlockers?: readonly string[];
}

/**
 * Helper to get combat control effect from game state (type-safe)
 */
function getCombatControl(game: any): CombatControlEffect | undefined {
  return game?.state?.combat?.combatControl as CombatControlEffect | undefined;
}

// Attack/block legality gates moved to ./combat-handlers/combatLegalityGates.js
// (imported at the top of this file).

/**
 * Helper to set combat control effect on game state
 */
function setCombatControl(game: any, combatControl: CombatControlEffect): void {
  if (!game.state.combat) {
    game.state.combat = {
      phase: 'declareAttackers',
      attackers: [],
      blockers: [],
    };
  }
  game.state.combat.combatControl = combatControl;
}


// processAttackTriggersAfterDeclaration moved to ./combat-handlers/combatDeclareAttackersSupport.js



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

    const canAttackCheck = canPermanentAttack(creature, battlefield, playerId);
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
    const ownerRestrictionReason = getOwnerAttackRestrictionReason(creature, defendingPlayerId, {
      targetIsOwnerPlaneswalker: isAttackingOwnerPlaneswalker(creature, attacker, battlefield),
    });
    if (ownerRestrictionReason) {
      throw Object.assign(
        new Error(`${(creature as any).card?.name || 'Creature'} ${ownerRestrictionReason.toLowerCase()}`),
        { code: 'CANT_ATTACK_OWNER' },
      );
    }

    if ((creature as any).tapped) {
      const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
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

    const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
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
    enqueueSupportedEnlistChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
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
  socket.on("declareAttackers", async (payload?: {
    gameId?: unknown;
    attackers?: unknown;
  }) => {
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
      
      // Check for Ghostly Prison, Windborn Muse, Propaganda, etc. effects
      // These require payment per attacking creature
      const attackCostPerDefender: Map<string, { cost: number; sources: string[] }> = new Map();
      
      for (const perm of battlefield) {
        const permController = (perm as any).controller;
        if (permController === playerId) continue; // Only opponents' effects matter
        
        const oracleText = ((perm as any).card?.oracle_text || "").toLowerCase();
        const cardName = ((perm as any).card?.name || "").toLowerCase();
        
        // Pattern: "Creatures can't attack you unless their controller pays {X} for each creature"
        // Ghostly Prison: "{2}"
        // Propaganda: "{2}"
        // Windborn Muse: "{2}"
        // Sphere of Safety: "{1} for each enchantment you control"
        // Norn's Annex: "{W/P}"
        // Baird, Steward of Argive: "{1}"
        
        let attackCost = 0;
        const costMatch = oracleText.match(/creatures can't attack you (?:or a planeswalker you control )?unless their controller pays \{(\d+)\}/i);
        
        if (costMatch) {
          attackCost = parseInt(costMatch[1], 10);
        } else if (cardName.includes('ghostly prison') || cardName.includes('propaganda')) {
          attackCost = 2; // Default for these known cards
        } else if (cardName.includes('windborn muse')) {
          attackCost = 2;
        } else if (cardName.includes('sphere of safety')) {
          // Count enchantments controlled by that player
          const enchantmentCount = battlefield.filter((p: any) => 
            p.controller === permController && 
            ((p.card?.type_line || '').toLowerCase().includes('enchantment'))
          ).length;
          attackCost = enchantmentCount;
        } else if (cardName.includes('baird, steward of argive')) {
          attackCost = 1;
        } else if (cardName.includes('norn\'s annex')) {
          attackCost = 2; // Or pay 2 life with Phyrexian mana
        } else if (cardName.includes('archangel of tithes')) {
          // {1} for each creature attacking you if Archangel is untapped
          if (!(perm as any).tapped) {
            attackCost = 1;
          }
        } else if (cardName.includes('war tax') || cardName.includes('pendrell mists') ||
                   (oracleText.includes("can't attack") && oracleText.includes("unless") && oracleText.includes("pays"))) {
          // Generic detection for other pillowfort effects
          const genericCostMatch = oracleText.match(/pays?\s*\{(\d+)\}/);
          if (genericCostMatch) {
            attackCost = parseInt(genericCostMatch[1], 10);
          }
        }
        
        if (attackCost > 0) {
          const existingCost = attackCostPerDefender.get(permController) || { cost: 0, sources: [] };
          existingCost.cost += attackCost;
          existingCost.sources.push((perm as any).card?.name || 'Unknown');
          attackCostPerDefender.set(permController, existingCost);
        }
      }
      
      // Calculate total attack cost based on which players are being attacked
      let totalAttackCostRequired = 0;
      const attackCostBreakdown: { playerId: string; cost: number; sources: string[] }[] = [];
      const attackCostByDefender = new Map<string, { cost: number; sources: string[] }>();
      
      for (const attacker of resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>) {
        const defendingPlayerId = resolveDefendingPlayerIdForAttackTarget(attacker, battlefield, players);
        if (defendingPlayerId && attackCostPerDefender.has(defendingPlayerId)) {
          const costInfo = attackCostPerDefender.get(defendingPlayerId)!;
          totalAttackCostRequired += costInfo.cost;
          const existing = attackCostByDefender.get(defendingPlayerId);
          if (existing) {
            existing.cost += costInfo.cost;
          } else {
            attackCostByDefender.set(defendingPlayerId, {
              cost: costInfo.cost,
              sources: [...costInfo.sources],
            });
          }
        }
      }

      for (const [playerIdKey, costInfo] of attackCostByDefender.entries()) {
        attackCostBreakdown.push({
          playerId: playerIdKey,
          cost: costInfo.cost,
          sources: costInfo.sources,
        });
      }
      
      for (const attacker of resolvedAttackers as Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>) {
        const targetPlayerId = String(attacker.targetPlayerId || '').trim();
        if (targetPlayerId) {
          const attackProhibitionSource = getAttackProhibitionSourceForPlayer(battlefield, targetPlayerId);
          if (attackProhibitionSource) {
            socket.emit('error', {
              code: 'ATTACK_PROHIBITED',
              message: `${getPlayerName(game, targetPlayerId)} can't be attacked while ${attackProhibitionSource} is on the battlefield.`,
            });
            return;
          }
        }

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
        // Pass battlefield and controller for proper devotion calculation (Gods)
        if (!isCurrentlyCreature(creature, battlefield, playerId)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(creature as any).card?.name || "This permanent"} is not a creature and cannot attack`,
          });
          return;
        }

        // Check for defender and "as though it didn't have defender" effects (Rule 508.1c)
        const canAttackCheck = canPermanentAttack(creature, battlefield, playerId);
        if (!canAttackCheck.canAttack) {
          socket.emit("error", {
            code: "CANT_ATTACK",
            message: `${(creature as any).card?.name || "Creature"} can't attack (${canAttackCheck.reason})`,
          });
          return;
        }

        const defendingPlayerId = resolveDefendingPlayerIdForAttackTarget(attacker, battlefield, players);
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
                .filter((p: any) => p?.id && p.id !== playerId && !p.hasLost)
                .map((p: any) => p.id);
              
              // Check if there are non-goader opponents available
              const nonGoaderOpponents = allOpponents.filter((oppId: string) => 
                !goadInfo.goaders.includes(oppId)
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
          const forcedOpponentStillActive = players.some((player: any) => String(player?.id || '') === forcedAttackPlayerId && !player?.hasLost);
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

      if (totalAttackCostRequired > 0) {
        const attackerIdsToExclude = resolvedAttackers.map((entry) => String(entry.creatureId || ''));
        const totalAvailable = getMaxGenericManaAvailable(game.state, playerId, {
          excludedPermanentIds: attackerIdsToExclude,
        });

        if (totalAvailable < totalAttackCostRequired) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA_FOR_ATTACK",
            message: `Cannot attack. Need to pay {${totalAttackCostRequired}} for ${attackCostBreakdown.map(b => b.sources.join(', ')).join('; ')}. You have {${totalAvailable}} available.`,
          });
          return;
        }

        const existingPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
          .find((step: any) => step?.attackCostPayment === true);

        if (!existingPrompt) {
          const attackCostStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            sourceName: 'Attack Cost',
            description: `Pay {${totalAttackCostRequired}} to attack (${attackCostBreakdown.map((entry) => entry.sources.join(', ')).join('; ')})`,
            mandatory: true,
            minSelections: 1,
            maxSelections: 1,
            options: [
              { id: 'pay_attack_cost', label: `Pay {${totalAttackCostRequired}} and attack` },
              { id: 'cancel_attack', label: 'Cancel attack' },
            ],
            attackCostPayment: true,
            attackCostAmount: totalAttackCostRequired,
            attackCostBreakdown,
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
  });

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

      // Mark that blockers have been declared (skipped) for this player
      // This allows step advancement to proceed past DECLARE_BLOCKERS
      const state = game.state as any;
      state.blockersDeclaredBy = state.blockersDeclaredBy || [];
      if (!state.blockersDeclaredBy.includes(playerId)) {
        state.blockersDeclaredBy.push(playerId);
        debug(1, `[combat] ${playerId} skipped declaring blockers`);
      } else {
        debug(1, `[combat] ${playerId} already declared/skipped blockers, ignoring duplicate skip`);
        return; // Already declared, don't do anything
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
  socket.on("declareControlledAttackers", async (payload?: {
    gameId?: unknown;
    attackers?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const attackersRaw = payload?.attackers;

    try {
      if (!gameId || typeof gameId !== 'string') {
        socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Missing gameId' } as any);
        return;
      }
      if (!Array.isArray(attackersRaw)) {
        socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Invalid attackers payload' } as any);
        return;
      }

      const attackers = attackersRaw
        .filter((entry: any) => entry && typeof entry === 'object')
        .map((entry: any) => ({
          creatureId: typeof entry.creatureId === 'string' ? entry.creatureId : null,
          targetPlayerId: typeof entry.targetPlayerId === 'string' ? entry.targetPlayerId : null,
        }));
      if (attackers.some((entry) => !entry.creatureId || !entry.targetPlayerId)) {
        socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Invalid attackers payload' } as any);
        return;
      }

      const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
      if (!playerId) {
        socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Player not identified' } as any);
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

      if (!combatControl.controlsAttackers) {
        socket.emit("error", {
          code: "NO_ATTACKER_CONTROL",
          message: "You don't control attacker declarations",
        });
        return;
      }

      const battlefield = game.state?.battlefield || [];
      const attackerIds: string[] = [];
      
      // Validate and set up each attacker
      for (const attacker of attackers) {
        const creature = battlefield.find((perm: any) => 
          perm.id === attacker.creatureId
        );
        
        if (!creature) {
          socket.emit("error", {
            code: "INVALID_ATTACKER",
            message: `Creature ${attacker.creatureId} not found`,
          });
          return;
        }

        // Check if permanent is a creature (includes devotion check for Gods)
        if (!isCurrentlyCreature(creature, battlefield, playerId)) {
          socket.emit("error", {
            code: "NOT_A_CREATURE",
            message: `${(creature as any).card?.name || "This permanent"} is not a creature`,
          });
          return;
        }

        // Check if creature can attack (not tapped, no summoning sickness unless haste)
        if ((creature as any).tapped) {
          socket.emit("error", {
            code: "CREATURE_TAPPED",
            message: `${(creature as any).card?.name || "Creature"} is tapped and cannot attack`,
          });
          return;
        }

        // Check defender keyword
        const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
        if (oracleText.includes("defender")) {
          socket.emit("error", {
            code: "HAS_DEFENDER",
            message: `${(creature as any).card?.name || "Creature"} has defender and cannot attack`,
          });
          return;
        }

        // Check summoning sickness
        if (permanentHasSummoningSickness(creature, battlefield, playerId)) {
          socket.emit("error", {
            code: "SUMMONING_SICKNESS",
            message: `${(creature as any).card?.name || "Creature"} has summoning sickness`,
          });
          return;
        }

        attackerIds.push(attacker.creatureId);
        
        // Mark creature as attacking
        (creature as any).attacking = attacker.targetPlayerId;
        
        // Tap the attacker (unless it has vigilance)
        const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
        if (!hasVigilance) {
          (creature as any).tapped = true;
        }
      }

      try {
        enqueueSupportedExertChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
        enqueueSupportedEnlistChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
      } catch (e) {
        debugWarn(1, '[combat] Failed to enqueue controlled attack-time choice steps:', e);
      }

      // Process tap triggers for creatures that became tapped from attacking
      processTapTriggersForAttackers(io, game, gameId, attackers, battlefield, playerId);

      // Update combat state
      game.state.combat = {
        ...game.state.combat!,
        phase: 'declareAttackers',
        attackers: attackers.map(a => ({
          permanentId: a.creatureId,
          defending: a.targetPlayerId,
          blockedBy: [],
        })),
      };

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "declareControlledAttackers", {
          playerId,
          attackers,
          combatControl: combatControl.sourceName,
        });
      } catch (e) {
        debugWarn(1, "[combat] Failed to persist declareControlledAttackers event:", e);
      }

      emitDeclareAttackersChat(
        io,
        gameId,
        game,
        playerId,
        attackers,
        `🎯 ${combatControl.sourceName}: `,
      );

      // Process attack triggers for controlled combat declarations
      try {
        const attackingCreatures = battlefield.filter((perm: any) => attackerIds.includes(perm.id));
        const firstDefender = getDefendingPlayerIdFromAttackDeclaration(attackers, battlefield);

        if (attackingCreatures.length > 0 && firstDefender) {
          const ctx = {
            state: game.state,
            bumpSeq: () => {
              if (typeof (game as any).bumpSeq === "function") {
                (game as any).bumpSeq();
              }
            }
          };

          const triggers = orderTriggersByAPNAP(
            ctx as any,
            getAttackTriggersForCreatures(
              ctx as any,
              attackingCreatures,
              playerId,
              firstDefender
            ).map((trigger, originalIndex) => ({
              controllerId: String((trigger as any).controllerId || playerId || ''),
              originalIndex,
              trigger,
            }))
          ).map((entry: any) => entry.trigger);

          if (triggers.length > 0) {
            debug(2, `[combat] Found ${triggers.length} controlled attack trigger(s) for game ${gameId}`);

            for (const trigger of triggers) {
              const triggerControllerId = ((trigger as any).controllerId || playerId) as PlayerID;
              try {
                const controller = String(triggerControllerId);
                const sourcePerm = battlefield.find((p: any) => p?.id === (trigger as any).permanentId);

                const raw = String(trigger.description || (trigger as any).effect || '').trim();
                let textForEval = raw;
                const hasTriggerPrefix = /^(?:when|whenever|at)\b/i.test(textForEval);
                if (!hasTriggerPrefix) {
                  const oracleLower = String(sourcePerm?.card?.oracle_text || '').toLowerCase();
                  if (oracleLower.includes('attacks a player')) {
                    textForEval = `Whenever ~ attacks a player, ${textForEval}`;
                  } else {
                    textForEval = `Whenever ~ attacks, ${textForEval}`;
                  }
                }

                const valueObj = (trigger as any).value && typeof (trigger as any).value === 'object' ? (trigger as any).value : undefined;
                const defendingPlayerId = String(
                  valueObj?.defendingPlayerId ||
                    valueObj?.defendingPlayer ||
                    (sourcePerm && typeof (sourcePerm as any).attacking === 'string' ? (sourcePerm as any).attacking : '') ||
                    firstDefender ||
                    ''
                );

                const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);

                const ok = isInterveningIfSatisfied(
                  ctx as any,
                  controller,
                  textForEval,
                  sourcePerm,
                  defendingPlayerId
                    ? {
                        defendingPlayerId,
                        thoseCreatureIds: attackerIds,
                        ...(needsThatPlayerRef
                          ? {
                              thatPlayerId: defendingPlayerId,
                              referencedPlayerId: defendingPlayerId,
                              theirPlayerId: defendingPlayerId,
                            }
                          : {}),
                      }
                    : undefined
                );
                if (ok === false) {
                  debug(2, `[combat] Skipping controlled attack trigger due to unmet intervening-if: ${trigger.cardName} - ${trigger.description}`);
                  continue;
                }
              } catch {
                // Conservative fallback: keep the trigger if evaluation fails.
              }

              if ((trigger.manaCost || (trigger as any).energyCost) && !trigger.mandatory) {
                const permanent = battlefield.find((p: any) => p?.id === trigger.permanentId);
                const cardImageUrl =
                  permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal;
                const energyCost = Number((trigger as any).energyCost || 0);
                const paymentCost = energyCost > 0 ? formatEnergyCost(energyCost) : String(trigger.manaCost || '');
                const validationKind = energyCost > 0 ? 'energy' : 'mana';
                const payChoiceId = energyCost > 0 ? 'pay_energy' : 'pay_mana';

                queueOptionalPaymentStep(gameId, {
                  playerId: triggerControllerId,
                  sourceId: String(trigger.permanentId || ''),
                  sourceName: trigger.cardName,
                  sourceImage: cardImageUrl,
                  description: trigger.description || `${trigger.cardName}: You may pay ${paymentCost}.`,
                  mandatory: false,
                  minSelections: 0,
                  maxSelections: 1,
                  priority: -1,
                  payChoiceId,
                  payLabel: `Pay ${paymentCost}`,
                  payDescription: `If you do: ${trigger.effect || 'resolve effect'}`,
                  declineChoiceId: 'decline',
                  declineLabel: 'Decline',
                  declineDescription: 'Do not pay the optional cost.',
                  validationKind,
                  manaCost: energyCost > 0 ? undefined : trigger.manaCost,
                  energyAmount: energyCost > 0 ? energyCost : undefined,
                  stepData: {
                    attackTriggerManaPaymentChoice: true,
                    permanentId: trigger.permanentId,
                    cardName: trigger.cardName,
                    manaCost: energyCost > 0 ? undefined : trigger.manaCost,
                    energyCost: energyCost > 0 ? energyCost : undefined,
                    effect: trigger.effect,
                    triggerDescription: trigger.description,
                  },
                  onPay: async () => {
                    resolveAttackTriggerManaPaymentChoice(
                      io,
                      game,
                      gameId,
                      triggerControllerId as any,
                      {
                        permanentId: String(trigger.permanentId || ''),
                        cardName: String(trigger.cardName || ''),
                        effect: String(trigger.effect || ''),
                        manaCost: String(trigger.manaCost || paymentCost || ''),
                        energyCost: energyCost > 0 ? energyCost : undefined,
                        description: String(trigger.description || ''),
                      },
                      true
                    );
                  },
                  onDecline: async () => {
                    resolveAttackTriggerManaPaymentChoice(
                      io,
                      game,
                      gameId,
                      triggerControllerId as any,
                      {
                        permanentId: String(trigger.permanentId || ''),
                        cardName: String(trigger.cardName || ''),
                        effect: String(trigger.effect || ''),
                        manaCost: String(trigger.manaCost || paymentCost || ''),
                        energyCost: energyCost > 0 ? energyCost : undefined,
                        description: String(trigger.description || ''),
                      },
                      false
                    );
                  },
                });

                debug(
                  2,
                  `[combat] Enqueued controlled attack trigger mana payment choice for ${trigger.cardName}: ${trigger.manaCost} to ${trigger.effect}`
                );
              } else {
                game.state.stack = game.state.stack || [];
                const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
                const triggerEffectText = String((trigger as any).effect || trigger.description || '').trim();
                const targetMetadata = inferTriggeredAbilityTargetMetadata(triggerEffectText || String(trigger.description || ''), {
                  gameState: game.state,
                  controllerId: String(triggerControllerId),
                  sourceName: String(trigger.cardName || sourcePerm?.card?.name || ''),
                  sourcePermanent: sourcePerm,
                } as any);
                const stackItem: any = {
                  id: triggerId,
                  type: 'triggered_ability',
                  controller: triggerControllerId,
                  source: trigger.permanentId,
                  permanentId: trigger.permanentId,
                  sourceName: trigger.cardName,
                  description: trigger.description,
                  effect: triggerEffectText,
                  triggerType: trigger.triggerType,
                  mandatory: trigger.mandatory,
                  triggeringPlayer: playerId,
                  ...(targetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                  ...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),
                  ...(targetMetadata.targetConstraint ? { targetConstraint: targetMetadata.targetConstraint } : null),
                  ...(targetMetadata.targetZone ? { targetZone: targetMetadata.targetZone } : null),
                  ...(targetMetadata.targetDestination ? { targetDestination: targetMetadata.targetDestination } : null),
                  ...(targetMetadata.targetGraveyardScope ? { targetGraveyardScope: targetMetadata.targetGraveyardScope } : null),
                  ...(targetMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
                  ...(targetMetadata.battlefieldControllerMode ? { battlefieldControllerMode: targetMetadata.battlefieldControllerMode } : null),
                  ...(targetMetadata.battlefieldCounters ? { battlefieldCounters: targetMetadata.battlefieldCounters } : null),
                  ...(targetMetadata.targetAction ? { targetAction: targetMetadata.targetAction } : null),
                  ...(Array.isArray(targetMetadata.targetFilterTypes) ? { targetFilterTypes: targetMetadata.targetFilterTypes } : null),
                  ...(Array.isArray(targetMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: targetMetadata.targetFilterRequiredTypeWords } : null),
                  ...(Array.isArray(targetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: targetMetadata.targetFilterExcludeTypes } : null),
                  ...(targetMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
                  ...(typeof targetMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: targetMetadata.targetFilterExactManaValue } : null),
                  ...(typeof targetMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: targetMetadata.targetFilterMinManaValue } : null),
                  ...(typeof targetMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: targetMetadata.targetFilterMaxManaValue } : null),
                  ...(typeof targetMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: targetMetadata.targetTotalPowerLimit } : null),
                  ...(targetMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
                  ...(targetMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
                  ...(typeof targetMetadata.minTargets === 'number' ? { minTargets: targetMetadata.minTargets } : null),
                  ...(typeof targetMetadata.maxTargets === 'number' ? { maxTargets: targetMetadata.maxTargets } : null),
                };

                if (typeof trigger.value === 'number') {
                  stackItem.value = trigger.value;
                } else if (typeof trigger.value === 'object') {
                  stackItem.effectData = trigger.value;
                }

                const effectData = stackItem.effectData && typeof stackItem.effectData === 'object' ? stackItem.effectData : undefined;
                const defendingPlayerId = String(
                  (effectData as any)?.defendingPlayerId ||
                    (effectData as any)?.defendingPlayer ||
                    (sourcePerm && typeof (sourcePerm as any).attacking === 'string' ? (sourcePerm as any).attacking : '') ||
                    firstDefender ||
                    ''
                );
                if (defendingPlayerId) {
                  stackItem.defendingPlayer = defendingPlayerId;
                  stackItem.targetPlayer = defendingPlayerId;
                  if (effectData) {
                    (effectData as any).defendingPlayer = (effectData as any).defendingPlayer || defendingPlayerId;
                    (effectData as any).defendingPlayerId = (effectData as any).defendingPlayerId || defendingPlayerId;
                  }
                }
                const attackingPlayerId = String(
                  (effectData as any)?.attackingPlayerId
                    || ((trigger.triggerType as string) === 'player_attacks_your_opponent' ? playerId : ''),
                ).trim();
                if (attackingPlayerId) {
                  stackItem.attackingPlayerId = attackingPlayerId;
                  if (effectData) {
                    (effectData as any).attackingPlayerId = (effectData as any).attackingPlayerId || attackingPlayerId;
                  } else {
                    stackItem.effectData = { attackingPlayerId, defendingPlayerId: defendingPlayerId || undefined };
                  }
                }

                game.state.stack.push(stackItem);
                persistTriggeredAbilityPush(gameId, game, {
                  triggerId,
                  sourceId: trigger.permanentId,
                  permanentId: trigger.permanentId,
                  sourceName: trigger.cardName,
                  controllerId: triggerControllerId,
                  description: trigger.description,
                  triggerType: trigger.triggerType,
                  effect: String((trigger as any).effect || trigger.description || '').trim(),
                  mandatory: trigger.mandatory,
                  triggeringPlayer: playerId,
                  ...(targetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                  ...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),
                  ...(targetMetadata.targetConstraint ? { targetConstraint: targetMetadata.targetConstraint } : null),
                  ...(targetMetadata.targetZone ? { targetZone: targetMetadata.targetZone } : null),
                  ...(targetMetadata.targetDestination ? { targetDestination: targetMetadata.targetDestination } : null),
                  ...(targetMetadata.targetGraveyardScope ? { targetGraveyardScope: targetMetadata.targetGraveyardScope } : null),
                  ...(targetMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
                  ...(targetMetadata.battlefieldControllerMode ? { battlefieldControllerMode: targetMetadata.battlefieldControllerMode } : null),
                  ...(targetMetadata.battlefieldCounters ? { battlefieldCounters: targetMetadata.battlefieldCounters } : null),
                  ...(targetMetadata.targetAction ? { targetAction: targetMetadata.targetAction } : null),
                  ...(Array.isArray(targetMetadata.targetFilterTypes) ? { targetFilterTypes: targetMetadata.targetFilterTypes } : null),
                  ...(Array.isArray(targetMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: targetMetadata.targetFilterRequiredTypeWords } : null),
                  ...(Array.isArray(targetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: targetMetadata.targetFilterExcludeTypes } : null),
                  ...(targetMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
                  ...(typeof targetMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: targetMetadata.targetFilterExactManaValue } : null),
                  ...(typeof targetMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: targetMetadata.targetFilterMinManaValue } : null),
                  ...(typeof targetMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: targetMetadata.targetFilterMaxManaValue } : null),
                  ...(typeof targetMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: targetMetadata.targetTotalPowerLimit } : null),
                  ...(targetMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
                  ...(targetMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
                  ...(typeof targetMetadata.minTargets === 'number' ? { minTargets: targetMetadata.minTargets } : null),
                  ...(typeof targetMetadata.maxTargets === 'number' ? { maxTargets: targetMetadata.maxTargets } : null),
                  ...(typeof stackItem.value !== 'undefined' ? { value: stackItem.value } : {}),
                  ...(stackItem.effectData && typeof stackItem.effectData === 'object' ? { effectData: stackItem.effectData } : {}),
                  ...(stackItem.targetPlayer ? { targetPlayer: stackItem.targetPlayer } : {}),
                  ...(stackItem.defendingPlayer ? { defendingPlayer: stackItem.defendingPlayer } : {}),
                }, `controlled attack ${trigger.triggerType || 'trigger'}`);

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
        }
      } catch (triggerErr) {
        debugWarn(1, "[combat] Error processing controlled attack triggers:", triggerErr);
      }

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);

      debug(2, `[combat] Player ${playerId} declared ${attackers.length} controlled attackers in game ${gameId}`);
      
    } catch (err: any) {
      debugError(1, `[combat] declareControlledAttackers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CONTROLLED_ATTACKERS_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

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
        const attackerText = ((attackerCreature as any).card?.oracle_text || "").toLowerCase();
        const blockerText = ((blockerCreature as any).card?.oracle_text || "").toLowerCase();
        
        // Flying
        if (attackerText.includes("flying") || 
            ((attackerCreature as any).card?.keywords || []).some((k: string) => k.toLowerCase() === 'flying')) {
          const hasFlying = blockerText.includes("flying") || 
            ((blockerCreature as any).card?.keywords || []).some((k: string) => k.toLowerCase() === 'flying');
          const hasReach = blockerText.includes("reach") ||
            ((blockerCreature as any).card?.keywords || []).some((k: string) => k.toLowerCase() === 'reach');
          if (!hasFlying && !hasReach) {
            socket.emit("error", {
              code: "CANT_BLOCK_FLYING",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (flying)`,
            });
            return;
          }
        }
        
        // Shadow
        if (attackerText.includes("shadow")) {
          if (!blockerText.includes("shadow")) {
            socket.emit("error", {
              code: "CANT_BLOCK_SHADOW",
              message: `${(blockerCreature as any).card?.name} can't block ${(attackerCreature as any).card?.name} (shadow)`,
            });
            return;
          }
        }
        
        // Horsemanship
        if (attackerText.includes("horsemanship")) {
          if (!blockerText.includes("horsemanship")) {
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

