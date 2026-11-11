/**
 * Role consideration policies for the Phase 1 utility scorer.
 *
 * Origin: AI_Upgrade Phase 1 (P1-5).
 * Public entry symbols: POLICIES, PolicyRole, clamp01, rampCurve, invCurve, atLeast.
 */

import { permanentValue } from './evaluatorFeatures.js';
import type { Consideration, ScoreContext } from './utilityScorer.js';

export type PolicyRole =
  | 'ramp'
  | 'draw'
  | 'removal'
  | 'sweeper'
  | 'counterspell'
  | 'commander';

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

export const rampCurve = (lo: number, hi: number) => (x: number) =>
  clamp01((x - lo) / Math.max(1e-9, hi - lo));

export const invCurve = (f: (x: number) => number) => (x: number) => 1 - f(x);

export const atLeast = (t: number) => (x: number) => (x >= t ? 1 : 0);

function pref(
  name: string,
  input: (ctx: ScoreContext) => number,
  curve: (x: number) => number,
  weight: number,
): Consideration {
  return { name, kind: 'preference', input, curve, weight };
}

function gate(
  name: string,
  input: (ctx: ScoreContext) => number,
  curve: (x: number) => number,
): Consideration {
  return { name, kind: 'gate', input, curve };
}

function isCreature(p: { types: string[] }): boolean {
  return p.types.includes('creature');
}

function isLand(p: { types: string[] }): boolean {
  return p.types.includes('land');
}

/** Highest opposing permanent value matching the card's targeting needs. */
export function bestTargetValue(ctx: ScoreContext): number {
  const opp = ctx.obs.opponents.filter((o) => !o.eliminated);
  if (ctx.profile.needs.includes('target_creature')) {
    const vals = opp.flatMap((o) =>
      o.battlefield.filter(isCreature).map((p) => permanentValue(p)),
    );
    return vals.length ? Math.max(...vals) : 0;
  }
  if (ctx.profile.needs.includes('target_permanent')) {
    const vals = opp.flatMap((o) =>
      o.battlefield.filter((p) => !isLand(p)).map((p) => permanentValue(p)),
    );
    return vals.length ? Math.max(...vals) : 0;
  }
  // Unknown targeting: never gate it out.
  return 1e9;
}

export const POLICIES: Record<PolicyRole, Consideration[]> = {
  ramp: [
    pref('ramp_early', (c) => c.turn, invCurve(rampCurve(3, 10)), 60),
    pref('ramp_mana_starved', (c) => c.manaAvailable, invCurve(rampCurve(2, 10)), 30),
  ],
  draw: [
    pref('draw_hand_small', (c) => c.handSize, invCurve(rampCurve(0, 7)), 30),
    pref('draw_when_behind', (c) => c.leader.p - c.me, rampCurve(0, 0.3), 20),
  ],
  removal: [
    gate('removal_has_target', bestTargetValue, atLeast(8)),
    pref('removal_big_threat', bestTargetValue, rampCurve(8, 40), 50),
    pref(
      'removal_commander_pressure',
      (c) => c.features[c.obs.seat]?.commanderDamageTaken ?? 0,
      rampCurve(0, 1),
      40,
    ),
  ],
  sweeper: [
    gate('sweeper_only_when_behind', (c) => c.boardGap, atLeast(0.25)),
    pref(
      'sweeper_many_threats',
      (c) => c.oppCreatures - c.myCreatures,
      rampCurve(0, 6),
      40,
    ),
  ],
  counterspell: [
    gate(
      'counter_needs_enemy_spell',
      (c) =>
        c.mode === 'response'
        && c.stackTop
        && c.stackTop.controller !== c.obs.seat
          ? 1
          : 0,
      atLeast(1),
    ),
    pref('counter_big_spell', (c) => c.stackTop?.cmc ?? 0, rampCurve(2, 7), 60),
    pref(
      'counter_leader_spell',
      (c) => (c.stackTop?.controller === c.leader.seat ? 1 : 0),
      atLeast(1),
      20,
    ),
  ],
  commander: [
    pref('commander_when_behind', (c) => c.leader.p - c.me, rampCurve(0, 0.3), 25),
  ],
};
