// server/src/state/modules/turn-handlers/combatSpecialDamageAssignment.ts
// Cunning Giant family: unblocked, you may assign all combat damage to a
// creature the defending player controls (cancel = damage the player).
// Butcher Orgg family: divide combat damage among the defending player and/or
// any number of creatures they control. Detected by oracle pattern, not card
// name. Public: maybeQueueSpecialCombatDamageAssignments,
// applySpecialCombatDamageAssignmentResponse,
// applyResolvedSpecialCombatDamageAssignment.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { normalizeOraclePatternText, readCardOracleText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { applyCreatureCombatDamageFromSource, resolvePlayerCombatDamage } from '../combat-damage-processing.js';
import { applyCombatDamagePreventionEffects, getCombatCreatureStats } from './turnCombatDamageStatsPrevention.js';
import { applyLifeGainViaProcessLifeChange } from './turnCombatDamageLifeGain.js';
import { modifyCombatDamageToPermanentAmount } from './turnCombatDamagePermanentApply.js';
import { queueDamageReceivedTrigger } from './turnCombatDamageReceivedQueue.js';
import { trackCommanderDamage, trackCreatureDamageToPlayer } from './turnCombatDamageTracking.js';
import { resolveCombatDamageToOpponent } from '../game-state-effects.js';
import { combatDamagePreventedThisTurnLogged } from './turnCombatDamagePreventedThisTurnLog.js';
import { maybeQueueDefensiveFormationAssignments } from './combatDefensiveFormationAssignment.js';
import type { DealCombatDamageResult } from './turnCombatDamageAttackerLoop.js';

export const REDIRECT_UNBLOCKED_RE =
  /if (?:this creature|it|.+) is unblocked, you may (?:have it )?assign (?:this creature's |its )?combat damage to a creature (?:the |a )?defending player controls/i;

export const DIVIDE_DEFENDER_RE =
  /(?:can|may) assign (?:this creature's |its )?combat damage divided as you choose among (?:the )?defending player and\/?or any number of creatures (?:they|that player) control/i;

function oracleOf(perm: any): string {
  return normalizeOraclePatternText(readCardOracleText(perm?.card || perm) || '').replace(/\u2019/g, "'");
}

export type SpecialCombatDamageAssignment =
  | { kind: 'default' }
  | { kind: 'redirect-all-to-creature'; targetId: string }
  | { kind: 'divide'; shares: Array<{ target: 'player' | string; amount: number }> };

function defendingPlayerIdOf(attacker: any, battlefield: any[]): string {
  const defendingTarget = String(attacker?.attacking || '').trim();
  if (!defendingTarget) return '';
  const defendingPermanent = (battlefield || []).find((perm: any) => String(perm?.id || '') === defendingTarget);
  if (defendingPermanent) return String(defendingPermanent.controller || '').trim();
  return defendingTarget;
}

function defenderCreatures(battlefield: any[], defenderId: string, excludeId?: string): any[] {
  return (battlefield || []).filter((perm: any) => {
    const id = String(perm?.id || '').trim();
    if (!id || (excludeId && id === excludeId)) return false;
    if (String(perm.controller || '').trim() !== defenderId) return false;
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  });
}

export function maybeQueueSpecialCombatDamageAssignments(
  ctx: GameContext,
  attackers: any[],
  battlefield: any[],
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  const list = Array.isArray(attackers) ? attackers : [];
  for (const attacker of list) {
    if (!attacker || attacker.markedForDestruction) continue;
    if (attacker._specialCombatDamageAssignment) continue;
    const text = oracleOf(attacker);
    const defenderId = defendingPlayerIdOf(attacker, battlefield);
    if (!defenderId) continue;
    const blockedBy = Array.isArray(attacker.blockedBy) ? attacker.blockedBy : [];
    const creatures = defenderCreatures(battlefield, defenderId, String(attacker.id || ''));

    if (DIVIDE_DEFENDER_RE.test(text)) {
      const recipients = [
        { id: `player:${defenderId}`, label: 'Defending player', type: 'player', playerId: defenderId },
        ...creatures.map((perm: any) => ({
          id: String(perm.id),
          label: String(perm.card?.name || 'Creature'),
          type: 'creature',
          toughness: Number(perm.card?.toughness || 0),
          image: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        })),
      ];
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COMBAT_DAMAGE_ASSIGNMENT,
        playerId: String(attacker.controller || '') as PlayerID,
        description: `${String(attacker.card?.name || 'Creature')} assigns its combat damage divided as you choose among the defending player and/or any number of creatures they control.`,
        mandatory: true,
        sourceId: String(attacker.id || ''),
        sourceName: String(attacker.card?.name || 'Creature'),
        specialCombatDamageAssignment: true,
        specialCombatDamageMode: 'divide',
        attackerId: String(attacker.id || ''),
        defendingPlayerId: defenderId,
        assignmentMode: 'free-division',
        requireLethalOrder: false,
        recipients,
      } as any);
      return true;
    }

    if (REDIRECT_UNBLOCKED_RE.test(text) && blockedBy.length === 0 && creatures.length > 0) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: String(attacker.controller || '') as PlayerID,
        description: `${String(attacker.card?.name || 'Creature')} is unblocked. You may assign its combat damage to a creature the defending player controls (cancel to assign it to the defending player).`,
        mandatory: false,
        sourceId: String(attacker.id || ''),
        sourceName: String(attacker.card?.name || 'Creature'),
        validTargets: creatures.map((perm: any) => ({
          id: String(perm.id),
          label: String(perm.card?.name || 'Creature'),
          description: String(perm.card?.type_line || ''),
          image: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        })),
        targetTypes: ['creature'],
        minTargets: 0,
        maxTargets: 1,
        targetDescription: "a creature the defending player controls",
        specialCombatDamageAssignment: true,
        specialCombatDamageMode: 'redirect-unblocked',
        attackerId: String(attacker.id || ''),
        defendingPlayerId: defenderId,
      } as any);
      return true;
    }
  }
  return maybeQueueDefensiveFormationAssignments(ctx, attackers, battlefield);
}

