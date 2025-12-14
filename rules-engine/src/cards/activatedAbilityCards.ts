/**
 * cards/activatedAbilityCards.ts
 * 
 * Cards with special activated abilities.
 * 
 * Supports:
 * - Standard tap abilities (Humble Defector, Cryptbreaker)
 * - Control change abilities (giving control to opponent)
 * - "Any player may activate" abilities (Xantcha, Sleeper Agent)
 * - ETB control change effects (Vislor Turlough, Akroan Horse)
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
    readonly targetType?: 'player' | 'creature' | 'permanent' | 'spell' | 'self' | 'opponent';
    readonly requiresType?: string;  // Creature type filter for tapping
    readonly requiresCount?: number; // Number of creatures to tap
    readonly stackInteraction?: boolean; // True if this ability targets the stack
    readonly controlChange?: boolean; // True if this ability changes control of the permanent
    readonly timingRestriction?: 'sorcery' | 'your_turn'; // Timing restrictions
    readonly anyPlayerCanActivate?: boolean; // True if any player can activate (Xantcha)
  };
  /** ETB control change effect - permanent enters under opponent's control */
  readonly etbControlChange?: {
    readonly type: 'enters_under_opponent' | 'may_give_opponent' | 'opponent_gains';
    readonly isOptional: boolean;
    readonly goadsOnChange?: boolean; // Vislor Turlough goads when control changes
    readonly additionalEffects?: string[];
  };
  /** Attack restrictions for creatures like Xantcha */
  readonly attackRestrictions?: {
    readonly mustAttackEachCombat?: boolean;
    readonly cantAttackOwner?: boolean;
    readonly cantAttackOwnerPlaneswalkers?: boolean;
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
  'humble defector': {
    cardName: 'Humble Defector',
    tapAbility: {
      cost: '{T}',
      effect: 'Draw two cards. Target opponent gains control of Humble Defector.',
      targetType: 'opponent',
      controlChange: true,
      timingRestriction: 'your_turn',
    },
  },
  // Vislor Turlough - "you may have an opponent gain control of it. If you do, it's goaded"
  'vislor turlough': {
    cardName: 'Vislor Turlough',
    etbControlChange: {
      type: 'may_give_opponent',
      isOptional: true,
      goadsOnChange: true,
      additionalEffects: ['draw a card at end step', 'lose life equal to cards in hand'],
    },
  },
  // Xantcha, Sleeper Agent - enters under opponent's control, any player can activate
  'xantcha, sleeper agent': {
    cardName: 'Xantcha, Sleeper Agent',
    etbControlChange: {
      type: 'enters_under_opponent',
      isOptional: false,
    },
    attackRestrictions: {
      mustAttackEachCombat: true,
      cantAttackOwner: true,
      cantAttackOwnerPlaneswalkers: true,
    },
    tapAbility: {
      cost: '{3}',
      effect: "Xantcha's controller loses 2 life and you draw a card.",
      targetType: 'self',
      anyPlayerCanActivate: true,
    },
  },
  // Akroan Horse - "an opponent gains control of it" on ETB
  'akroan horse': {
    cardName: 'Akroan Horse',
    etbControlChange: {
      type: 'opponent_gains',
      isOptional: false,
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

/**
 * Check if a card has an ETB control change effect
 */
export function hasETBControlChange(cardName: string): boolean {
  const config = getActivatedAbilityConfig(cardName);
  return config?.etbControlChange !== undefined;
}

/**
 * Check if an ability can be activated by any player
 */
export function isAnyPlayerActivatable(cardName: string): boolean {
  const config = getActivatedAbilityConfig(cardName);
  return config?.tapAbility?.anyPlayerCanActivate === true;
}

/**
 * Check if a card has attack restrictions (Xantcha style)
 */
export function hasAttackRestrictions(cardName: string): boolean {
  const config = getActivatedAbilityConfig(cardName);
  return config?.attackRestrictions !== undefined;
}

/**
 * Get attack restrictions for a card
 */
export function getAttackRestrictions(cardName: string): ActivatedAbilityConfig['attackRestrictions'] | undefined {
  const config = getActivatedAbilityConfig(cardName);
  return config?.attackRestrictions;
}
