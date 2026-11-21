/**
 * Attack planner for Phase 2 (P2-5).
 *
 * Origin: AI_Upgrade Phase 0-2 plan P2-5.
 * Public entry symbols: AttackDeclaration, AttackPlanResult, planAttacks,
 * applyCombatOutcomeToObservation.
 *
 * Lethal first, then greedy win-probability targets, then hold back enough
 * to keep crack-back non-lethal. Goaded attackers are fixed and only retargeted.
 */

import type { BattlefieldPermanent, PlayerID } from '../../../shared/src/types.js';
import {
  createCombatCreature,
  type CombatCreature,
} from '../combatAutomation.js';
import { playerIsLegalAttackTarget } from '../playerInGameStatus.js';
import { buildObservation } from './buildObservation.js';
import type { Observation } from './observation.js';
import { seatFeatures } from './evaluatorFeatures.js';
import { getEvalWeights, seatValues } from './evaluator.js';
import { winProbabilities } from './winProbability.js';
import {
  resolveCombat,
  type CombatOutcome,
  type DefenderState,
} from './combatResolver.js';
import { bestDamageSavingBlocks, findLethal } from './lethalCheck.js';
import { estimateCrackBack } from './crackBack.js';
import { FEATURE_SCALE } from './evaluatorFeatures.js';

/** Nudge focus-fire toward lower life when WP deltas are tiny (EDH "press the weak"). */
export const LIFE_PRESSURE_BONUS = 0.025;

export interface AttackDeclaration {
  creatureId: string;
  defendingPlayerId: string;
}

export interface AttackPlanResult {
  attackers: AttackDeclaration[];
  ms: number;
  reason: string;
}

function hitDamage(c: CombatCreature): number {
  return c.keywords.doubleStrike ? c.power * 2 : c.power;
}

function readLife(gameState: any, playerId: string): number {
  const fromMap = gameState?.life?.[playerId];
  if (typeof fromMap === 'number') return fromMap;
  const player = (gameState?.players || []).find((p: any) => p?.id === playerId);
  return typeof player?.life === 'number' ? player.life : 40;
}

function readHandSize(gameState: any, playerId: string): number {
  const zones = gameState?.zones?.[playerId];
  if (Array.isArray(zones?.hand)) return zones.hand.length;
  const player = (gameState?.players || []).find((p: any) => p?.id === playerId);
  if (Array.isArray(player?.hand)) return player.hand.length;
  return 0;
}

function untappedManaSources(battlefield: readonly BattlefieldPermanent[], playerId: string): number {
  let n = 0;
  for (const p of battlefield) {
    if (p.controller !== playerId || p.tapped) continue;
    const text = String((p.card as any)?.oracle_text || '').toLowerCase();
    const type = String((p.card as any)?.type_line || '').toLowerCase();
    if (type.includes('land') || text.includes('{t}: add') || text.includes('add {')) n += 1;
  }
  return n;
}

function activeOpponents(gameState: any, playerId: string): any[] {
  return (gameState?.players || []).filter((p: any) =>
    playerIsLegalAttackTarget(p, playerId),
  );
}

function commanderDamageTable(gameState: any, defenderId: string): Record<string, number> {
  const raw = gameState?.commanderDamage?.[defenderId] || {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[String(k)] = n;
  }
  return out;
}

function toDefenderStates(gameState: any, opponents: any[]): DefenderState[] {
  return opponents.map((p) => ({
    id: String(p.id),
    life: readLife(gameState, p.id),
    commanderDamageTaken: commanderDamageTable(gameState, p.id),
  }));
}

function blockersFor(
  battlefield: readonly BattlefieldPermanent[],
  defenderId: string,
): CombatCreature[] {
  return battlefield
    .filter((p) => {
      if (p.controller !== defenderId || p.tapped) return false;
      const type = String((p.card as any)?.type_line || '').toLowerCase();
      return type.includes('creature');
    })
    .map((p) => createCombatCreature(p, battlefield));
}

