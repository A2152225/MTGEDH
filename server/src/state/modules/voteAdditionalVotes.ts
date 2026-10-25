// server/src/state/modules/voteAdditionalVotes.ts
// Batch 28: CR 701.38 extra-vote statics.
//   "While voting, you may vote an additional time." (Ballot Broker, The Valeyard, Tivit, Seller of Secrets)
//   "you get an additional vote" wording is treated the same way.
// Origin parent: socket/resolutionVoteProliferateLimDulResponseHandlers.ts (handleVoteResponse), which re-queues
// a VOTE step for the same voter while extra votes remain.
// Batch 29: the extra vote is optional ("you may"); queueExtraVoteOffer asks with an OPTION_CHOICE first
// (answered by socket/resolutionOptionChoiceExtraVoteHandlers.ts).
// Public entry symbols: countAdditionalVotes, hasPendingAdditionalVote, queueExtraVoteOffer.

import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';

const EXTRA_VOTE_RE = /\bwhile voting, you may vote an additional time\b|\byou get an additional vote\b/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

/** Number of additional votes the player gets from permanents they control. */
export function countAdditionalVotes(state: any, playerId: string): number {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let n = 0;
  for (const perm of battlefield) {
    if (!perm || String(perm.controller || '') !== String(playerId)) continue;
    if (perm.phasedOut) continue;
    if (EXTRA_VOTE_RE.test(oracleOf(perm))) n += 1;
  }
  return n;
}

/** True when playerId has cast fewer ballots than 1 + their additional votes. */
export function hasPendingAdditionalVote(state: any, playerId: string, votesSubmitted: readonly any[]): boolean {
  const extra = countAdditionalVotes(state, playerId);
  if (extra <= 0) return false;
  const cast = (votesSubmitted || []).filter((v: any) => String(v?.playerId || '') === String(playerId)).length;
  return cast < 1 + extra;
}

/** B29: offer the optional extra vote; nextVoteStep is the VOTE step to queue if the player accepts. */
export function queueExtraVoteOffer(gameId: string, playerId: string, nextVoteStep: any): void {
  const name = String(nextVoteStep?.sourceName || 'Vote');
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    sourceId: nextVoteStep?.sourceId,
    sourceName: name,
    description: name + ': you may vote an additional time.',
    mandatory: true,
    options: [
      { id: 'vote_again', label: 'Vote an additional time', value: 'vote_again' },
      { id: 'decline', label: "Don't vote again", value: 'decline' },
    ],
    minSelections: 1,
    maxSelections: 1,
    extraVoteOffer: true,
    extraVoteNextStepJson: JSON.stringify(nextVoteStep || {}),
  } as any);
}
