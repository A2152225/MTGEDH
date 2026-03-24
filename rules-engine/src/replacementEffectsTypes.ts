import type { PlayerID } from '../../shared/src';

/**
 * Types of replacement effects
 */
export enum ReplacementEffectType {
  // ETB replacements
  ENTERS_TAPPED = 'enters_tapped',
  ENTERS_WITH_COUNTERS = 'enters_with_counters',
  ENTERS_AS_COPY = 'enters_as_copy',
  /**
   * Conditional ETB replacement (Mox Diamond style)
   * "If ~ would enter the battlefield, you may [action] instead. If you do/don't..."
   */
  ENTERS_CONDITIONAL = 'enters_conditional',

  // Damage replacements
  PREVENT_DAMAGE = 'prevent_damage',
  REDIRECT_DAMAGE = 'redirect_damage',
  REDUCE_DAMAGE = 'reduce_damage',
  /**
   * Combat damage to mill replacement (Undead Alchemist style)
   * "If ~ would deal combat damage to a player, instead that player mills..."
   */
  COMBAT_DAMAGE_TO_MILL = 'combat_damage_to_mill',

  // Zone change replacements
  DIES_TO_EXILE = 'dies_to_exile',
  DIES_TO_COMMAND = 'dies_to_command',
  DIES_WITH_EFFECT = 'dies_with_effect',
  WOULD_DRAW_INSTEAD = 'would_draw_instead',
  WOULD_DISCARD_INSTEAD = 'would_discard_instead',
  /**
   * Mill to exile replacement (e.g., Rest in Peace, Leyline of the Void, Undead Alchemist trigger condition)
   * "If a card would be put into a graveyard from anywhere, exile it instead"
   */
  MILL_TO_EXILE = 'mill_to_exile',
  /**
   * Graveyard to exile replacement (Rest in Peace, Leyline of the Void)
   * "If a card would be put into a graveyard from anywhere, exile it instead"
   */
  GRAVEYARD_TO_EXILE = 'graveyard_to_exile',

  // Life replacements
  LIFE_GAIN_TO_COUNTERS = 'life_gain_to_counters',
  LIFE_LOSS_PREVENTION = 'life_loss_prevention',

  // Combat replacements
  COMBAT_DAMAGE_TO_COUNTERS = 'combat_damage_to_counters',
  COMBAT_DAMAGE_TO_PLAYER = 'combat_damage_to_player',

  // Token/counter replacements
  EXTRA_TOKENS = 'extra_tokens',
  EXTRA_COUNTERS = 'extra_counters',
  MODIFIED_COUNTERS = 'modified_counters',
}

/**
 * Parsed replacement effect from oracle text
 */
export interface ParsedReplacementEffect {
  readonly type: ReplacementEffectType;
  readonly sourceId: string;
  readonly controllerId: PlayerID;
  readonly condition?: string;
  readonly affectedEvent: string;
  readonly replacement: string;
  readonly isSelfReplacement: boolean;
  readonly value?: number | string;
  readonly requiresChoice?: boolean;
  readonly requiredAction?: string;
  readonly elseEffect?: string;
  readonly appliesToTypes?: readonly string[];
}

/**
 * Result of applying a replacement effect
 */
export interface ReplacementResult {
  readonly applied: boolean;
  readonly modifiedEvent?: any;
  readonly preventedEvent?: boolean;
  readonly log: string[];
}

/**
 * Check if an ETB replacement applies (conditional land ETBs)
 */
export interface ETBConditionCheck {
  readonly entersTapped: boolean;
  readonly reason?: string;
  readonly playerChoice?: boolean;
}
