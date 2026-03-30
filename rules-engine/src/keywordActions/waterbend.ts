/**
 * Rule 701.67: Waterbend
 * 
 * "Waterbend [cost]" means "Pay [cost]. For each generic mana in that cost, you
 * may tap an untapped artifact or creature you control rather than pay that mana."
 * 
 * Reference: Rule 701.67
 */

export interface WaterbendAction {
  readonly type: 'waterbend';
  readonly playerId: string;
  readonly cost: string;
  readonly tappedPermanents?: readonly string[];
  readonly manaPaid?: string;
}

export interface WaterbendResult {
  readonly playerId: string;
  readonly originalCost: string;
  readonly tappedPermanentCount: number;
  readonly remainingCost: string;
  readonly manaPaid?: string;
  readonly triggersWaterbendAbilities: boolean;
}

export interface WaterbendCostBreakdown {
  readonly genericMana: number;
  readonly nonGenericSymbols: readonly string[];
}

type WaterbendPermanentLike = {
  readonly isArtifact?: boolean;
  readonly isCreature?: boolean;
  readonly isTapped?: boolean;
  readonly tapped?: boolean;
  readonly type_line?: string;
  readonly card?: {
    readonly type_line?: string;
  };
};

function tokenizeCost(cost: string): string[] {
  const raw = String(cost || '').trim();
  if (!raw) {
    return [];
  }

  const braced = [...raw.matchAll(/\{([^}]+)\}/g)].map((match) => String(match[1] || '').trim().toUpperCase()).filter(Boolean);
  if (braced.length > 0) {
    return braced;
  }

  const compact = raw.replace(/\s+/g, '').toUpperCase();
  const tokens: string[] = [];
  for (let index = 0; index < compact.length;) {
    if (/\d/.test(compact[index])) {
      let nextIndex = index + 1;
      while (nextIndex < compact.length && /\d/.test(compact[nextIndex])) {
        nextIndex += 1;
      }
      tokens.push(compact.slice(index, nextIndex));
      index = nextIndex;
      continue;
    }

    tokens.push(compact[index]);
    index += 1;
  }

  return tokens;
}

function formatCost(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    return '{0}';
  }

  return tokens.map((token) => `{${token}}`).join('');
}

/**
 * Parse the waterbend cost into generic and non-generic portions.
 */
export function parseWaterbendCost(cost: string): WaterbendCostBreakdown {
  const tokens = tokenizeCost(cost);
  let genericMana = 0;
  const nonGenericSymbols: string[] = [];

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      genericMana += parseInt(token, 10);
    } else {
      nonGenericSymbols.push(token);
    }
  }

  return {
    genericMana,
    nonGenericSymbols,
  };
}

/**
 * The maximum number of generic mana substitutions waterbend can provide.
 */
export function getMaxWaterbendSubstitutions(cost: string): number {
  return parseWaterbendCost(cost).genericMana;
}

/**
 * Get the remaining mana cost after substituting tapped permanents for generic mana.
 */
export function getWaterbendRemainingCost(cost: string, tappedPermanentCount: number): string {
  const breakdown = parseWaterbendCost(cost);
  const reducedGeneric = Math.max(0, breakdown.genericMana - Math.max(0, tappedPermanentCount));
  const tokens = [
    ...(reducedGeneric > 0 ? [String(reducedGeneric)] : []),
    ...breakdown.nonGenericSymbols,
  ];

  return formatCost(tokens);
}

/**
 * Rule 701.67a: Waterbend [cost]
 */
export function waterbend(playerId: string, cost: string): WaterbendAction {
  return {
    type: 'waterbend',
    playerId,
    cost,
  };
}

/**
 * Complete waterbend with payment
 */
export function completeWaterbend(
  playerId: string,
  cost: string,
  tappedPermanents: readonly string[],
  manaPaid: string
): WaterbendAction {
  return {
    type: 'waterbend',
    playerId,
    cost,
    tappedPermanents,
    manaPaid,
  };
}

/**
 * Rule 701.67b: Only for waterbend cost
 */
export const WATERBEND_ONLY_FOR_WATERBEND_COST = true;

/**
 * Rule 701.67c: Waterbend trigger
 */
export function triggersWhenWaterbends(paidWaterbendCost: boolean): boolean {
  return paidWaterbendCost;
}

/**
 * Check if can tap for waterbend
 */
export function canTapForWaterbend(
  permanent: WaterbendPermanentLike
): boolean {
  const typeLine = String(permanent.type_line || permanent.card?.type_line || '').toLowerCase();
  const isArtifact = permanent.isArtifact === true || typeLine.includes('artifact');
  const isCreature = permanent.isCreature === true || typeLine.includes('creature');
  const isTapped = permanent.isTapped === true || permanent.tapped === true;
  return (isArtifact || isCreature) && !isTapped;
}

export function createWaterbendResult(action: WaterbendAction): WaterbendResult {
  const tappedPermanentCount = action.tappedPermanents?.length || 0;

  return {
    playerId: action.playerId,
    originalCost: action.cost,
    tappedPermanentCount,
    remainingCost: getWaterbendRemainingCost(action.cost, tappedPermanentCount),
    manaPaid: action.manaPaid,
    triggersWaterbendAbilities: triggersWhenWaterbends(Boolean(action.manaPaid) || tappedPermanentCount > 0),
  };
}
