/**
 * Lethal attack finder for Phase 2 planners (P2-2).
 *
 * Origin: AI_Upgrade Phase 0-2 plan P2-2.
 * Public entry symbols: LethalPlan, findLethal.
 *
 * For each defender, send all attackers at them, assume damage-minimizing
 * blocks (menace needs two), confirm with resolveCombat.
 */

import { canCreatureBlock, type CombatCreature } from '../combatAutomation.js';
import type { BlockAssignment } from '../aiEngineBlockPlanning.js';
import {
  resolveCombat,
  type DefenderState,
} from './combatResolver.js';

export interface LethalPlan {
  targetId: string;
  attackers: Array<{ creatureId: string; defendingPlayerId: string }>;
  certainty: 'guaranteed' | 'unless_trick';
}

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function hitDamage(c: CombatCreature): number {
  return c.keywords.doubleStrike ? c.power * 2 : c.power;
}

function isLegalBlocker(
  blocker: CombatCreature,
  attacker: CombatCreature,
  already: readonly CombatCreature[],
): boolean {
  if (blocker.permanent?.tapped) return false;
  const v = canCreatureBlock(blocker, attacker, already);
  // Menace returns legal:true with requiredBlockers:2 for the first assignee.
  return v.legal;
}

/** Damage one blocker absorbs from an attacker (trample leftover model). */
function absorbAmount(attacker: CombatCreature, blocker: CombatCreature): number {
  if (attacker.keywords.deathtouch && blocker.power >= 0) {
    // Deathtouch attacker needs only 1 damage to kill; that much is absorbed.
    return Math.min(hitDamage(attacker), Math.max(1, blocker.toughness));
  }
  return Math.min(hitDamage(attacker), Math.max(0, blocker.toughness));
}

/**
 * Greedy best blocks: each available blocker is assigned to the attacker
 * where it prevents the most additional damage. Menace needs two.
 */
export function bestDamageSavingBlocks(
  attackers: readonly CombatCreature[],
  blockers: readonly CombatCreature[],
  /** Real ms timestamp; stop assigning once passed so a wide combat cannot monopolize a turn. */
  deadlineMs?: number,
): BlockAssignment[] {
  const available = new Set(blockers.map((b) => b.id));
  const byId = new Map(blockers.map((b) => [b.id, b]));
  const assigned: BlockAssignment[] = [];
  const onAttacker = new Map<string, CombatCreature[]>();

  const needCount = (a: CombatCreature) => (a.keywords.menace ? 2 : 1);

  const preventedSoFar = (a: CombatCreature): number => {
    const blks = onAttacker.get(a.id) || [];
    if (blks.length === 0) return 0;
    if (blks.length < needCount(a)) return 0; // incomplete menace
    if (!a.keywords.trample) return hitDamage(a);
    let absorbed = 0;
    for (const b of blks) absorbed += absorbAmount(a, b);
    return Math.min(hitDamage(a), absorbed);
  };

  // Repeat until no blocker improves prevention.
  let progress = true;
  while (progress) {
    if (deadlineMs != null && nowMs() > deadlineMs) break;
    progress = false;
    let best: { blockerId: string; attackerId: string; gain: number } | null = null;

    for (const blockerId of available) {
      if (deadlineMs != null && nowMs() > deadlineMs) break;
      const blocker = byId.get(blockerId)!;
      for (const attacker of attackers) {
        if (deadlineMs != null && nowMs() > deadlineMs) break;
        const current = onAttacker.get(attacker.id) || [];
        if (!isLegalBlocker(blocker, attacker, current)) continue;
        if (current.length >= needCount(attacker) && !attacker.keywords.trample) {
          // Already fully blocked; extra blockers only help trample absorption.
          continue;
        }
        const before = preventedSoFar(attacker);
        // Tentative
        const tentative = [...current, blocker];
        let after = 0;
        if (tentative.length < needCount(attacker)) after = 0;
        else if (!attacker.keywords.trample) after = hitDamage(attacker);
        else {
          let absorbed = 0;
          for (const b of tentative) absorbed += absorbAmount(attacker, b);
          after = Math.min(hitDamage(attacker), absorbed);
        }
        const gain = after - before;
        // Prefer positive gain; for incomplete menace, small positive nudge.
        const menaceProgress =
          attacker.keywords.menace && current.length === 0 && gain === 0
            ? 0.5
            : gain;
        if (!best || menaceProgress > best.gain) {
          best = { blockerId, attackerId: attacker.id, gain: menaceProgress };
        }
      }
    }

    if (best && best.gain > 0) {
      const blocker = byId.get(best.blockerId)!;
      assigned.push({ blockerId: best.blockerId, attackerId: best.attackerId });
      const list = onAttacker.get(best.attackerId) || [];
      list.push(blocker);
      onAttacker.set(best.attackerId, list);
      available.delete(best.blockerId);
      progress = true;
    }
  }

  // Drop incomplete menace assignments (illegal blocks).
  const keepAttackers = new Set<string>();
  for (const a of attackers) {
    const n = (onAttacker.get(a.id) || []).length;
    if (n >= needCount(a)) keepAttackers.add(a.id);
  }
  return assigned.filter((x) => keepAttackers.has(x.attackerId));
}

export function findLethal(input: {
  attackers: readonly CombatCreature[];
  defenders: readonly DefenderState[];
  blockersByDefender: ReadonlyMap<string, readonly CombatCreature[]>;
  trickRisk: Record<string, boolean>;
  /** Real ms timestamp; skip remaining defenders once passed. */
  deadlineMs?: number;
}): LethalPlan[] {
  const { attackers, defenders, blockersByDefender, trickRisk } = input;
  if (attackers.length === 0) return [];

  const plans: LethalPlan[] = [];
  const creatureMap = new Map<string, CombatCreature>();
  for (const a of attackers) creatureMap.set(a.id, a);

  for (const def of defenders) {
    if (input.deadlineMs != null && nowMs() > input.deadlineMs) break;
    const blockers = blockersByDefender.get(def.id) || [];
    for (const b of blockers) creatureMap.set(b.id, b);

    const attacks = attackers.map((a) => ({
      attacker: a,
      defenderId: def.id,
    }));
    const blocks = bestDamageSavingBlocks(attackers, blockers, input.deadlineMs);
    const outcome = resolveCombat(attacks, blocks, creatureMap, [def]);

    if (!outcome.defendersKilled.includes(def.id)) continue;

    plans.push({
      targetId: def.id,
      attackers: attackers.map((a) => ({
        creatureId: a.id,
        defendingPlayerId: def.id,
      })),
      certainty: trickRisk[def.id] ? 'unless_trick' : 'guaranteed',
    });
  }

  return plans;
}
