/**
 * Utility scorer: rank v0 action candidates with role policies (P1-5).
 *
 * Origin: AI_Upgrade Phase 1 (P1-5).
 * Public entry symbols: CandidateView, ScoreContext, Consideration, ScoredCandidate,
 * EMPTY_PROFILE, buildScoreContext, rankCandidates.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import type { CardAIProfile } from './cardProfileTypes.js';
import type { Observation, StackItemView } from './observation.js';
import { seatFeatures, type SeatFeatures } from './evaluatorFeatures.js';
import { getEvalWeights, seatValues } from './evaluator.js';
import { winProbabilities } from './winProbability.js';
import { POLICIES, clamp01, type PolicyRole } from './rolePolicies.js';

export interface CandidateView {
  index: number;
  kind: 'play_land' | 'cast_spell' | 'cast_commander' | 'activate_ability';
  name?: string;
  cmc?: number;
  typeLine?: string;
  v0Priority: number;
}

export interface ScoreContext {
  obs: Observation;
  features: Record<PlayerID, SeatFeatures>;
  p: Record<PlayerID, number>;
  me: number;
  leader: { seat: PlayerID; p: number };
  boardGap: number;
  myCreatures: number;
  oppCreatures: number;
  manaAvailable: number;
  turn: number;
  handSize: number;
  mode: 'main' | 'response';
  stackTop?: StackItemView;
  cand: CandidateView;
  profile: CardAIProfile;
}

export interface Consideration {
  name: string;
  kind: 'gate' | 'preference';
  input: (ctx: ScoreContext) => number;
  curve: (x: number) => number;
  weight?: number;
}

export interface ScoredCandidate {
  index: number;
  score: number;
  parts: Record<string, number>;
  dropped: boolean;
}

export const EMPTY_PROFILE: CardAIProfile = {
  oracleId: '',
  name: '',
  roles: [],
  timing: 'sorcery_speed',
  needs: [],
  source: 'ir',
};

const SCOPED_ROLES = new Set<PolicyRole>([
  'ramp',
  'draw',
  'removal',
  'sweeper',
  'counterspell',
]);

function countCreatures(bf: { types: string[] }[]): number {
  let n = 0;
  for (const p of bf) if (p.types.includes('creature')) n += 1;
  return n;
}

function poolMana(pool: Observation['self']['manaPool']): number {
  if (!pool) return 0;
  return (
    (pool.white || 0)
    + (pool.blue || 0)
    + (pool.black || 0)
    + (pool.red || 0)
    + (pool.green || 0)
    + (pool.colorless || 0)
  );
}

export function buildScoreContext(obs: Observation): Omit<ScoreContext, 'cand' | 'profile'> {
  const features = seatFeatures(obs);
  const values = seatValues(features, getEvalWeights());
  const eliminated = obs.opponents.filter((o) => o.eliminated).map((o) => o.id);
  const p = winProbabilities(values, eliminated);
  const me = p[obs.seat] ?? 0;

  let leaderSeat: PlayerID = obs.seat;
  let leaderP = -1;
  for (const [id, prob] of Object.entries(p) as Array<[PlayerID, number]>) {
    if (id === obs.seat) continue;
    if (eliminated.includes(id)) continue;
    if (prob > leaderP) {
      leaderP = prob;
      leaderSeat = id;
    }
  }

  const myBoard = features[obs.seat]?.boardValue ?? 0;
  const oppBoards = obs.opponents
    .filter((o) => !o.eliminated)
    .map((o) => features[o.id]?.boardValue ?? 0);
  const avgOpp = oppBoards.length
    ? oppBoards.reduce((a, b) => a + b, 0) / oppBoards.length
    : 0;
  const boardGap = (avgOpp - myBoard) / Math.max(avgOpp, 1 / 60);

  let oppCreatures = 0;
  for (const o of obs.opponents) {
    if (o.eliminated) continue;
    oppCreatures += countCreatures(o.battlefield);
  }

  const untappedManaSources = obs.self.battlefield.filter(
    (perm) => perm.producesMana && !perm.tapped,
  ).length;

  const mode: 'main' | 'response' = obs.stack.length > 0 ? 'response' : 'main';
  const stackTop = obs.stack.length > 0 ? obs.stack[obs.stack.length - 1] : undefined;

  return {
    obs,
    features,
    p,
    me,
    leader: { seat: leaderSeat, p: Math.max(0, leaderP) },
    boardGap,
    myCreatures: countCreatures(obs.self.battlefield),
    oppCreatures,
    manaAvailable: untappedManaSources + poolMana(obs.self.manaPool),
    turn: obs.turn,
    handSize: obs.self.hand.length,
    mode,
    stackTop,
  };
}

function scopedRoles(
  cand: CandidateView,
  profile: CardAIProfile | undefined,
): PolicyRole[] {
  const roles: PolicyRole[] = [];
  if (cand.kind === 'cast_commander') roles.push('commander');
  if (cand.kind !== 'cast_spell' && cand.kind !== 'cast_commander') return roles;
  if (!profile) return roles;
  for (const r of profile.roles) {
    if (SCOPED_ROLES.has(r as PolicyRole)) roles.push(r as PolicyRole);
  }
  return roles;
}

export function rankCandidates(
  obs: Observation,
  candidates: CandidateView[],
  profile: (name: string) => CardAIProfile | undefined,
  base: Omit<ScoreContext, 'cand' | 'profile'> = buildScoreContext(obs),
): ScoredCandidate[] {
  return candidates.map((cand) => {
    const prof = cand.name ? profile(cand.name) : undefined;
    const roles = scopedRoles(cand, prof);
    if (roles.length === 0) {
      return { index: cand.index, score: cand.v0Priority, parts: {}, dropped: false };
    }
    const ctx: ScoreContext = {
      ...base,
      cand,
      profile: prof ?? EMPTY_PROFILE,
    };
    let pref = 0;
    let gate = 1;
    const parts: Record<string, number> = {};
    for (const role of roles) {
      for (const k of POLICIES[role]) {
        const y = clamp01(k.curve(k.input(ctx)));
        parts[`${role}.${k.name}`] = y;
        if (k.kind === 'gate') gate *= y;
        else pref += (k.weight ?? 0) * y;
      }
    }
    if (gate === 0) {
      return { index: cand.index, score: 0, parts, dropped: true };
    }
    return {
      index: cand.index,
      score: (cand.v0Priority + pref) * gate,
      parts,
      dropped: false,
    };
  });
}
