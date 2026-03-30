/**
 * Assist keyword ability (Rule 702.132)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.132. Assist
 * 702.132a Assist is a static ability that modifies the rules of paying for the spell with 
 * assist (see rules 601.2g-h). If the total cost to cast a spell with assist includes a generic 
 * mana component, before you activate mana abilities while casting it, you may choose another 
 * player. That player has a chance to activate mana abilities. Once that player chooses not to 
 * activate any more mana abilities, you have a chance to activate mana abilities. Before you 
 * begin to pay the total cost of the spell, the player you chose may pay for any amount of the 
 * generic mana in the spell's total cost.
 */

export interface AssistAbility {
  readonly type: 'assist';
  readonly source: string;
  readonly assistingPlayer?: string;
  readonly manaPaidByAssist: number;
}

export interface AssistSummary {
  readonly source: string;
  readonly assistingPlayer?: string;
  readonly canChooseAssistant: boolean;
  readonly manaPaidByAssist: number;
  readonly remainingCost: string;
}

function tokenizeCost(cost: string): string[] {
  const raw = String(cost || '').trim();
  if (!raw) {
    return [];
  }

  const braced = [...raw.matchAll(/\{([^}]+)\}/g)]
    .map((match) => String(match[1] || '').trim().toUpperCase())
    .filter(Boolean);
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
 * Create an assist ability
 * Rule 702.132a
 * @param source - The spell with assist
 * @returns Assist ability object
 */
export function assist(source: string): AssistAbility {
  return {
    type: 'assist',
    source,
    manaPaidByAssist: 0,
  };
}

/**
 * Choose a player to assist with casting
 * Rule 702.132a
 * @param ability - Assist ability
 * @param playerId - ID of assisting player
 * @returns Updated ability
 */
export function chooseAssistingPlayer(ability: AssistAbility, playerId: string): AssistAbility {
  return {
    ...ability,
    assistingPlayer: playerId,
  };
}

/**
 * Apply mana paid by assisting player
 * Rule 702.132a - Can pay any amount of generic mana
 * @param ability - Assist ability
 * @param manaPaid - Amount of generic mana paid
 * @returns Updated ability
 */
export function applyAssist(ability: AssistAbility, manaPaid: number): AssistAbility {
  return {
    ...ability,
    manaPaidByAssist: Math.max(0, manaPaid),
  };
}

/**
 * Get mana paid via assist
 * @param ability - Assist ability
 * @returns Amount of mana paid by assist
 */
export function getAssistMana(ability: AssistAbility): number {
  return ability.manaPaidByAssist;
}

/**
 * Check whether another player can assist with the generic component of a spell.
 */
export function canChooseAssistingPlayer(
  casterId: string,
  candidatePlayerId: string,
  genericManaRequired: number,
): boolean {
  return String(candidatePlayerId || '') !== ''
    && String(candidatePlayerId) !== String(casterId || '')
    && genericManaRequired > 0;
}

/**
 * Return the assisting player currently chosen for the spell.
 */
export function getAssistingPlayer(ability: AssistAbility): string | undefined {
  return ability.assistingPlayer;
}

/**
 * Reduce only the generic mana component paid by assist.
 */
export function getRemainingAssistCost(cost: string, manaPaidByAssist: number): string {
  const tokens = tokenizeCost(cost);
  let generic = 0;
  const nonGeneric: string[] = [];

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      generic += Number.parseInt(token, 10);
    } else {
      nonGeneric.push(token);
    }
  }

  const remainingGeneric = Math.max(0, generic - Math.max(0, manaPaidByAssist));
  return formatCost([
    ...(remainingGeneric > 0 ? [String(remainingGeneric)] : []),
    ...nonGeneric,
  ]);
}

/**
 * Multiple instances of assist are not redundant
 * @param abilities - Array of assist abilities
 * @returns False
 */
export function hasRedundantAssist(abilities: readonly AssistAbility[]): boolean {
  return false;
}

export function createAssistSummary(
  ability: AssistAbility,
  casterId: string,
  genericManaRequired: number,
  totalCost: string,
): AssistSummary {
  return {
    source: ability.source,
    assistingPlayer: ability.assistingPlayer,
    canChooseAssistant: canChooseAssistingPlayer(casterId, ability.assistingPlayer ?? '', genericManaRequired),
    manaPaidByAssist: ability.manaPaidByAssist,
    remainingCost: getRemainingAssistCost(totalCost, ability.manaPaidByAssist),
  };
}
