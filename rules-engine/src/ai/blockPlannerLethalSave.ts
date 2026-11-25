/**
 * Origin parent: rules-engine/src/ai/blockPlanner.ts / aiEngineCombatSupport.ts
 *
 * Cluster moved: cheap lethal-save blocks for large-combat boards where full
 * planBlocks is skipped (mirrors planLethalAttacksOnly on attack).
 *
 * Public entry symbols: planLethalSaveBlocks.
 *
 * Smoke7 wired this for every large-combat v2 board (smoke confirmed, full gate
 * over-block). Smoke29 life≤15 gate also regressed (22%). Smoke50 attackers≤6
 * on largeCombat → 11.1% decisive — keep module unwired.
 */

import {
  type CombatCreature,
} from '../combatAutomation.js';
import {
  type BlockAssignment,
} from '../aiEngineBlockPlanning.js';
import { bestDamageSavingBlocks } from './lethalCheck.js';
import { resolveCombat, type DefenderState } from './combatResolver.js';

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function hitDamage(c: CombatCreature): number {
  return c.keywords.doubleStrike ? c.power * 2 : c.power;
}

/**
 * When unblocked damage would kill the defender, assign damage-minimizing blocks.
 * Returns null when not facing lethal or when the save still dies / times out.
 */
export function planLethalSaveBlocks(args: {
  defenderId: string;
  life: number;
  attackers: readonly CombatCreature[];
  blockers: readonly CombatCreature[];
  /** Hard wall in ms (default 8). */
  maxMs?: number;
}): { assignments: BlockAssignment[]; ms: number; reason: string } | null {
  const t0 = nowMs();
  const maxMs = Math.max(1, Number(args.maxMs) || 8);
  const deadline = t0 + maxMs;
  const attackers = args.attackers.filter(Boolean);
  const blockers = args.blockers.filter((b) => b && !b.permanent?.tapped);
  if (attackers.length === 0 || blockers.length === 0) return null;

  const incoming = attackers.reduce((sum, a) => sum + Math.max(0, hitDamage(a)), 0);
  if (incoming < args.life) return null;

  const assignments = bestDamageSavingBlocks(attackers, blockers, deadline);
  if (nowMs() > deadline) return null;
  if (assignments.length === 0) return null;

  const creatureMap = new Map<string, CombatCreature>();
  for (const a of attackers) creatureMap.set(a.id, a);
  for (const b of blockers) creatureMap.set(b.id, b);

  const defender: DefenderState = {
    id: args.defenderId,
    life: args.life,
    commanderDamageTaken: {},
  };
  const attacks = attackers.map((attacker) => ({
    attacker,
    defenderId: args.defenderId,
  }));
  const outcome = resolveCombat(attacks, assignments, creatureMap, [defender]);
  if (
    outcome.defendersKilled.includes(args.defenderId)
    || (outcome.lifeLost[args.defenderId] || 0) >= args.life
  ) {
    return null;
  }

  const t1 = nowMs();
  return {
    assignments,
    ms: t1 - t0,
    reason: `lethal-save:${assignments.length}`,
  };
}
