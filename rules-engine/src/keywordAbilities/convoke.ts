/**
 * Convoke keyword ability implementation (Rule 702.51)
 * @see MagicCompRules 702.51
 * 
 * 702.51a: Convoke is a static ability that functions while the spell with convoke 
 * is on the stack. "Convoke" means "For each colored mana in this spell's total cost, 
 * you may tap an untapped creature of that color you control rather than pay that mana. 
 * For each generic mana in this spell's total cost, you may tap an untapped creature 
 * you control rather than pay that mana."
 */

export interface ConvokeAbility {
  readonly type: 'convoke';
  readonly source: string;
  readonly tappedCreatures: readonly string[];
}

export interface ConvokeCreatureInfo {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly string[];  // 'W', 'U', 'B', 'R', 'G' or empty for colorless
}

export interface ConvokePayment {
  readonly creatureId: string;
  readonly paysFor: 'W' | 'U' | 'B' | 'R' | 'G' | 'generic';
}

export function convoke(source: string): ConvokeAbility {
  return { type: 'convoke', source, tappedCreatures: [] };
}

export function payConvoke(ability: ConvokeAbility, creatures: readonly string[]): ConvokeAbility {
  return { ...ability, tappedCreatures: creatures };
}

export function getConvokeReduction(ability: ConvokeAbility): number {
  return ability.tappedCreatures.length;
}

/**
 * 702.51a: Determine what mana a creature can pay for via convoke
 * - Colored creature can pay for mana of its colors OR generic mana
 * - Colorless creature can only pay for generic mana
 */
export function getConvokePaymentOptions(creature: ConvokeCreatureInfo): readonly ('W' | 'U' | 'B' | 'R' | 'G' | 'generic')[] {
  const options: ('W' | 'U' | 'B' | 'R' | 'G' | 'generic')[] = ['generic'];
  
  for (const color of creature.colors) {
    if (color === 'W' || color === 'U' || color === 'B' || color === 'R' || color === 'G') {
      if (!options.includes(color)) {
        options.push(color);
      }
    }
  }
  
  return options;
}

/**
 * Check if a creature can help pay for a specific mana requirement
 */
export function canCreaturePayFor(
  creature: ConvokeCreatureInfo, 
  manaType: 'W' | 'U' | 'B' | 'R' | 'G' | 'generic'
): boolean {
  if (manaType === 'generic') {
    return true;  // Any creature can pay for generic
  }
  
  // Colored mana requires matching creature color
  return creature.colors.includes(manaType);
}

/**
 * Calculate convoke cost reduction from a set of tapped creatures
 * Returns how much of each mana type is covered
 */
export function calculateConvokeReduction(
  payments: readonly ConvokePayment[]
): { colors: Record<string, number>; generic: number } {
  const reduction = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0 } as Record<string, number>,
    generic: 0,
  };
  
  for (const payment of payments) {
    if (payment.paysFor === 'generic') {
      reduction.generic++;
    } else {
      reduction.colors[payment.paysFor]++;
    }
  }
  
  return reduction;
}

/**
 * Check if a card has convoke by checking its oracle text
 */
export function hasConvoke(oracleText: string): boolean {
  return /\bconvoke\b/i.test(oracleText);
}

/**
 * Parse convoke from oracle text and return true if found
 */
export function detectConvoke(oracleText: string): boolean {
  const lower = (oracleText || '').toLowerCase();
  // Check for the keyword "convoke" which is typically a standalone keyword
  return lower.includes('convoke');
}
