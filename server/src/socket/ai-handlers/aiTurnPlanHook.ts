/**
 * Server wrapper for P2-7 turn planner.
 *
 * Origin: AI_Upgrade Phase 0-2 plan P2-7 / rules-engine planTurn.
 * Public entry symbols: applyTurnPlanToMainCandidates, TurnPlanHookResult.
 *
 * Converts AIActionCandidates → PlannerCandidates, runs planTurn, and reorders
 * the list so the first planned play is tried first. Lands stay outside this hook.
 */

import {
  planTurn,
  type PlannerCandidate,
  type TurnPlan,
} from '../../../../rules-engine/src/ai/turnPlanner.js';
import {
  buildObservation,
} from '../../../../rules-engine/src/ai/buildObservation.js';
import {
  buildScoreContext,
  rankCandidates,
  type CandidateView,
} from '../../../../rules-engine/src/ai/utilityScorer.js';
import type { CardRole } from '../../../../rules-engine/src/ai/cardProfileTypes.js';
import { getAvailableMana, getTotalManaFromPool } from '../../state/modules/mana-check.js';
import type { AIActionCandidate } from './aiActionCandidateTypes.js';
import { getCardAIProfile } from './aiCardProfile.js';
import { getSeatBrain } from './aiBrain.js';
import {
  aiCandidateStableKey,
  getAvailableManaCached,
  getCachedObservation,
  reorderByStickyKeys,
  readStickyTurnPlanOrder,
  setCachedObservation,
  writeStickyTurnPlanOrder,
} from './aiDecisionCache.js';

export interface TurnPlanHookResult {
  candidates: AIActionCandidate[];
  plan: TurnPlan | null;
  ms: number;
  reason: string;
}

function candidateName(c: AIActionCandidate): string {
  if (c.kind === 'cast_spell') {
    return String(c.spell?.castCard?.name || c.spell?.card?.name || '');
  }
  if (c.kind === 'cast_commander') {
    return String(c.commander?.card?.name || '');
  }
  if (c.kind === 'activate_ability') {
    return String(c.ability?.action?.cardName || '');
  }
  return '';
}

function candidateCmc(c: AIActionCandidate): number {
  if (c.kind === 'cast_spell') {
    return Number(c.spell?.cmc) || 0;
  }
  if (c.kind === 'cast_commander') {
    return Number(c.commander?.card?.cmc) || 0;
  }
  return 0;
}

function candidateOracle(c: AIActionCandidate): string {
  if (c.kind === 'cast_spell') {
    return String(c.spell?.castCard?.oracle_text || c.spell?.card?.oracle_text || '');
  }
  if (c.kind === 'cast_commander') {
    return String(c.commander?.card?.oracle_text || '');
  }
  return '';
}

function candidateTypeLine(c: AIActionCandidate): string {
  if (c.kind === 'cast_spell') {
    return String(c.spell?.typeLine || c.spell?.castCard?.type_line || c.spell?.card?.type_line || '');
  }
  if (c.kind === 'cast_commander') {
    return String(c.commander?.card?.type_line || '');
  }
  return '';
}

function isInstantSpeed(c: AIActionCandidate): boolean {
  const tl = candidateTypeLine(c).toLowerCase();
  if (tl.includes('instant')) return true;
  const oracle = candidateOracle(c).toLowerCase();
  return /\bflash\b/.test(oracle);
}

function inferManaProduced(c: AIActionCandidate): { produced: number; sick: boolean } {
  const oracle = candidateOracle(c);
  const tl = candidateTypeLine(c).toLowerCase();
  const addMatch = oracle.match(/\{T\}:\s*Add\s*((?:\{[WUBRGC]\}|\{\d+\})+)/i);
  if (!addMatch) return { produced: 0, sick: false };
  const symbols = addMatch[1].match(/\{[WUBRGC]\}|\{\d+\}/gi) || [];
  let produced = 0;
  for (const s of symbols) {
    const n = s.match(/\{(\d+)\}/);
    produced += n ? Number(n[1]) : 1;
  }
  const sick = tl.includes('creature');
  return { produced, sick };
}

function toView(c: AIActionCandidate, index: number): CandidateView {
  return {
    index,
    kind: c.kind === 'play_land' ? 'play_land' : c.kind,
    name: candidateName(c) || undefined,
    cmc: candidateCmc(c),
    typeLine: candidateTypeLine(c),
    v0Priority: Number(c.priority) || 0,
  };
}

function toPlanner(
  c: AIActionCandidate,
  index: number,
  score: number,
): PlannerCandidate | null {
  if (c.kind === 'play_land') return null;
  const kind =
    c.kind === 'cast_commander'
      ? 'cast_commander'
      : c.kind === 'activate_ability'
        ? 'activate_ability'
        : 'cast_spell';
  const name = candidateName(c);
  const profile = getCardAIProfile(name);
  const roles = [...(profile?.roles || [])] as CardRole[];
  const { produced, sick } = inferManaProduced(c);
  if (produced > 0 && !roles.includes('ramp')) roles.push('ramp');
  return {
    id: `${kind}:${name || index}:${index}`,
    kind,
    score,
    manaCost: candidateCmc(c),
    roles,
    instantSpeed: isInstantSpeed(c),
    manaProduced: produced || undefined,
    producedManaSick: sick || undefined,
  };
}

