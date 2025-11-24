/**
 * Partner keyword ability (Rule 702.124)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.124. Partner
 * 702.124a Partner abilities are keyword abilities that modify the rules for deck construction 
 * in the Commander variant (see rule 903), and they function before the game begins. Each 
 * partner ability allows you to designate two legendary cards as your commander rather than one. 
 * Each partner ability has its own requirements for those two commanders. The partner abilities 
 * are: partner, partner—[text], partner with [name], friends forever, choose a Background, and 
 * Doctor's companion.
 * 702.124b Your deck must contain exactly 100 cards, including its two commanders. Both 
 * commanders begin the game in the command zone.
 * 702.124c A rule or effect that refers to your commander's color identity refers to the 
 * combined color identities of your two commanders.
 * 702.124d Except for determining the color identity of your commander, the two commanders 
 * function independently.
 */

export interface PartnerAbility {
  readonly type: 'partner';
  readonly source: string;
  readonly partnerType: 'partner' | 'partner-with' | 'friends-forever' | 'choose-background' | 'doctors-companion';
  readonly partnerName?: string; // For "partner with [name]"
  readonly partnerRequirement?: string; // For "partner—[text]"
}

/**
 * Create a basic partner ability
 * Rule 702.124a
 * @param source - The legendary creature with partner
 * @returns Partner ability object
 */
export function partner(source: string): PartnerAbility {
  return {
    type: 'partner',
    source,
    partnerType: 'partner',
  };
}

/**
 * Create a "partner with [name]" ability
 * Rule 702.124a
 * @param source - The legendary creature
 * @param partnerName - Name of specific partner
 * @returns Partner ability object
 */
export function partnerWith(source: string, partnerName: string): PartnerAbility {
  return {
    type: 'partner',
    source,
    partnerType: 'partner-with',
    partnerName,
  };
}

/**
 * Create a "partner—[text]" ability
 * Rule 702.124a
 * @param source - The legendary creature
 * @param requirement - Partner requirement text
 * @returns Partner ability object
 */
export function partnerWithRequirement(source: string, requirement: string): PartnerAbility {
  return {
    type: 'partner',
    source,
    partnerType: 'partner',
    partnerRequirement: requirement,
  };
}

/**
 * Create a "friends forever" ability
 * Rule 702.124a
 * @param source - The legendary creature
 * @returns Partner ability object
 */
export function friendsForever(source: string): PartnerAbility {
  return {
    type: 'partner',
    source,
    partnerType: 'friends-forever',
  };
}

/**
 * Create a "choose a Background" ability
 * Rule 702.124a
 * @param source - The legendary creature
 * @returns Partner ability object
 */
export function chooseBackground(source: string): PartnerAbility {
  return {
    type: 'partner',
    source,
    partnerType: 'choose-background',
  };
}

/**
 * Create a "Doctor's companion" ability
 * Rule 702.124a
 * @param source - The legendary creature
 * @returns Partner ability object
 */
export function doctorsCompanion(source: string): PartnerAbility {
  return {
    type: 'partner',
    source,
    partnerType: 'doctors-companion',
  };
}

/**
 * Check if two commanders can partner together
 * Rule 702.124a
 * @param ability1 - First partner ability
 * @param ability2 - Second partner ability
 * @returns True if they can partner
 */
export function canPartnerTogether(ability1: PartnerAbility, ability2: PartnerAbility): boolean {
  // Basic partner can partner with any other basic partner
  if (ability1.partnerType === 'partner' && ability2.partnerType === 'partner') {
    return true;
  }
  
  // Partner with specific name
  if (ability1.partnerType === 'partner-with' && ability2.partnerType === 'partner-with') {
    return ability1.partnerName === ability2.source && ability2.partnerName === ability1.source;
  }
  
  // Friends forever can partner with other friends forever
  if (ability1.partnerType === 'friends-forever' && ability2.partnerType === 'friends-forever') {
    return true;
  }
  
  return false;
}

/**
 * Partner abilities are not redundant
 * @param abilities - Array of partner abilities
 * @returns False
 */
export function hasRedundantPartner(abilities: readonly PartnerAbility[]): boolean {
  return false;
}