function creatureMap(
  creatures: readonly CombatCreature[],
): Map<string, CombatCreature> {
  return new Map(creatures.map((c) => [c.id, c]));
}

/** Apply a resolved combat onto a cloned Observation for win-prob scoring. */
export function applyCombatOutcomeToObservation(
  obs: Observation,
  outcome: CombatOutcome,
): Observation {
  const next: Observation = structuredClone(obs);
  const dead = new Set(outcome.deaths);

  const applyLife = (id: string, delta: number) => {
    if (id === next.seat) next.self.life = Math.max(0, next.self.life + delta);
    else {
      const opp = next.opponents.find((o) => o.id === id);
      if (opp) opp.life = Math.max(0, opp.life + delta);
    }
  };

  for (const [id, lost] of Object.entries(outcome.lifeLost)) {
    applyLife(id, -lost);
  }
  for (const [id, gained] of Object.entries(outcome.lifeGained)) {
    applyLife(id, gained);
  }

  next.self.battlefield = next.self.battlefield.filter((p) => !dead.has(p.id));
  for (const opp of next.opponents) {
    opp.battlefield = opp.battlefield.filter((p) => !dead.has(p.id));
    if (outcome.defendersKilled.includes(opp.id)) opp.eliminated = true;
  }

  for (const [defId, byCmd] of Object.entries(outcome.commanderDamage)) {
    if (!next.commanderDamage[defId]) next.commanderDamage[defId] = {};
    for (const [cmdId, dmg] of Object.entries(byCmd)) {
      next.commanderDamage[defId][cmdId] =
        (next.commanderDamage[defId][cmdId] || 0) + dmg;
    }
  }

  return next;
}

function myWinProb(obs: Observation): number {
  const features = seatFeatures(obs);
  const values = seatValues(features, getEvalWeights());
  const eliminated = obs.opponents.filter((o) => o.eliminated).map((o) => o.id);
  const p = winProbabilities(values, eliminated);
  return p[obs.seat] ?? 0;
}

function scoreAttackSet(
  baseObs: Observation,
  attacks: ReadonlyArray<{ attacker: CombatCreature; defenderId: string }>,
  blocks: ReturnType<typeof bestDamageSavingBlocks>,
  allCreatures: Map<string, CombatCreature>,
  defenders: DefenderState[],
): number {
  const outcome = resolveCombat(attacks, blocks, allCreatures, defenders);
  const after = applyCombatOutcomeToObservation(baseObs, outcome);
  return myWinProb(after) - myWinProb(baseObs);
}

function survivingBlockers(
  myCreatures: CombatCreature[],
  attackingIds: Set<string>,
): CombatCreature[] {
  return myCreatures.filter((c) => {
    if (attackingIds.has(c.id) && !c.keywords.vigilance) return false;
    if (c.permanent?.tapped && !c.keywords.vigilance) return false;
    return true;
  });
}

