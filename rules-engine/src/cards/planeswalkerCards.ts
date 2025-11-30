/**
 * cards/planeswalkerCards.ts
 * 
 * Planeswalkers with special handling needs.
 */

export interface PlaneswalkerAbilityConfig {
  readonly cardName: string;
  readonly startingLoyalty: number;
  readonly abilities: {
    readonly cost: number;
    readonly effect: string;
    readonly requiresTarget?: boolean;
    readonly targetType?: string;
  }[];
  readonly staticAbilities?: string[];
}

export const PLANESWALKER_CARDS: Record<string, PlaneswalkerAbilityConfig> = {
  'elspeth, storm slayer': {
    cardName: 'Elspeth, Storm Slayer',
    startingLoyalty: 4,
    abilities: [
      { cost: 1, effect: 'Create a 1/1 white Soldier creature token.' },
      { cost: -2, effect: 'Target creature gets +3/+3 until end of turn.', requiresTarget: true, targetType: 'creature' },
      { cost: -6, effect: 'You get an emblem with "Creatures you control get +1/+1 and have vigilance."' },
    ],
    staticAbilities: ['If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.'],
  },
  'teferi, hero of dominaria': {
    cardName: 'Teferi, Hero of Dominaria',
    startingLoyalty: 4,
    abilities: [
      { cost: 1, effect: 'Draw a card. At the beginning of the next end step, untap up to two lands.' },
      { cost: -3, effect: 'Put target nonland permanent into its owner\'s library third from the top.', requiresTarget: true, targetType: 'nonland permanent' },
      { cost: -8, effect: 'You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."' },
    ],
  },
};

export function isSpecialPlaneswalker(cardName: string): boolean {
  return cardName.toLowerCase() in PLANESWALKER_CARDS;
}

export function getPlaneswalkerConfig(cardName: string): PlaneswalkerAbilityConfig | undefined {
  return PLANESWALKER_CARDS[cardName.toLowerCase()];
}

/**
 * Check if a planeswalker can activate an ability
 */
export function canActivatePlaneswalkerAbility(
  currentLoyalty: number,
  abilityCost: number
): boolean {
  // Can always use + abilities and 0 abilities
  // Can use - abilities only if loyalty >= |cost|
  if (abilityCost >= 0) {
    return true;
  }
  return currentLoyalty >= Math.abs(abilityCost);
}

/**
 * Calculate new loyalty after ability activation
 */
export function calculateNewLoyalty(
  currentLoyalty: number,
  abilityCost: number
): number {
  return currentLoyalty + abilityCost;
}
