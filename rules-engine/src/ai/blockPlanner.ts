/**
 * Block planner for Phase 2 (P2-6).
 *
 * Origin: AI_Upgrade Phase 0-2 plan P2-6.
 * Public entry symbols: BlockPlanResult, planBlocks.
 *
 * Scores candidate block sets (including none and the v0 planAIBlocks result)
 * by win probability after resolveCombat. Falls back to planAIBlocks on error.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import {
  canCreatureBlock,
  createCombatCreature,
  type CombatCreature,
} from '../combatAutomation.js';
import {
  evaluateSingleBlockOutcome,
  planAIBlocks,
  readCommanderDamageTaken,
  type BlockAssignment,
  type BlockerEvaluation,
} from '../aiEngineBlockPlanning.js';
import type { AIDecisionContext } from '../AIEngine.js';
import { buildObservation } from './buildObservation.js';
import { seatFeatures } from './evaluatorFeatures.js';
import { getEvalWeights, seatValues } from './evaluator.js';
import { winProbabilities } from './winProbability.js';
import { resolveCombat, type DefenderState } from './combatResolver.js';
import { applyCombatOutcomeToObservation } from './attackPlanner.js';

export interface BlockPlanResult {
  assignments: BlockAssignment[];
  deathTriggerBlocks: number;
  ms: number;
  reason: string;
}

function hitDamage(c: CombatCreature): number {
  return c.keywords.doubleStrike ? c.power * 2 : c.power;
}

function isCommander(c: CombatCreature): boolean {
  const perm: any = c.permanent;
  return Boolean(perm?.isCommander === true || perm?.card?.zone === 'command');
}

function keyOf(assignments: readonly BlockAssignment[]): string {
  return [...assignments]
    .map((a) => `${a.blockerId}->${a.attackerId}`)
    .sort()
    .join(',');
}

function myWinProb(
  gameState: any,
  playerId: PlayerID,
  assignments: readonly BlockAssignment[],
  attackers: readonly CombatCreature[],
  blockers: readonly BlockerEvaluation[],
): number {
  const obs = buildObservation(gameState, playerId);
  const defender: DefenderState = {
    id: playerId,
    life: obs.self.life,
    commanderDamageTaken: { ...(gameState?.commanderDamage?.[playerId] || {}) },
  };
  // Prefer evaluated CombatCreatures (keywords already resolved) over re-parsing
  // permanents, which may lack oracle_text in unit fixtures.
  const creatureMap = new Map<string, CombatCreature>();
  for (const a of attackers) creatureMap.set(a.id, a);
  for (const b of blockers) creatureMap.set(b.creature.id, b.creature);

  const attacks = attackers.map((attacker) => ({
    attacker,
    defenderId: playerId,
  }));
  const outcome = resolveCombat(attacks, assignments, creatureMap, [defender]);
  const after = applyCombatOutcomeToObservation(obs, outcome);
  const features = seatFeatures(after);
  const values = seatValues(features, getEvalWeights());
  const eliminated = after.opponents.filter((o) => o.eliminated).map((o) => o.id);
  if (after.self.life <= 0 || outcome.defendersKilled.includes(playerId)) {
    // Dead → worst score
    return -1;
  }
  const p = winProbabilities(values, eliminated);
  return p[playerId] ?? 0;
}

function countDeathTriggers(
  assignments: readonly BlockAssignment[],
  blockers: readonly BlockerEvaluation[],
): number {
  let n = 0;
  for (const a of assignments) {
    const b = blockers.find((x) => x.creature.id === a.blockerId);
    if (b?.wantsToGetKilled) n += 1;
  }
  return n;
}

/** Build ~10 candidate assignment sets. */
export function generateBlockCandidates(
  context: AIDecisionContext,
  attackers: readonly CombatCreature[],
  blockers: readonly BlockerEvaluation[],
): BlockAssignment[][] {
  const gameState: any = context.gameState;
  const defenderId = context.playerId;
  const candidates: BlockAssignment[][] = [[]];

  const baseline = planAIBlocks(context, attackers, blockers).assignments;
  candidates.push(baseline);

  // Free/trade-only: keep baseline assignments that are good trades or free blocks.
  const noChump: BlockAssignment[] = [];
  for (const a of baseline) {
    const attacker = attackers.find((x) => x.id === a.attackerId);
    const blocker = blockers.find((x) => x.creature.id === a.blockerId);
    if (!attacker || !blocker) continue;
    const { blockerSurvives, attackerDies } = evaluateSingleBlockOutcome(
      blocker.creature,
      attacker,
    );
    if (blockerSurvives || attackerDies || blocker.wantsToGetKilled) {
      noChump.push(a);
    }
  }
  candidates.push(noChump);

  // Per-attacker best single block by trade/free score.
  for (const attacker of attackers) {
    let best: { assignment: BlockAssignment; score: number } | null = null;
    for (const b of blockers) {
      if (!canCreatureBlock(b.creature, attacker, []).legal) continue;
      if (b.perm?.tapped) continue;
      const { blockerSurvives, attackerDies } = evaluateSingleBlockOutcome(
        b.creature,
        attacker,
      );
      let score = -1000;
      if (blockerSurvives && attackerDies) score = 60;
      else if (blockerSurvives) score = 25;
      else if (attackerDies) score = 10;
      else if (
        isCommander(attacker)
        && readCommanderDamageTaken(gameState, defenderId, attacker) + hitDamage(attacker) >= 21
      ) {
        score = 5; // forced chump
      }
      if (!best || score > best.score) {
        best = {
          assignment: { blockerId: b.creature.id, attackerId: attacker.id },
          score,
        };
      }
    }
    if (best && best.score > -1000) {
      candidates.push([best.assignment]);
      // Merge with other baseline blocks on different attackers.
      const merged = [
        ...baseline.filter((x) => x.attackerId !== attacker.id && x.blockerId !== best!.assignment.blockerId),
        best.assignment,
      ];
      candidates.push(merged);
    }
  }

  // Double-block the biggest attacker when two blockers available.
  if (attackers.length > 0 && blockers.length >= 2) {
    const big = [...attackers].sort((a, b) => hitDamage(b) - hitDamage(a))[0];
    const legal = blockers.filter((b) => canCreatureBlock(b.creature, big, []).legal);
    if (legal.length >= 2) {
      candidates.push([
        { blockerId: legal[0].creature.id, attackerId: big.id },
        { blockerId: legal[1].creature.id, attackerId: big.id },
      ]);
    }
  }

  // Deduplicate.
  const seen = new Set<string>();
  const unique: BlockAssignment[][] = [];
  for (const c of candidates) {
    const k = keyOf(c);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
    if (unique.length >= 12) break;
  }
  return unique;
}

