import { describe, expect, it } from 'vitest';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { handleVoteResponse } from '../src/socket/resolutionVoteProliferateLimDulResponseHandlers.js';
import { tryHandleExtraVoteOfferChoice } from '../src/socket/resolutionOptionChoiceExtraVoteHandlers.js';
import { countAdditionalVotes } from '../src/state/modules/voteAdditionalVotes.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1'): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, keywords: [] } };
}
const io: any = { to: () => ({ emit: () => {} }), emit: () => {} };

describe('batch28 extra votes', () => {
  it('re-queues a VOTE for a voter with Ballot Broker before moving on', () => {
    const gameId = 'b28_vote_extra';
    ResolutionQueueManager.removeQueue(gameId);
    const broker = perm('bb', 'Ballot Broker', 'Creature', 'While voting, you may vote an additional time.');
    const game: any = { state: { battlefield: [broker], players: [{ id: 'p1' }, { id: 'p2' }] } };
    expect(countAdditionalVotes(game.state, 'p1')).toBe(1);
    const step: any = { id: 's1', type: ResolutionStepType.VOTE, playerId: 'p1', voteId: 'v1', choices: ['a', 'b'], votesSubmitted: [], oracleIrVoterOrder: ['p1', 'p2'] };
    handleVoteResponse(io, game, gameId, step, { playerId: 'p1', selections: 'a' } as any);
    let q = ResolutionQueueManager.getQueue(gameId).steps as any[];
    expect(q[q.length - 1].playerId).toBe('p1');
    expect(q[q.length - 1].extraVoteOffer).toBe(true); // B29: optional offer first
    void tryHandleExtraVoteOfferChoice(io, game, gameId, q[q.length - 1], { playerId: 'p1', selections: ['vote_again'] } as any);
    q = ResolutionQueueManager.getQueue(gameId).steps as any[];
    const step2 = q[q.length - 1];
    handleVoteResponse(io, game, gameId, step2, { playerId: 'p1', selections: 'b' } as any);
    q = ResolutionQueueManager.getQueue(gameId).steps as any[];
    expect(q[q.length - 1].playerId).toBe('p2');
    expect(q[q.length - 1].votesSubmitted.length).toBe(2);
    ResolutionQueueManager.removeQueue(gameId);
  });
  it('no extra vote without the static', () => {
    expect(countAdditionalVotes({ battlefield: [perm('x', 'Bear', 'Creature', '', 'p1')] }, 'p1')).toBe(0);
  });
});

describe('batch28 drawn-cards conditional unblockable', () => {
  const june = perm('j', 'June, Bounty Hunter', 'Legendary Creature', "June can't be blocked as long as you've drawn two or more cards this turn.");
  const blocker = perm('b', 'Bear', 'Creature', '', 'p2');
  it('is unblockable after two draws', () => {
    const state: any = { battlefield: [june, blocker], cardsDrawnThisTurn: { p1: 2 } };
    expect(canBlockAttacker(blocker, june, state.battlefield, 'p2', state).canBlock).toBe(false);
  });
  it('is blockable after one draw', () => {
    const state: any = { battlefield: [june, blocker], cardsDrawnThisTurn: { p1: 1 } };
    expect(canBlockAttacker(blocker, june, state.battlefield, 'p2', state).canBlock).toBe(true);
  });
});
