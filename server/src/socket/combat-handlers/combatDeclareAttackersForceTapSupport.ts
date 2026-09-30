// server/src/socket/combat-handlers/combatDeclareAttackersForceTapSupport.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: exert/enlist optional-choice enqueue, goad status, forced-attack
//   violation check, and tap-trigger processing that executeDeclareAttackers and
//   the declare-attackers sockets close over.
// Public entry symbols: enqueueSupportedExertChoiceSteps,
//   enqueueSupportedEnlistChoiceSteps, getCreatureGoadStatus,
//   findForcedAttackViolation, resolveForcedAttackerDeclarations,
//   processTapTriggersForAttackers.

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import {
  hasBlanketCantAttack,
  permanentHasMustAttackRequirement,
} from "../../../../rules-engine/src/attackRestrictionText.js";
import { buildTapTriggeredStackItem, collectTapTriggersForTapEvent, serializeTapTriggeredStackItem } from "../../state/modules/triggers/tap-untap.js";
import { canExertAsItAttacks, getSupportedExertAttackReward } from "../../state/modules/triggers/combat.js";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if.js";
import { getCurrentGoaders } from "../../state/modules/goad-effects.js";
import { permanentHasKeyword, permanentHasSummoningSickness } from "../game-actions.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { broadcastGame, getEffectivePower, getEffectiveToughness } from "../util.js";
import {
  isCurrentlyCreature,
  canPermanentAttack,
} from "./combatLegalityGates.js";
import { hasLegalMustAttackDefender } from "./combatDeclareAttackersSupport.js";
import { getGoadedAttackTargets } from "../../../../rules-engine/src/actions/combat-handlers/combatGoadHelpers.js";
import { getNearestOpponentDirectionAllowedDefenderId } from "../../state/modules/nearestOpponentDirectionAttackRestriction.js";
import { playerIsLegalAttackTarget } from "../../../../rules-engine/src/playerInGameStatus.js";

export function enqueueSupportedExertChoiceSteps(
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

export function enqueueSupportedEnlistChoiceSteps(
  gameId: string,
  battlefield: any[],
  decisionPlayerId: string,
  attackerIds: string[],
  gameState?: unknown,
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
        label: `${p.card?.name || 'Creature'} (${getEffectivePower(p, gameState)}/${getEffectiveToughness(p, gameState)})`,
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
export function getCreatureGoadStatus(
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

export type ForcedAttackerDeclaration = {
  creatureId: string;
  defendingPlayerId: string;
};

type ForcedAttackKind = 'goad' | 'mustAttack';

type ForcedAttackEntry = {
  perm: any;
  kind: ForcedAttackKind;
};

function creatureCanBeForcedToAttack(
  perm: any,
  battlefield: any[],
  playerId: PlayerID,
  players: any[],
  gameState?: unknown,
): boolean {
  if ((perm as any).tapped) return false;
  if (permanentHasKeyword(perm, battlefield, playerId, 'defender')) return false;
  if (hasBlanketCantAttack(perm.card?.oracle_text || '')) return false;
  if (permanentHasSummoningSickness(perm, battlefield, playerId)) return false;
  if (!canPermanentAttack(perm, battlefield, playerId, gameState).canAttack) return false;
  return (Array.isArray(players) ? players : []).some(
    (player: any) => playerIsLegalAttackTarget(player, playerId),
  );
}

function isActiveCombatPlayer(player: any): boolean {
  return playerIsLegalAttackTarget(player);
}

function collectForcedAttackEntries(game: any, playerId: PlayerID): ForcedAttackEntry[] {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const currentTurn = Number((game?.state as any)?.turn || 0);
  const players = Array.isArray((game?.state as any)?.players) ? (game.state as any).players : [];
  const entries: ForcedAttackEntry[] = [];

  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    if (!isCurrentlyCreature(perm, battlefield, playerId)) continue;
    if (!creatureCanBeForcedToAttack(perm, battlefield, playerId, players, game?.state)) continue;
    const allowedDefenderId = getNearestOpponentDirectionAllowedDefenderId(game.state, playerId);
    if (allowedDefenderId === null) continue;

    const goadInfo = getCreatureGoadStatus(perm, battlefield, playerId, currentTurn);
    if (goadInfo.isGoaded) {
      entries.push({ perm, kind: 'goad' });
      continue;
    }

    if (
      permanentHasMustAttackRequirement(perm, battlefield) &&
      hasLegalMustAttackDefender(perm, playerId, players)
    ) {
      entries.push({ perm, kind: 'mustAttack' });
    }
  }

  return entries;
}

function pickForcedAttackDefender(
  game: any,
  playerId: PlayerID,
  perm: any,
): string {
  const players = Array.isArray((game?.state as any)?.players) ? (game.state as any).players : [];
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const currentTurn = Number((game?.state as any)?.turn || 0);
  const activeIds = players.filter(isActiveCombatPlayer).map((player: any) => String(player.id));
  const encoreId = String((perm as any).encoreAttackPlayerId || '').trim();
  if (encoreId && encoreId !== playerId && activeIds.includes(encoreId)) {
    return encoreId;
  }

  const allowedDefenderId = getNearestOpponentDirectionAllowedDefenderId(game.state, playerId);
  let candidates = getGoadedAttackTargets(perm, activeIds, currentTurn, battlefield);
  if (typeof allowedDefenderId === 'string' && allowedDefenderId) {
    const directionMatches = candidates.filter((id) => id === allowedDefenderId);
    candidates = directionMatches.length > 0 ? directionMatches : [allowedDefenderId];
  }

  if (candidates.length === 0) {
    candidates = activeIds.filter((id) => id !== playerId);
  }

  return candidates.reduce((lowest, current) => {
    const currentLife = players.find((player: any) => player.id === current)?.life ?? 40;
    const lowestLife = players.find((player: any) => player.id === lowest)?.life ?? 40;
    return currentLife < lowestLife ? current : lowest;
  }, candidates[0] || '');
}

/**
 * Rule 701.15b / 701.38b: goaded creatures (and "attacks each combat if able")
 * must be declared as attackers when they are able.
 */
export function findForcedAttackViolation(
  game: any,
  playerId: PlayerID,
  attackerIds: readonly string[],
): ForcedAttackViolation | null {
  const attacking = new Set(attackerIds.map((id) => String(id)));
  const missing = collectForcedAttackEntries(game, playerId)
    .filter((entry) => !attacking.has(String(entry.perm.id)));

  const goadedNames = missing
    .filter((entry) => entry.kind === 'goad')
    .map((entry) => entry.perm.card?.name || 'Unknown');
  const mustAttackNames = missing
    .filter((entry) => entry.kind === 'mustAttack')
    .map((entry) => entry.perm.card?.name || 'Unknown');

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
 * Build legal attacker declarations for every creature that must attack if able.
 * Used by AI so empty/hold-back plans still satisfy Rule 701.15b / 701.38b.
 */
export function resolveForcedAttackerDeclarations(
  game: any,
  playerId: PlayerID,
): ForcedAttackerDeclaration[] {
  const declarations: ForcedAttackerDeclaration[] = [];
  for (const entry of collectForcedAttackEntries(game, playerId)) {
    const defendingPlayerId = pickForcedAttackDefender(game, playerId, entry.perm);
    if (!defendingPlayerId) continue;
    declarations.push({
      creatureId: String(entry.perm.id),
      defendingPlayerId,
    });
  }
  return declarations;
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
export function processTapTriggersForAttackers(
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