export function applySpecialCombatDamageAssignmentResponse(
  ctx: GameContext,
  event: {
    attackerId?: string;
    mode?: string;
    cancelled?: boolean;
    targetId?: string;
    shares?: Array<{ target: string; amount: number }>;
    isFirstStrikePhase?: boolean;
  },
): { applied: boolean } {
  const attackerId = String(event?.attackerId || '').trim();
  if (!attackerId || !ctx) return { applied: false };
  const battlefield = Array.isArray((ctx as any)?.state?.battlefield) ? (ctx as any).state.battlefield : [];
  const attacker = battlefield.find((perm: any) => String(perm?.id || '').trim() === attackerId);
  if (!attacker) return { applied: false };

  const mode = String(event?.mode || '').trim();
  if (mode === 'redirect-unblocked') {
    const targetId = String(event?.targetId || '').trim();
    attacker._specialCombatDamageAssignment = (!event?.cancelled && targetId)
      ? { kind: 'redirect-all-to-creature', targetId }
      : { kind: 'default' };
  } else if (mode === 'divide' || mode === 'defensive-formation') {
    const shares = Array.isArray(event?.shares) ? event.shares : [];
    attacker._specialCombatDamageAssignment = {
      kind: 'divide',
      shares: shares
        .map((share) => ({
          target: String(share?.target || '').startsWith('player:') ? 'player' as const : String(share?.target || ''),
          amount: Math.max(0, Math.floor(Number(share?.amount || 0))),
        }))
        .filter((share) => share.amount > 0 && share.target),
    };
  } else {
    attacker._specialCombatDamageAssignment = { kind: 'default' };
  }

  delete (ctx as any)._combatDamageAssignmentPending;
  return { applied: true };
}

export function applyResolvedSpecialCombatDamageAssignment(
  ctx: GameContext,
  args: {
    attacker: any;
    battlefield: any[];
    state: any;
    life: Record<string, number>;
    startingLife: number;
    result: DealCombatDamageResult;
    keywords: any;
    attackerPower: number;
    attackerController: string;
    attackerCanAssignDamage: boolean;
    defendingTarget: string;
  },
): 'applied' | 'redirect-blocked' | 'none' {
  const assignment: SpecialCombatDamageAssignment | undefined = args.attacker?._specialCombatDamageAssignment;
  if (!assignment) return 'none';
  if (assignment.kind === 'default') return 'none';
  if (assignment.kind === 'redirect-all-to-creature') return 'redirect-blocked';
  if (assignment.kind !== 'divide' || !args.attackerCanAssignDamage) return 'none';

  const defenderId = defendingPlayerIdOf(args.attacker, args.battlefield) || String(args.defendingTarget || '');
  for (const share of assignment.shares) {
    if (share.amount <= 0) continue;
    if (share.target === 'player') {
      dealShareToPlayer(ctx, args, defenderId, share.amount);
    } else {
      const creature = args.battlefield.find((perm: any) => String(perm?.id || '') === share.target);
      if (creature) dealShareToCreature(ctx, args, creature, share.amount);
    }
  }
  return 'applied';
}

export function specialRedirectTargetId(attacker: any): string {
  const assignment: SpecialCombatDamageAssignment | undefined = attacker?._specialCombatDamageAssignment;
  return assignment?.kind === 'redirect-all-to-creature' ? assignment.targetId : '';
}

