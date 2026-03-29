/**
 * Rule 701.4: Behold
 * 
 * "Behold a [quality]" means "Reveal a [quality] card from your hand or
 * choose a [quality] permanent you control on the battlefield."
 */

export interface BeholdAction {
  readonly type: 'behold';
  readonly playerId: string;
  readonly quality: string; // e.g., "legendary", "artifact"
  readonly choice: 'revealed-card' | 'chosen-permanent';
  readonly cardOrPermanentId: string;
}

type BeholdCandidate = {
  readonly id?: string;
  readonly qualities?: readonly string[];
  readonly type_line?: string;
  readonly card?: {
    readonly type_line?: string;
  };
  readonly isLegendary?: boolean;
};

function getCandidateText(candidate: BeholdCandidate): string {
  return `${String(candidate.type_line || candidate.card?.type_line || '')} ${String((candidate.qualities || []).join(' '))}`.toLowerCase();
}

/**
 * Rule 701.4b: Quality checking
 * 
 * The phrase "if a [quality] was beheld" refers to whether or not the object
 * had that quality at the time the player took that action.
 */
export function createBeholdAction(
  playerId: string,
  quality: string,
  choice: 'revealed-card' | 'chosen-permanent',
  cardOrPermanentId: string
): BeholdAction {
  return {
    type: 'behold',
    playerId,
    quality,
    choice,
    cardOrPermanentId,
  };
}

export function wasBeheld(action: BeholdAction, quality: string): boolean {
  return action.quality === quality;
}

/**
 * Check whether a proposed object satisfies the quality being beheld.
 */
export function canBeholdQuality(candidate: BeholdCandidate, quality: string): boolean {
  const normalizedQuality = String(quality || '').trim().toLowerCase();
  if (!normalizedQuality) {
    return false;
  }

  if (normalizedQuality === 'legendary') {
    return candidate.isLegendary === true || getCandidateText(candidate).includes('legendary');
  }

  return getCandidateText(candidate).includes(normalizedQuality);
}

/**
 * Check whether the behold action used a permanent rather than a revealed card.
 */
export function beheldPermanent(action: BeholdAction): boolean {
  return action.choice === 'chosen-permanent';
}

/**
 * Return the object id used to behold the required quality.
 */
export function getBeholdedObjectId(action: BeholdAction): string {
  return action.cardOrPermanentId;
}
