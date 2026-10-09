/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 *
 * Cluster moved: ParsedActivatedAbility, TapOtherPermanentsCost, ActivationContext.
 *
 * Public entry symbols: ParsedActivatedAbility, TapOtherPermanentsCost, ActivationContext.
 */

import type { SacrificeType } from '../../../../shared/src/textUtils';

/**
 * Represents a parsed activated ability
 */
export interface ParsedActivatedAbility {
  id: string;
  label: string;
  description: string;
  cost: string;
  effect: string;
  // Cost components
  requiresTap: boolean;
  requiresUntap: boolean;  // For untap symbol costs like {Q}
  requiresSacrifice: boolean;
  sacrificeType?: SacrificeType;  // What to sacrifice
  sacrificeCount?: number;  // How many to sacrifice (default 1)
  mustBeOther?: boolean;  // Whether sacrifice must be "other" permanents (not the source)
  manaCost?: string;
  lifeCost?: number;
  loyaltyCost?: number;  // For planeswalker abilities
  isVariableLoyalty?: boolean;  // +X / −X loyalty abilities
  otherCosts?: string[];
  // X cost support
  hasXCost?: boolean;  // Whether the cost contains {X}
  xCount?: number;  // Number of X symbols in cost (e.g., {X}{X} = 2)
  // Tap other permanents cost (e.g., "Tap an untapped Merfolk you control")
  tapOtherPermanentsCost?: TapOtherPermanentsCost;
  // Ability characteristics
  isManaAbility: boolean;
  isLoyaltyAbility: boolean;
  isFetchAbility: boolean;
  isMillAbility?: boolean;  // Mill abilities (target player mills cards)
  isCrewAbility?: boolean;  // Crew abilities for vehicles
  isStationAbility?: boolean;  // Station abilities for spacecraft
  crewPower?: number;  // Power required to crew
  stationThreshold?: number;  // Charge counters needed to become creature
  // Activation restrictions
  timingRestriction?: 'sorcery' | 'instant' | 'upkeep' | 'your_turn';
  oncePerTurn?: boolean;
  /** True when oracle says "Any player may activate this ability." */
  anyPlayerMayActivate?: boolean;
  // For targeting
  requiresTarget?: boolean;
  targetDescription?: string;
  // Mill specific
  millCount?: number;  // Number of cards to mill
  millTargetType?: 'player' | 'self' | 'opponent' | 'any';  // Who mills
}

/**
 * Represents a cost that requires tapping other permanents
 * (e.g., Drowner of Secrets: "Tap an untapped Merfolk you control")
 */
export interface TapOtherPermanentsCost {
  count: number;  // How many permanents to tap (1, 2, etc.)
  filter: {
    types?: string[];  // Required types (e.g., ['Merfolk', 'creature'])
    controller?: 'you' | 'any';  // Who controls the permanents
    mustBeUntapped?: boolean;  // Must be untapped (always true for tap costs)
    notSelf?: boolean;  // Cannot be the source permanent itself ("another")
  };
  description: string;  // Human-readable description
}

/**
 * Represents the context for ability activation
 */
export interface ActivationContext {
  isTapped: boolean;
  hasSummoningSickness: boolean;
  hasHaste: boolean;
  hasThousandYearElixirEffect: boolean;  // Allows tap abilities despite summoning sickness
  loyaltyCounters?: number;
  controllerHasPriority: boolean;
  isMainPhase: boolean;
  isOwnTurn: boolean;
  stackEmpty: boolean;
  /** Current game step (e.g. UPKEEP, MAIN1) for timing-restricted activates */
  currentStep?: string;
}

