/**
 * cards/activatedAbilityCards.ts
 * 
 * Cards with special activated abilities.
 */

export interface ActivatedAbilityConfig {
  readonly cardName: string;
  readonly grantedAbility?: {
    readonly cost: string;
    readonly effect: string;
    readonly requiresTap?: boolean;
  };
  readonly tapAbility?: {
    readonly cost: string;
    readonly effect: string;
    readonly targetType?: 'player' | 'creature' | 'permanent' | 'spell' | 'self';
    readonly requiresType?: string;  // Creature type filter for tapping
    readonly requiresCount?: number; // Number of creatures to tap
    readonly stackInteraction?: boolean; // True if this ability targets the stack
  };
}

export const ACTIVATED_ABILITY_CARDS: Record<string, ActivatedAbilityConfig> = {
  'squirrel nest': {
    cardName: 'Squirrel Nest',
    grantedAbility: {
      cost: '{T}',
      effect: 'Create a 1/1 green Squirrel creature token.',
      requiresTap: true,
    },
  },
  'drowner of secrets': {
    cardName: 'Drowner of Secrets',
    tapAbility: {
      cost: 'Tap an untapped Merfolk you control',
      effect: 'Target player mills a card.',
      targetType: 'player',
      requiresType: 'Merfolk',
      requiresCount: 1,
    },
  },
  'lullmage mentor': {
    cardName: 'Lullmage Mentor',
    tapAbility: {
      cost: 'Tap seven untapped Merfolk you control',
      effect: 'Counter target spell.',
      targetType: 'spell',
      requiresType: 'Merfolk',
      requiresCount: 7,
      stackInteraction: true,
    },
  },
  'cryptbreaker': {
    cardName: 'Cryptbreaker',
    tapAbility: {
      cost: 'Tap three untapped Zombies you control',
      effect: 'You draw a card and you lose 1 life.',
      targetType: 'self',
      requiresType: 'Zombie',
      requiresCount: 3,
    },
  },
  'judge of currents': {
    cardName: 'Judge of Currents',
    tapAbility: {
      cost: 'Tap an untapped Merfolk you control',
      effect: 'You gain 1 life.',
      targetType: 'self',
      requiresType: 'Merfolk',
      requiresCount: 1,
    },
  },
  'fallowsage': {
    cardName: 'Fallowsage',
    tapAbility: {
      cost: 'Tap an untapped Merfolk you control',
      effect: 'Draw a card.',
      targetType: 'self',
      requiresType: 'Merfolk',
      requiresCount: 1,
    },
  },
  'stonybrook schoolmaster': {
    cardName: 'Stonybrook Schoolmaster',
    tapAbility: {
      cost: 'Tap an untapped Merfolk you control',
      effect: 'Create a 1/1 blue Merfolk Wizard creature token.',
      targetType: 'self',
      requiresType: 'Merfolk',
      requiresCount: 1,
    },
  },
};

export function hasSpecialActivatedAbility(cardName: string): boolean {
  return cardName.toLowerCase() in ACTIVATED_ABILITY_CARDS;
}

export function getActivatedAbilityConfig(cardName: string): ActivatedAbilityConfig | undefined {
  return ACTIVATED_ABILITY_CARDS[cardName.toLowerCase()];
}

/**
 * Check if an activated ability targets the stack (for counterspell effects)
 */
export function targetsStack(cardName: string): boolean {
  const config = getActivatedAbilityConfig(cardName);
  return config?.tapAbility?.stackInteraction === true || 
         config?.tapAbility?.targetType === 'spell';
}
