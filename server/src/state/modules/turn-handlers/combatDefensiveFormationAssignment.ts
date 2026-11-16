// server/src/state/modules/turn-handlers/combatDefensiveFormationAssignment.ts
// Defensive Formation family: the defending controller assigns the combat
// damage of creatures attacking them. Queues the existing
// COMBAT_DAMAGE_ASSIGNMENT / DamageAssignmentModal blockers mode, routed to
// the defender (not the attacking player). Detected by oracle pattern, not
// card name. Public: maybeQueueDefensiveFormationAssignments,
// defenderAssignsCombatDamageFor, DEFENSIVE_FORMATION_RE.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { normalizeOraclePatternText, readCardOracleText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

export const DEFENSIVE_FORMATION_RE =
  /rather than the attacking player, you assign the combat damage of each creature attacking you/i;

function oracleOf(perm: any): string {
  return normalizeOraclePatternText(readCardOracleText(perm?.card || perm) || '').replace(/’/g, "'");
}

export function defenderAssignsCombatDamageFor(battlefield: any[], defenderId: string): boolean {
  const pid = String(defenderId || '').trim();
  if (!pid) return false;
  return (Array.isArray(battlefield) ? battlefield : []).some((perm: any) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '').trim() !== pid) return false;
    return DEFENSIVE_FORMATION_RE.test(oracleOf(perm));
  });
}

function defendingPlayerIdOf(attacker: any, battlefield: any[]): string {
  const defendingTarget = String(attacker?.attacking || '').trim();
  if (!defendingTarget) return '';
  const defendingPermanent = (battlefield || []).find((perm: any) => String(perm?.id || '') === defendingTarget);
  // Only "creatures attacking you" — not creatures attacking a planeswalker you control.
  if (defendingPermanent) return '';
  return defendingTarget;
}

function attackerHasTrample(attacker: any): boolean {
  const keywords = attacker?.keywords;
  if (keywords && typeof keywords === 'object' && !Array.isArray(keywords) && keywords.trample === true) return true;
  const listed = Array.isArray(keywords) ? keywords : (attacker?.card?.keywords || []);
  if (Array.isArray(listed) && listed.some((entry: any) => String(entry || '').toLowerCase() === 'trample')) return true;
  const text = oracleOf(attacker).toLowerCase();
  return text.includes('trample');
}

function playerName(state: any, playerId: string): string {
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  const found = players.find((p: any) => String(p?.id || '') === playerId);
  return String(found?.username || found?.name || 'Defending player');
}

export function maybeQueueDefensiveFormationAssignments(
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
    const defenderId = defendingPlayerIdOf(attacker, battlefield);
    if (!defenderId) continue;
    if (!defenderAssignsCombatDamageFor(battlefield, defenderId)) continue;
    const blockedBy = (Array.isArray(attacker.blockedBy) ? attacker.blockedBy : [])
      .map((entry: any) => String(entry?.id || entry || '').trim())
      .filter(Boolean);
    if (blockedBy.length === 0) continue;
    const hasTrample = attackerHasTrample(attacker);
    const attackerName = String(attacker.card?.name || 'Creature');
    const defenderLabel = playerName((ctx as any).state, defenderId);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.COMBAT_DAMAGE_ASSIGNMENT,
      playerId: defenderId as PlayerID,
      description: `${defenderLabel} assigns the combat damage of ${attackerName} (rather than the attacking player).`,
      mandatory: true,
      sourceId: String(attacker.id || ''),
      sourceName: attackerName,
      specialCombatDamageAssignment: true,
      specialCombatDamageMode: 'defensive-formation',
      assignmentMode: 'blockers',
      requireLethalOrder: false,
      hasTrample,
      attackerId: String(attacker.id || ''),
      defendingPlayerId: defenderId,
      blockerIds: blockedBy,
    } as any);
    return true;
  }
  return false;
}
