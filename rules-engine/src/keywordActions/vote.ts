/**
 * Rule 701.38: Vote
 * 
 * Some spells and abilities instruct players to vote for one choice from a list
 * of options to determine some aspect of the effect of that spell or ability.
 * 
 * Reference: Rule 701.38
 */

export interface VoteAction {
  readonly type: 'vote';
  readonly voters: readonly string[]; // Player IDs in voting order
  readonly choices: readonly string[]; // Available choices
  readonly startingVoter?: string; // First player to vote
}

export interface VoteResult {
  readonly playerId: string;
  readonly choice: string;
  readonly voteCount: number; // For effects that give multiple votes
}

export interface VoteOutcome {
  readonly votes: readonly VoteResult[];
  readonly winner: string | null; // Choice with most votes, or null if tie
  readonly voteCounts: ReadonlyMap<string, number>; // Choice -> total votes
}

/**
 * Rule 701.38a: Voting process
 * 
 * To vote, each player, starting with a specified player and proceeding in turn
 * order, chooses one of those choices.
 */
export function startVote(
  voters: readonly string[],
  choices: readonly string[],
  startingVoter: string
): VoteAction {
  return {
    type: 'vote',
    voters,
    choices,
    startingVoter,
  };
}

/**
 * Record a player's vote
 */
export function recordVote(
  playerId: string,
  choice: string,
  voteCount: number = 1
): VoteResult {
  return {
    playerId,
    choice,
    voteCount,
  };
}

/**
 * Rule 701.38d: Multiple votes
 * 
 * If an effect gives a player multiple votes, those votes all happen at the
 * same time the player would otherwise have voted.
 */
export function createVoteWithMultipleVotes(
  playerId: string,
  choice: string,
  numberOfVotes: number
): VoteResult {
  return {
    playerId,
    choice,
    voteCount: numberOfVotes,
  };
}

/**
 * Tally votes and determine outcome
 */
export function tallyVotes(votes: readonly VoteResult[]): VoteOutcome {
  const voteCounts = new Map<string, number>();
  
  // Count all votes
  for (const vote of votes) {
    const current = voteCounts.get(vote.choice) || 0;
    voteCounts.set(vote.choice, current + vote.voteCount);
  }
  
  // Find winner (choice with most votes)
  let winner: string | null = null;
  let maxVotes = 0;
  let isTie = false;
  
  const voteEntries = Array.from(voteCounts.entries());
  for (const [choice, count] of voteEntries) {
    if (count > maxVotes) {
      maxVotes = count;
      winner = choice;
      isTie = false;
    } else if (count === maxVotes) {
      isTie = true;
    }
  }
  
  // If there's a tie, there's no single winner
  if (isTie) {
    winner = null;
  }
  
  return {
    votes,
    winner,
    voteCounts,
  };
}

/**
 * Rule 701.38c: "Voting" definition
 * 
 * If the text of a spell or ability refers to "voting," it refers only to an
 * actual vote, not to any spell or ability that involves the players making
 * choices or decisions without using the word "vote."
 */
export const VOTING_REQUIRES_VOTE_KEYWORD = true;
