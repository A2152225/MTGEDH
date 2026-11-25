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

/**
 * Skip planTurn above this battlefield size (stall: shard 19 bf≈34).
 * Kept at 20 after strength smokes: raising full-rank to 32 looked worse, and a
 * light priority-only plan for bf 21–48 also regressed smoke6 (1–8 / 11%).
 * Smoke38 mild 24 → 18.2%; smoke39 disable (0) → 30% (no lift vs smoke14 window) — keep 20.
 */
export const TURN_PLAN_SKIP_BF = 20;
/** Cap actionable plays fed to rank+planTurn (keep enum cost bounded). */
// Smoke63: 10→14 with planTurn default beam 8→12 — consider more plays.
export const TURN_PLAN_MAX_ACTIONABLE = 14;

/** MAIN2 holds up interaction; MAIN1 dumps mana into development. */
export function shouldHoldUpInteractionForStep(step: unknown): boolean {
  return String(step || '').toUpperCase().includes('MAIN2');
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
    kind: c.kind === 'cast_commander' || c.kind === 'activate_ability' || c.kind === 'play_land'
      ? c.kind
      : 'cast_spell',
    name: candidateName(c) || undefined,
    cmc: candidateCmc(c),
    typeLine: candidateTypeLine(c),
    v0Priority: Number(c.priority) || 0,
  };
}

/** Cheap oracle heuristics when the profile table has no roles (~half of cards). */
function inferPlannerRolesFromOracle(
  typeLine: string,
  oracle: string,
  instantSpeed: boolean,
): CardRole[] {
  const roles: CardRole[] = [];
  const o = String(oracle || '').toLowerCase();
  const tl = String(typeLine || '').toLowerCase();
  if (/counter target (spell|ability)/i.test(o)) roles.push('counterspell');
  if (
    instantSpeed
    && (
      /\bgain protection\b|\bhexproof\b|\bindestructible\b|\bphase out\b|\bprevent all (combat )?damage\b/i.test(o)
      || (tl.includes('instant') && /\bregenerate\b|\bshroud\b/i.test(o))
    )
  ) {
    roles.push('protection');
  }
  return roles;
}

function toPlanner(
  c: AIActionCandidate,
  index: number,
  score: number,
): PlannerCandidate | null {
  if (c.kind === 'play_land' || c.kind === 'roll_planar_die') return null;
  const kind =
    c.kind === 'cast_commander'
      ? 'cast_commander'
      : c.kind === 'activate_ability'
        ? 'activate_ability'
        : 'cast_spell';
  const name = candidateName(c);
  const profile = getCardAIProfile(name);
  const roles = [...(profile?.roles || [])] as CardRole[];
  const instantSpeed = isInstantSpeed(c);
  if (roles.length === 0) {
    for (const r of inferPlannerRolesFromOracle(candidateTypeLine(c), candidateOracle(c), instantSpeed)) {
      if (!roles.includes(r)) roles.push(r);
    }
  }
  const { produced, sick } = inferManaProduced(c);
  if (produced > 0 && !roles.includes('ramp')) roles.push('ramp');
  return {
    id: `${kind}:${name || index}:${index}`,
    kind,
    score,
    manaCost: candidateCmc(c),
    roles,
    instantSpeed,
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

  const actionable = candidates.filter((c) => c.kind !== 'play_land' && c.kind !== 'roll_planar_die');
  if (actionable.length === 0) {
    return { candidates, plan: null, ms: 0, reason: 'no-actions' };
  }

  const bfSize = Array.isArray(game?.state?.battlefield) ? game.state.battlefield.length : 0;
  // Large boards: planTurn+rankCandidates burned exclusive-AI wall time (shard 19 bf≈34).
  if (bfSize > TURN_PLAN_SKIP_BF) {
    return {
      candidates,
      plan: null,
      ms: 0,
      reason: `skip-large:bf=${bfSize},n=${actionable.length}`,
    };
  }
  const planPool =
    actionable.length > TURN_PLAN_MAX_ACTIONABLE
      ? actionable.slice(0, TURN_PLAN_MAX_ACTIONABLE)
      : actionable;

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
      planPool.map((c, i) => toView(c, i)),
      getCardAIProfile,
      ctx,
    );
    const scoreByIndex = new Map(ranked.map((r) => [r.index, r.dropped ? -1e9 : r.score]));

    const plannerCands: PlannerCandidate[] = [];
    const indexByPlannerId = new Map<string, number>();
    for (let i = 0; i < planPool.length; i++) {
      const score = scoreByIndex.get(i);
      const fallback = Number(planPool[i].priority) || 0;
      const pc = toPlanner(planPool[i], i, Number.isFinite(score) ? (score as number) : fallback);
      if (!pc) continue;
      if (pc.score <= -1e8) continue;
      plannerCands.push(pc);
      indexByPlannerId.set(pc.id, i);
    }

    const manaAvailable = getTotalManaFromPool(
      getAvailableManaCached(game, playerId, () => getAvailableMana(game.state, playerId)),
    );
    // MAIN1: dump into development (no counter/protection reserve). MAIN2: hold up.
    // Default hold-up on both mains left v2 under-casting when a Counterspell sat in hand.
    // Smoke20 soft-dump / exclude-holdup-from-plays regressed (20%) — keep hold-up as-is.
    // Smoke25 MAIN1 maxPlays 4 → 11.1% decisive — reverted to default 3.
    // Smoke41 MAIN2 dump when opponents tapped out → 30% decisive — reverted.
    // Smoke42 counterspell-only hold-up (drop protection) → 27.3% — reverted.
    const holdUpInteraction = shouldHoldUpInteractionForStep(game?.state?.step);
    const plan = planTurn({
      candidates: plannerCands,
      manaAvailable,
      holdUpInteraction,
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

    // Prefer planner play order as sticky keys; fall back to scored plan-pool order.
    const stickyKeys: string[] = [];
    for (const play of plan.plays) {
      const idx = indexByPlannerId.get(play.id);
      if (idx === undefined) continue;
      stickyKeys.push(aiCandidateStableKey(planPool[idx]));
    }
    for (const c of planPool) {
      const key = aiCandidateStableKey(c);
      if (!stickyKeys.includes(key)) stickyKeys.push(key);
    }
    writeStickyTurnPlanOrder(game, playerId, stickyKeys);

    const firstId = plan.plays[0].id;
    const firstIdx = indexByPlannerId.get(firstId);
    if (firstIdx === undefined) {
      return { candidates, plan, ms: t1 - t0, reason: 'first-missing' };
    }

    const first = planPool[firstIdx];
    const rest = candidates.filter((c) => c !== first);
    const cappedNote =
      actionable.length > planPool.length ? `,capped=${planPool.length}/${actionable.length}` : '';
    return {
      candidates: [first, ...rest],
      plan,
      ms: t1 - t0,
      reason: `first:${firstId}${cappedNote}`,
    };
  } catch (err) {
    console.warn('[ai] v2 turn planner failed, keeping candidate order', err);
    return { candidates, plan: null, ms: 0, reason: 'error' };
  }
}
