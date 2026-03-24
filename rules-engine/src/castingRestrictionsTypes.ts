/**
 * Types of casting restrictions
 */
export enum CastingRestrictionType {
  CANT_CAST_SPELLS = 'cant_cast_spells',
  CANT_CAST_NONCREATURE = 'cant_cast_noncreature',
  CANT_CAST_NONARTIFACT = 'cant_cast_nonartifact',
  ONE_SPELL_PER_TURN = 'one_spell_per_turn',
  ONE_NONCREATURE_PER_TURN = 'one_noncreature_per_turn',
  ONE_NONARTIFACT_PER_TURN = 'one_nonartifact_per_turn',
  SORCERY_SPEED_ONLY = 'sorcery_speed_only',
  OPPONENTS_TURN_ONLY = 'opponents_turn_only',
  YOUR_TURN_ONLY = 'your_turn_only',
  HAND_ONLY = 'hand_only',
  CANT_ACTIVATE_ABILITIES = 'cant_activate_abilities',
  CANT_ACTIVATE_NONMANA = 'cant_activate_nonmana',
  CMC_RESTRICTION = 'cmc_restriction',
  CUSTOM = 'custom',
}

/**
 * Duration of the restriction
 */
export enum RestrictionDuration {
  END_OF_TURN = 'end_of_turn',
  UNTIL_END_OF_PHASE = 'end_of_phase',
  WHILE_SOURCE_ON_BATTLEFIELD = 'while_on_battlefield',
  UNTIL_LEAVES_BATTLEFIELD = 'until_leaves',
  PERMANENT = 'permanent',
}

/**
 * Represents a casting restriction effect
 */
export interface CastingRestriction {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceControllerId: string;
  readonly type: CastingRestrictionType;
  readonly duration: RestrictionDuration;
  readonly affectedPlayers: 'opponents' | 'all' | 'target' | 'controller';
  readonly targetPlayerId?: string;
  readonly spellTypeRestriction?: string;
  readonly cmcRestriction?: {
    comparison: 'equals' | 'less_than' | 'greater_than' | 'less_equal' | 'greater_equal';
    value: number;
  };
  readonly onlyDuringYourTurn?: boolean;
  readonly timestamp: number;
  readonly expiresAtEndOfTurn?: boolean;
}

/**
 * Result of checking if a spell can be cast
 */
export interface CastingCheckResult {
  readonly canCast: boolean;
  readonly reason?: string;
  readonly blockingRestrictions: CastingRestriction[];
}

/**
 * Spell timing restriction result
 */
export interface SpellTimingRestriction {
  readonly canCast: boolean;
  readonly reason?: string;
  readonly requiresOpponentsTurn?: boolean;
  readonly requiresOwnTurn?: boolean;
  readonly requiresCreatureTarget?: string;
}