function dealShareToPlayer(ctx: GameContext, args: any, defendingPlayerId: string, amount: number): void {
  if (!defendingPlayerId || amount <= 0) return;
  const { attacker, state, life, startingLife, result, keywords, attackerController } = args;
  const card = attacker.card || {};
  const replacementResult = resolveCombatDamageToOpponent(ctx, {
    attackerCard: card,
    attackerPermanent: attacker,
    attackerController,
    damageAmount: amount,
    defendingPlayerId,
  } as any);
  let actualDamage = Number((replacementResult as any)?.damageDealt ?? amount);
  if (combatDamagePreventedThisTurnLogged(ctx, { id: defendingPlayerId } as any, attacker, actualDamage)) return;
  const preventionResult = applyCombatDamagePreventionEffects(ctx, actualDamage, String(attacker.id || ''), card, { targetPlayerId: defendingPlayerId });
  if ((preventionResult as any)?.prevented > 0) actualDamage = Number((preventionResult as any).remainingDamage ?? actualDamage);
  if (actualDamage <= 0) return;
  const resolved = resolvePlayerCombatDamage(ctx, attacker, defendingPlayerId, actualDamage);
  const applied = Number((resolved as any)?.damageDealt ?? actualDamage);
  result.damageToPlayers[defendingPlayerId] = (result.damageToPlayers[defendingPlayerId] || 0) + applied;
  result.attackersThatDealtDamage = result.attackersThatDealtDamage || {};
  result.attackersThatDealtDamage[defendingPlayerId] = result.attackersThatDealtDamage[defendingPlayerId] || new Set();
  result.attackersThatDealtDamage[defendingPlayerId].add(attacker.id);
  result.attackerDamageToPlayers = result.attackerDamageToPlayers || {};
  result.attackerDamageToPlayers[defendingPlayerId] = result.attackerDamageToPlayers[defendingPlayerId] || {};
  result.attackerDamageToPlayers[defendingPlayerId][attacker.id] =
    (result.attackerDamageToPlayers[defendingPlayerId][attacker.id] || 0) + applied;
  try {
    if (applied > 0) {
      (state as any).damageTakenThisTurnByPlayer = (state as any).damageTakenThisTurnByPlayer || {};
      (state as any).damageTakenThisTurnByPlayer[defendingPlayerId] =
        ((state as any).damageTakenThisTurnByPlayer[defendingPlayerId] || 0) + applied;
    }
  } catch {}
  void life;
  void startingLife;
  if (keywords?.lifelink && applied > 0) {
    const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, attackerController as PlayerID, applied, `${card.name || 'Attacker'} (lifelink)`);
    result.lifeGainForPlayers[attackerController] = (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
  }
  trackCommanderDamage(ctx, attackerController, card, attacker, defendingPlayerId, applied);
  trackCreatureDamageToPlayer(ctx, attacker.id, card.name || 'Unknown Creature', defendingPlayerId, applied);
}

function dealShareToCreature(ctx: GameContext, args: any, creature: any, amount: number): void {
  if (!creature || amount <= 0) return;
  const { attacker, result, keywords, attackerController } = args;
  const card = attacker.card || {};
  if (combatDamagePreventedThisTurnLogged(ctx, creature, attacker, amount)) return;
  const modified = modifyCombatDamageToPermanentAmount(ctx, amount, attacker, creature);
  const preventionResult = applyCombatDamagePreventionEffects(ctx, modified, String(attacker.id || ''), card, { targetPermanentId: String(creature.id || '') });
  const remaining = Number((preventionResult as any)?.remainingDamage ?? modified);
  if (remaining <= 0) return;
  const damageResult = applyCreatureCombatDamageFromSource(ctx, attacker, creature, remaining);
  const applied = Number((damageResult as any)?.appliedAmount ?? remaining);
  if (applied > 0) {
    queueDamageReceivedTrigger(ctx, creature, applied);
    if (keywords?.lifelink) {
      const lifeGainResult = applyLifeGainViaProcessLifeChange(ctx, attackerController as PlayerID, applied, `${card.name || 'Attacker'} (lifelink)`);
      result.lifeGainForPlayers[attackerController] = (result.lifeGainForPlayers[attackerController] || 0) + lifeGainResult.actualChange;
    }
    result.attackersThatDealtCreatureDamage = result.attackersThatDealtCreatureDamage || [];
    if (!result.attackersThatDealtCreatureDamage.includes(String(attacker.id))) {
      result.attackersThatDealtCreatureDamage.push(String(attacker.id));
    }
    result.attackerDamageToCreatures = result.attackerDamageToCreatures || {};
    result.attackerDamageToCreatures[String(attacker.id)] = (result.attackerDamageToCreatures[String(attacker.id)] || 0) + applied;
    const stats = getCombatCreatureStats(ctx, creature);
    if (creatureDiesFromMarked(creature, stats.toughness) && !result.creaturesDestroyed.includes(String(creature.id))) {
      result.creaturesDestroyed.push(String(creature.id));
    }
  }
}

function creatureDiesFromMarked(creature: any, toughness: number): boolean {
  return Number(creature?.markedDamage || 0) >= Number(toughness || 0) && Number(toughness || 0) > 0;
}