export function planBlocks(
  context: AIDecisionContext,
  attackers: readonly CombatCreature[],
  blockers: readonly BlockerEvaluation[],
): BlockPlanResult {
  const t0 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  const fallback = () => {
    const base = planAIBlocks(context, attackers, blockers);
    const t1 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    return {
      ...base,
      ms: t1 - t0,
      reason: 'fallback-planAIBlocks',
    };
  };

  try {
    if (attackers.length === 0 || blockers.length === 0) {
      return { assignments: [], deathTriggerBlocks: 0, ms: 0, reason: 'nothing-to-block' };
    }

    const candidates = generateBlockCandidates(context, attackers, blockers);
    const incoming = attackers.reduce((s, a) => s + hitDamage(a), 0);
    const lifeNow = Number(
      (context.gameState as any)?.life?.[context.playerId]
      ?? (context.gameState as any)?.players?.find((p: any) => p.id === context.playerId)?.life
      ?? 40,
    );
    // Prefer eating clearly survivable damage over chump/trade-down (B1).
    // Never bias empty when a commander is already lethal if unblocked, or when
    // a free/good trade exists (M1 first-strike win).
    const commanderLethalIfOpen = attackers.some(
      (a) =>
        isCommander(a)
        && readCommanderDamageTaken(context.gameState, context.playerId, a) + hitDamage(a) >= 21,
    );
    let hasGoodTrade = false;
    for (const assignments of candidates) {
      for (const a of assignments) {
        const attacker = attackers.find((x) => x.id === a.attackerId);
        const blocker = blockers.find((x) => x.creature.id === a.blockerId);
        if (!attacker || !blocker) continue;
        const { blockerSurvives, attackerDies } = evaluateSingleBlockOutcome(
          blocker.creature,
          attacker,
        );
        if (blockerSurvives || (attackerDies && blocker.wantsToGetKilled)) {
          hasGoodTrade = true;
          break;
        }
      }
      if (hasGoodTrade) break;
    }
    const canComfortablyEat =
      lifeNow - incoming >= 25 && !commanderLethalIfOpen && !hasGoodTrade;
    let best: { assignments: BlockAssignment[]; score: number } | null = null;
    for (const assignments of candidates) {
      const blockerUse = new Map<string, number>();
      let illegal = false;
      for (const a of assignments) {
        blockerUse.set(a.blockerId, (blockerUse.get(a.blockerId) || 0) + 1);
        if ((blockerUse.get(a.blockerId) || 0) > 1) {
          illegal = true;
          break;
        }
      }
      if (illegal) continue;

      let score = myWinProb(
        context.gameState,
        context.playerId,
        assignments,
        attackers,
        blockers,
      );
      // Prefer free/FS kills on the largest attacker (M1: fs→atk4 over fs→atk3).
      for (const a of assignments) {
        const attacker = attackers.find((x) => x.id === a.attackerId);
        const blocker = blockers.find((x) => x.creature.id === a.blockerId);
        if (!attacker || !blocker) continue;
        const { blockerSurvives, attackerDies } = evaluateSingleBlockOutcome(
          blocker.creature,
          attacker,
        );
        if (blockerSurvives && attackerDies) {
          score += 0.002 * hitDamage(attacker);
        } else if (blockerSurvives) {
          score += 0.001 * hitDamage(attacker);
        }
      }
      if (canComfortablyEat && assignments.length === 0) {
        score += 0.03;
      }
      if (!best || score > best.score) {
        best = { assignments, score };
      }
    }

    const t1 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    if (!best) return fallback();
    return {
      assignments: best.assignments,
      deathTriggerBlocks: countDeathTriggers(best.assignments, blockers),
      ms: t1 - t0,
      reason: `wp-best:${keyOf(best.assignments) || 'none'}`,
    };
  } catch (err) {
    console.warn('[ai] v2 block planner failed, using planAIBlocks', err);
    return fallback();
  }
}
