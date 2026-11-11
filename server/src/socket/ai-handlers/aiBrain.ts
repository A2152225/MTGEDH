/**
 * Brain switch: v0 / shadow / v1 over action-candidate lists (P1-5).
 *
 * Origin: AI_Upgrade Phase 1 (P1-5).
 * Public entry symbols: Brain, ShadowRecord, getSeatBrain, applyBrain, takeShadow.
 */

import { buildObservation } from '../../../../rules-engine/src/ai/buildObservation.js';
import {
  buildScoreContext,
  rankCandidates,
  type CandidateView,
} from '../../../../rules-engine/src/ai/utilityScorer.js';
import type {
  AIActionCandidate,
  AIActionCandidateQuery,
} from './aiActionCandidateTypes.js';
import { getCardAIProfile } from './aiCardProfile.js';

export type Brain = 'v0' | 'shadow' | 'v1';

export interface ShadowRecord {
  brain: 'shadow' | 'v1';
  winProb: Record<string, number>;
  scores: Array<{
    v0Index: number;
    score: number;
    dropped: boolean;
    parts: Record<string, number>;
  }>;
}

const isBrain = (x: unknown): x is Brain => x === 'v0' || x === 'shadow' || x === 'v1';

const shadowRecords = new WeakMap<object, ShadowRecord>();
let warnedScorerFailure = false;

export function getSeatBrain(game: any, playerId: string): Brain {
  const seat = (game?.state?.players ?? []).find((p: any) => p?.id === playerId)?.aiBrain;
  if (isBrain(seat)) return seat;
  return isBrain(process.env.AI_BRAIN) ? process.env.AI_BRAIN : 'v0';
}

export function takeShadow(list: object): ShadowRecord | undefined {
  const record = shadowRecords.get(list);
  if (record) shadowRecords.delete(list);
  return record;
}

function toView(candidate: AIActionCandidate, index: number): CandidateView {
  if (candidate.kind === 'cast_spell') {
    const spell = candidate.spell;
    const card = spell?.castCard || spell?.card;
    return {
      index,
      kind: 'cast_spell',
      name: typeof card?.name === 'string' ? card.name : undefined,
      cmc: Number(spell?.cmc) || 0,
      typeLine: String(spell?.typeLine || card?.type_line || ''),
      v0Priority: Number(candidate.priority) || 0,
    };
  }
  if (candidate.kind === 'cast_commander') {
    const card = candidate.commander?.card;
    return {
      index,
      kind: 'cast_commander',
      name: typeof card?.name === 'string' ? card.name : undefined,
      cmc: Number(card?.cmc) || 0,
      typeLine: String(card?.type_line || ''),
      v0Priority: Number(candidate.priority) || 0,
    };
  }
  if (candidate.kind === 'play_land') {
    return {
      index,
      kind: 'play_land',
      name: typeof candidate.land?.card?.name === 'string' ? candidate.land.card.name : undefined,
      v0Priority: Number(candidate.priority) || 0,
    };
  }
  return {
    index,
    kind: 'activate_ability',
    name: String(candidate.ability?.action?.cardName || '') || undefined,
    v0Priority: Number(candidate.priority) || 0,
  };
}

/**
 * Apply the seat's brain to a v0-sorted candidate list.
 * v0: same array. shadow: same array + WeakMap record. v1: reordered / drops removed.
 */
export function applyBrain(
  game: any,
  playerId: string,
  query: AIActionCandidateQuery,
  sorted: AIActionCandidate[],
): AIActionCandidate[] {
  const brain = getSeatBrain(game, playerId);
  if (brain === 'v0' || sorted.length === 0) return sorted;

  const kinds = query.kinds;
  if (
    kinds
    && !kinds.includes('cast_spell')
    && !kinds.includes('cast_commander')
  ) {
    return sorted;
  }

  try {
    const obs = buildObservation(game.state, playerId);
    const ctx = buildScoreContext(obs);
    const ranked = rankCandidates(
      obs,
      sorted.map((c, i) => toView(c, i)),
      getCardAIProfile,
      ctx,
    );
    const keep = ranked
      .filter((r) => !r.dropped)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const out = brain === 'v1' ? keep.map((r) => sorted[r.index]) : sorted;
    // For shadow, scores align with v0 order; for v1, align with the returned order.
    const order = brain === 'v1' ? keep.map((r) => r.index) : sorted.map((_, i) => i);
    const rankedByIndex = new Map(ranked.map((r) => [r.index, r]));
    shadowRecords.set(out, {
      brain,
      winProb: ctx.p,
      scores: order.map((i) => {
        const r = rankedByIndex.get(i)!;
        return {
          v0Index: i,
          score: r.score,
          dropped: r.dropped,
          parts: r.parts,
        };
      }),
    });
    return out;
  } catch (err) {
    if (!warnedScorerFailure) {
      warnedScorerFailure = true;
      console.warn('[ai] brain scorer failed, using v0 order', err);
    }
    return sorted;
  }
}
