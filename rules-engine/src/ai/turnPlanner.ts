/**
 * Turn planner for Phase 2 (P2-7).
 *
 * Origin: AI_Upgrade Phase 0-2 plan P2-7.
 * Public entry symbols: PlannerCandidate, TurnPlan, MANA_EFFICIENCY, planTurn.
 *
 * Beam-searches short sequences (default ≤3 plays over the top 8 candidates)
 * under a mana budget. Ranks by P1-5 scores + mana efficiency. Lands are not
 * planned (caller plays them first). Ramp is ordered before non-ramp when both
 * fit. Instant-speed interaction can reserve mana.
 */

import type { CardRole } from './cardProfileTypes.js';

export interface PlannerCandidate {
  id: string;
  kind: 'cast_spell' | 'cast_commander' | 'activate_ability';
  score: number;
  manaCost: number;
  roles: CardRole[];
  instantSpeed: boolean;
  /** Mana this play produces after resolving (rocks / rituals). Default 0. */
  manaProduced?: number;
  /** True when produced mana cannot be used the same turn (summoning sickness). */
  producedManaSick?: boolean;
}

export interface TurnPlan {
  plays: PlannerCandidate[];
  reserved: number;
  score: number;
}

/** Weight on fraction of available mana spent (including reserved interaction). */
export const MANA_EFFICIENCY = 40;

function isRamp(c: PlannerCandidate): boolean {
  return c.roles.includes('ramp');
}

function isHoldUp(c: PlannerCandidate): boolean {
  return (
    c.instantSpeed
    && (c.roles.includes('counterspell') || c.roles.includes('protection'))
  );
}

function sequenceScore(
  plays: readonly PlannerCandidate[],
  manaAvailable: number,
  reserved: number,
): number {
  const spent = plays.reduce((s, p) => s + Math.max(0, p.manaCost), 0);
  const useful = Math.min(manaAvailable, spent + reserved);
  const efficiency = manaAvailable > 0 ? useful / manaAvailable : 0;
  const value = plays.reduce((s, p) => s + p.score, 0);
  return value + MANA_EFFICIENCY * efficiency;
}

/**
 * Prefer ramp earlier in a sequence when both orderings are otherwise equal.
 * Returns a small tie-break bonus (higher is better).
 */
function rampOrderingBonus(plays: readonly PlannerCandidate[]): number {
  let bonus = 0;
  let seenNonRamp = false;
  for (const p of plays) {
    if (isRamp(p)) {
      if (seenNonRamp) bonus -= 5;
      else bonus += 2;
    } else if (!isHoldUp(p)) {
      seenNonRamp = true;
    }
  }
  return bonus;
}

export function planTurn(args: {
  candidates: PlannerCandidate[];
  manaAvailable: number;
  affordable: (plays: PlannerCandidate[]) => boolean;
  maxPlays?: number;
  beam?: number;
  /** When true, reserve mana for the cheapest hold-up candidate if any. */
  holdUpInteraction?: boolean;
}): TurnPlan {
  const maxPlays = Math.max(1, Math.min(4, args.maxPlays ?? 3));
  const beam = Math.max(1, Math.min(16, args.beam ?? 8));
  const manaAvailable = Math.max(0, Number(args.manaAvailable) || 0);
  const pool = [...args.candidates]
    .filter((c) => Number.isFinite(c.manaCost) && c.manaCost >= 0)
    .sort((a, b) => b.score - a.score || a.manaCost - b.manaCost || a.id.localeCompare(b.id))
    .slice(0, beam);

  let reserved = 0;
  if (args.holdUpInteraction !== false) {
    const holdUps = pool.filter(isHoldUp).sort((a, b) => a.manaCost - b.manaCost);
    if (holdUps.length > 0 && holdUps[0].manaCost <= manaAvailable) {
      reserved = holdUps[0].manaCost;
    }
  }

  let best: TurnPlan = { plays: [], reserved, score: sequenceScore([], manaAvailable, reserved) };

  const walk = (plays: PlannerCandidate[], depth: number): void => {
    const score = sequenceScore(plays, manaAvailable, reserved) + rampOrderingBonus(plays);
    if (score > best.score || (score === best.score && plays.length > best.plays.length)) {
      best = { plays: [...plays], reserved, score };
    }
    if (depth >= maxPlays) return;

    for (const c of pool) {
      if (plays.some((p) => p.id === c.id)) continue;
      const next = [...plays, c];
      // Approximate floating mana: prior plays' produced mana (if not sick).
      let produced = 0;
      for (const p of plays) {
        if ((p.manaProduced || 0) > 0 && !p.producedManaSick) {
          produced += p.manaProduced || 0;
        }
      }
      const budget = manaAvailable + produced;
      // Spendable budget excludes reserved hold-up unless this play is the hold-up.
      const spent = next.reduce((s, p) => s + p.manaCost, 0);
      const holdCredit = isHoldUp(c) ? 0 : reserved;
      if (spent + holdCredit > budget) continue;
      if (!args.affordable(next)) continue;
      walk(next, depth + 1);
    }
  };

  walk([], 0);
  return best;
}