export function planAttacks(args: {
  gameState: any;
  playerId: PlayerID;
  legalAttackerIds: readonly string[];
  /** Goaded creatures that must attack; only their targets may be chosen. */
  goaded: readonly AttackDeclaration[];
  battlefield?: readonly BattlefieldPermanent[];
}): AttackPlanResult {
  const t0 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  // Full search is O(attackers × blockers × defenders) via canCreatureBlock.
  // Past this budget the caller switches to planAttacksFast. Without the cap a
  // single declare-attackers tick ran long enough to trip the 180s harness stall
  // (b5 selfplay-7000-5-1 at turn 69, selfplay-7000-4-3 at turn 84).
  const PLAN_BUDGET_MS = 800;
  const deadline = t0 + PLAN_BUDGET_MS;
  const overBudget = () => {
    const now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    return now > deadline;
  };
  const goadedFallback = (): AttackDeclaration[] =>
    args.goaded.map((g) => ({
      creatureId: g.creatureId,
      defendingPlayerId: g.defendingPlayerId,
    }));
  const battlefield =
    args.battlefield
    || (args.gameState?.battlefield as BattlefieldPermanent[])
    || [];
  const playerId = args.playerId;
  const goadedIds = new Set(args.goaded.map((g) => g.creatureId));
  const opponents = activeOpponents(args.gameState, playerId);
  if (opponents.length === 0 || args.legalAttackerIds.length === 0) {
    return {
      attackers: [...args.goaded],
      ms: 0,
      reason: 'no-opponents-or-attackers',
    };
  }

  const defenders = toDefenderStates(args.gameState, opponents);
  const voluntaryIds = args.legalAttackerIds.filter((id) => !goadedIds.has(id));
  const voluntaryCreatures = voluntaryIds
    .map((id) => battlefield.find((p) => p.id === id))
    .filter((p): p is BattlefieldPermanent => Boolean(p))
    .map((p) => createCombatCreature(p, battlefield));

  const goadedCreatures = args.goaded
    .map((g) => battlefield.find((p) => p.id === g.creatureId))
    .filter((p): p is BattlefieldPermanent => Boolean(p))
    .map((p) => createCombatCreature(p, battlefield));

  const allAttackCreatures = [...voluntaryCreatures, ...goadedCreatures];
  const blockersByDefender = new Map<string, readonly CombatCreature[]>();
  for (const d of defenders) {
    blockersByDefender.set(d.id, blockersFor(battlefield, d.id));
  }

  const trickRisk: Record<string, boolean> = {};
  for (const d of defenders) {
    trickRisk[d.id] =
      untappedManaSources(battlefield, d.id) > 0 && readHandSize(args.gameState, d.id) > 0;
  }

  const myLife = readLife(args.gameState, playerId);
  const myCmdTaken = commanderDamageTable(args.gameState, playerId);
  const myCreatures = battlefield
    .filter((p) => {
      if (p.controller !== playerId) return false;
      const type = String((p.card as any)?.type_line || '').toLowerCase();
      return type.includes('creature');
    })
    .map((p) => createCombatCreature(p, battlefield));

  const finish = (attackers: AttackDeclaration[], reason: string): AttackPlanResult => {
    const t1 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    return { attackers, ms: t1 - t0, reason };
  };

  // --- Lethal first ---
  if (voluntaryCreatures.length + goadedCreatures.length > 0) {
    const lethalPool = [...voluntaryCreatures, ...goadedCreatures];
    const plans = findLethal({
      attackers: lethalPool,
      defenders,
      blockersByDefender,
      trickRisk,
      deadlineMs: deadline,
    });
    if (overBudget()) return finish(goadedFallback(), 'time-budget');

    type LethalCandidate = {
      plan: (typeof plans)[number];
      gain: number;
      crackLethal: boolean;
    };
    const lethalCandidates: LethalCandidate[] = [];
    for (const plan of plans) {
      if (overBudget()) return finish(goadedFallback(), 'time-budget');
      const attacks = plan.attackers
        .map((a) => {
          const creature = lethalPool.find((c) => c.id === a.creatureId);
          return creature
            ? { attacker: creature, defenderId: a.defendingPlayerId }
            : null;
        })
        .filter((x): x is { attacker: CombatCreature; defenderId: string } => Boolean(x));
      const allMap = creatureMap([
        ...lethalPool,
        ...[...blockersByDefender.values()].flat(),
      ]);
      const blocks = bestDamageSavingBlocks(
        attacks.map((a) => a.attacker),
        blockersByDefender.get(plan.targetId) || [],
        deadline,
      );
      const outcome = resolveCombat(
        attacks,
        blocks,
        allMap,
        defenders.filter((d) => d.id === plan.targetId),
      );
      const lifeAfterCombat = myLife + (outcome.lifeGained[playerId] || 0);
      const crack2 = estimateCrackBack({
        lifeAfterCombat,
        myUntappedBlockers: survivingBlockers(
          myCreatures,
          new Set(plan.attackers.map((a) => a.creatureId)),
        ),
        opponents: opponents.map((o) => ({
          id: String(o.id),
          attackers: blockersFor(battlefield, String(o.id)).filter(
            (c) => !outcome.deaths.includes(c.id),
          ),
        })),
        commanderDamageTaken: myCmdTaken,
        myId: playerId,
      });
      const afterObs = applyCombatOutcomeToObservation(
        buildObservation(args.gameState, playerId),
        outcome,
      );
      const gain = myWinProb(afterObs) - myWinProb(buildObservation(args.gameState, playerId));
      lethalCandidates.push({
        plan,
        gain,
        crackLethal: crack2.lethal,
      });
    }
    lethalCandidates.sort((a, b) => b.gain - a.gain);
    for (const cand of lethalCandidates) {
      if (cand.plan.certainty === 'guaranteed') {
        return finish(
          cand.plan.attackers,
          `lethal-guaranteed:${cand.plan.targetId}`,
        );
      }
      if (cand.plan.certainty === 'unless_trick' && !cand.crackLethal) {
        return finish(
          cand.plan.attackers,
          `lethal-unless-trick:${cand.plan.targetId}`,
        );
      }
    }
  }

  // --- Greedy win-probability targets ---
  const baseObs = buildObservation(args.gameState, playerId);
  type Scored = { creatureId: string; defendingPlayerId: string; gain: number };
  const scored: Scored[] = [];

  for (const attacker of voluntaryCreatures) {
    if (overBudget()) return finish(goadedFallback(), 'time-budget');
    let best: Scored | null = null;
    for (const def of defenders) {
      const attacks = [{ attacker, defenderId: def.id }];
      const blocks = bestDamageSavingBlocks(
        [attacker],
        blockersByDefender.get(def.id) || [],
        deadline,
      );
      const allMap = creatureMap([
        attacker,
        ...(blockersByDefender.get(def.id) || []),
      ]);
      const gain = scoreAttackSet(baseObs, attacks, blocks, allMap, [def]);
      // Prefer higher gain; break ties toward lower life (pressure).
      const tieBreak = -def.life * 1e-6;
      const score = gain + tieBreak;
      if (!best || score > best.gain) {
        best = {
          creatureId: attacker.id,
          defendingPlayerId: def.id,
          gain: score,
        };
      }
    }
    if (best && best.gain > -0.02) scored.push(best);
  }

  // Goaded: only choose targets (must attack).
  const goadedChosen: AttackDeclaration[] = [];
  for (const g of args.goaded) {
    if (overBudget()) return finish(goadedFallback(), 'time-budget');
    const attacker = goadedCreatures.find((c) => c.id === g.creatureId);
    if (!attacker) {
      goadedChosen.push(g);
      continue;
    }
    let bestId = g.defendingPlayerId;
    let bestGain = -Infinity;
    for (const def of defenders) {
      const attacks = [{ attacker, defenderId: def.id }];
      const blocks = bestDamageSavingBlocks(
        [attacker],
        blockersByDefender.get(def.id) || [],
        deadline,
      );
      const allMap = creatureMap([
        attacker,
        ...(blockersByDefender.get(def.id) || []),
      ]);
      const gain = scoreAttackSet(baseObs, attacks, blocks, allMap, [def]);
      if (gain > bestGain) {
        bestGain = gain;
        bestId = def.id;
      }
    }
    goadedChosen.push({ creatureId: g.creatureId, defendingPlayerId: bestId });
  }

  // Focus fire: among voluntary attackers with positive gain, pick the single
  // defender that maximizes collective win-prob (usually the lowest life).
  scored.sort((a, b) => b.gain - a.gain);
  let chosen: AttackDeclaration[] = [...goadedChosen];
  if (scored.length > 0) {
    const voluntaryIds = scored.map((s) => s.creatureId);
    const voluntaryCreaturesById = new Map(
      voluntaryCreatures.map((c) => [c.id, c]),
    );
    let bestFocus: { targetId: string; gain: number } | null = null;
    for (const def of defenders) {
      if (overBudget()) return finish(goadedFallback(), 'time-budget');
      const attacks = voluntaryIds
        .map((id) => voluntaryCreaturesById.get(id))
        .filter((c): c is CombatCreature => Boolean(c))
        .map((attacker) => ({ attacker, defenderId: def.id }));
      if (attacks.length === 0) continue;
      const blocks = bestDamageSavingBlocks(
        attacks.map((a) => a.attacker),
        blockersByDefender.get(def.id) || [],
        deadline,
      );
      const allMap = creatureMap([
        ...attacks.map((a) => a.attacker),
        ...(blockersByDefender.get(def.id) || []),
      ]);
      const gain = scoreAttackSet(baseObs, attacks, blocks, allMap, [def]);
      const lifePressure =
        (FEATURE_SCALE.life - Math.min(def.life, FEATURE_SCALE.life))
        / FEATURE_SCALE.life
        * LIFE_PRESSURE_BONUS;
      const score = gain + lifePressure;
      if (!bestFocus || score > bestFocus.gain) {
        bestFocus = { targetId: def.id, gain: score };
      }
    }
    if (bestFocus && bestFocus.gain > -0.02) {
      chosen = [
        ...goadedChosen,
        ...voluntaryIds.map((id) => ({
          creatureId: id,
          defendingPlayerId: bestFocus!.targetId,
        })),
      ];
    }
  }

  // --- Keep enough at home vs lethal crack-back ---
  const byGain = new Map(scored.map((s) => [s.creatureId, s.gain]));
  const crackArgs = (attackingIds: Set<string>) => ({
    lifeAfterCombat: myLife,
    myUntappedBlockers: survivingBlockers(myCreatures, attackingIds),
    opponents: opponents.map((o) => ({
      id: String(o.id),
      attackers: blockersFor(battlefield, String(o.id)),
    })),
    commanderDamageTaken: myCmdTaken,
    myId: playerId,
  });
  const trimCrackBack = () => {
    for (;;) {
      const attackingIds = new Set(chosen.map((a) => a.creatureId));
      const crack = estimateCrackBack(crackArgs(attackingIds));
      if (!crack.lethal) return;
      // Drop voluntary attacker with smallest gain (never drop goaded).
      const voluntary = chosen
        .filter((a) => !goadedIds.has(a.creatureId))
        .sort((a, b) => (byGain.get(a.creatureId) || 0) - (byGain.get(b.creatureId) || 0));
      if (voluntary.length === 0) return;
      const drop = voluntary[0];
      chosen = chosen.filter((a) => a.creatureId !== drop.creatureId);
    }
  };
  trimCrackBack();

  // Prefer not to send tiny negative-gain attacks.
  chosen = chosen.filter(
    (a) => goadedIds.has(a.creatureId) || (byGain.get(a.creatureId) || 0) > -0.02,
  );
  // Re-trim after filter.
  trimCrackBack();

  // Low life: if holding all blockers takes 0 and attacking takes avoidable
  // damage near your life total, stay home (C1).
  if (myLife <= 10 && chosen.some((a) => !goadedIds.has(a.creatureId))) {
    const holdCrack = estimateCrackBack(crackArgs(new Set()));
    const attackCrack = estimateCrackBack(
      crackArgs(new Set(chosen.map((a) => a.creatureId))),
    );
    if (
      !holdCrack.lethal
      && holdCrack.worstCase < attackCrack.worstCase
      && attackCrack.worstCase >= myLife - 3
    ) {
      chosen = chosen.filter((a) => goadedIds.has(a.creatureId));
    }
  }

  void allAttackCreatures;
  void hitDamage;

  return finish(
    chosen,
    chosen.length === 0 ? 'hold-all' : `wp-greedy:${chosen.length}`,
  );
}
