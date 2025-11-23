/**
 * Rule 701.16: Investigate
 * 
 * "Investigate" means "Create a Clue token."
 * 
 * Reference: Rule 701.16, also see Rule 111.10f for Clue tokens
 */

export interface InvestigateAction {
  readonly type: 'investigate';
  readonly playerId: string;
  readonly count: number; // Number of Clue tokens to create
}

/**
 * Rule 701.16a: Investigate creates Clue tokens
 * 
 * "Investigate" means "Create a Clue token."
 * A Clue token is a colorless artifact token with "{2}, Sacrifice this artifact: Draw a card."
 */
export function investigate(playerId: string, count: number = 1): InvestigateAction {
  return {
    type: 'investigate',
    playerId,
    count,
  };
}

/**
 * Clue token characteristics (Rule 111.10f)
 * 
 * A Clue token is a colorless artifact token with:
 * - Type: Artifact
 * - Subtype: Clue
 * - Ability: "{2}, Sacrifice this artifact: Draw a card."
 */
export const CLUE_TOKEN_CHARACTERISTICS = {
  name: 'Clue',
  type: 'Artifact',
  subtype: 'Clue',
  colors: [],
  ability: '{2}, Sacrifice this artifact: Draw a card.',
} as const;