/**
 * Reorder main-phase cast/activation candidates by planTurn's first play.
 * No-op for non-v2 brains or empty lists.
 */
export function applyTurnPlanToMainCandidates(
  game: any,
  playerId: string,
  candidates: AIActionCandidate[],
): TurnPlanHookResult {
  const t0 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  const brain = getSeatBrain(game, playerId);
  if (brain !== 'v2' && brain !== 'shadow') {
    return { candidates, plan: null, ms: 0, reason: 'brain-skip' };
  }

  const actionable = candidates.filter((c) => c.kind !== 'play_land');
  if (actionable.length === 0) {
    return { candidates, plan: null, ms: 0, reason: 'no-actions' };
  }

  const bfSize = Array.isArray(game?.state?.battlefield) ? game.state.battlefield.length : 0;
  // planTurn+rankCandidates on mid/large boards burns exclusive-AI wall time inside one
  // self-play tick (shard 19: bf≈34, single tick >180s → tick-timeout). Keep v0 order.
  if (bfSize > 20 || actionable.length > 10) {
    return {
      candidates,
      plan: null,
      ms: 0,
      reason: `skip-large:bf=${bfSize},n=${actionable.length}`,
    };
  }

  // Reuse the first plan's ordering for the rest of this MAIN1/MAIN2 window so later
  // wakes do not rebuild observation + rank + planTurn after every cast/pass.
  if (brain === 'v2') {
    const sticky = readStickyTurnPlanOrder(game, playerId);
    if (sticky) {
      const reordered = reorderByStickyKeys(candidates, sticky);
      if (reordered) {
        const tSticky =
          typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        return {
          candidates: reordered,
          plan: null,
          ms: tSticky - t0,
          reason: 'sticky-order',
        };
      }
    }
  }

  try {
    let obs = getCachedObservation(game, playerId);
    if (!obs) {
      obs = buildObservation(game.state, playerId);
      setCachedObservation(game, playerId, obs);
    }
    const ctx = buildScoreContext(obs);
    const ranked = rankCandidates(
      obs,
      actionable.map((c, i) => toView(c, i)),
      getCardAIProfile,
      ctx,
    );
    const scoreByIndex = new Map(ranked.map((r) => [r.index, r.dropped ? -1e9 : r.score]));

    const plannerCands: PlannerCandidate[] = [];
    const indexByPlannerId = new Map<string, number>();
    for (let i = 0; i < actionable.length; i++) {
      const score = scoreByIndex.get(i);
      const fallback = Number(actionable[i].priority) || 0;
      const pc = toPlanner(actionable[i], i, Number.isFinite(score) ? (score as number) : fallback);
      if (!pc) continue;
      if (pc.score <= -1e8) continue;
      plannerCands.push(pc);
      indexByPlannerId.set(pc.id, i);
    }

    const manaAvailable = getTotalManaFromPool(
      getAvailableManaCached(game, playerId, () => getAvailableMana(game.state, playerId)),
    );
    const plan = planTurn({
      candidates: plannerCands,
      manaAvailable,
      affordable: (plays) => {
        let floating = manaAvailable;
        for (const p of plays) {
          if (p.manaCost > floating) return false;
          floating -= p.manaCost;
          if ((p.manaProduced || 0) > 0 && !p.producedManaSick) {
            floating += p.manaProduced || 0;
          }
        }
        return true;
      },
    });

    const t1 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    if (brain === 'shadow') {
      // Keep v0 order; attach plan only for tracing.
      return {
        candidates,
        plan,
        ms: t1 - t0,
        reason: `shadow:${plan.plays.map((p) => p.id).join(',') || 'none'}`,
      };
    }

    if (plan.plays.length === 0) {
      return { candidates, plan, ms: t1 - t0, reason: 'empty-plan' };
    }

    // Prefer planner play order as sticky keys; fall back to scored actionable order.
    const stickyKeys: string[] = [];
    for (const play of plan.plays) {
      const idx = indexByPlannerId.get(play.id);
      if (idx === undefined) continue;
      stickyKeys.push(aiCandidateStableKey(actionable[idx]));
    }
    for (const c of actionable) {
      const key = aiCandidateStableKey(c);
      if (!stickyKeys.includes(key)) stickyKeys.push(key);
    }
    writeStickyTurnPlanOrder(game, playerId, stickyKeys);

    const firstId = plan.plays[0].id;
    const firstIdx = indexByPlannerId.get(firstId);
    if (firstIdx === undefined) {
      return { candidates, plan, ms: t1 - t0, reason: 'first-missing' };
    }

    const first = actionable[firstIdx];
    const rest = candidates.filter((c) => c !== first);
    return {
      candidates: [first, ...rest],
      plan,
      ms: t1 - t0,
      reason: `first:${firstId}`,
    };
  } catch (err) {
    console.warn('[ai] v2 turn planner failed, keeping candidate order', err);
    return { candidates, plan: null, ms: 0, reason: 'error' };
  }
}
