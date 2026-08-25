// Origin parent: rules-engine/src/AutomationService.ts
// Cluster moved: DecisionType enum plus pending-decision / automation result interfaces.
// Public entry symbols: DecisionType, PendingDecision, DecisionOption, SelectionFilter,
//   DecisionResult, AutomationContext, AutomationResult.
// Leaf must not import AutomationService.ts or AutomationService-handlers/index.ts.

import type { GameState } from '../../../shared/src';

/**
 * Types of decisions that require player input
 */
export enum DecisionType {
  // Targeting
  SELECT_TARGETS = 'select_targets',
  SELECT_ADDITIONAL_TARGETS = 'select_additional_targets',
  
  // Modal spells
  SELECT_MODE = 'select_mode',
  SELECT_MODES = 'select_modes',  // For "choose two" etc.
  
  // X spells
  SELECT_X_VALUE = 'select_x_value',
  
  // Mana payment
  SELECT_MANA_PAYMENT = 'select_mana_payment', // For hybrid/phyrexian mana
  
  // Triggers
  ORDER_TRIGGERS = 'order_triggers',
  
  // Combat
  SELECT_ATTACKERS = 'select_attackers',
  SELECT_BLOCKERS = 'select_blockers',
  ORDER_BLOCKERS = 'order_blockers',       // Attacker blocked by multiple creatures
  ASSIGN_COMBAT_DAMAGE = 'assign_combat_damage', // When damage must be assigned to multiple
  
  // Other choices
  SELECT_OPTION = 'select_option',         // Generic choice from options
  SELECT_CARDS = 'select_cards',           // Choose cards (from hand, library, etc.)
  SELECT_PLAYER = 'select_player',
  SELECT_PERMANENT = 'select_permanent',
  SELECT_CREATURE_TYPE = 'select_creature_type',
  SELECT_COLOR = 'select_color',
  
  // May abilities
  MAY_ABILITY = 'may_ability',             // Optional "may" trigger
  
  // Replacement effects
  CHOOSE_REPLACEMENT = 'choose_replacement', // Multiple replacement effects apply
  
  // Mulligan
  MULLIGAN_DECISION = 'mulligan_decision',
  MULLIGAN_BOTTOM = 'mulligan_bottom',     // Choose cards to put on bottom
}

/**
 * Pending decision that requires player input
 */
export interface PendingDecision {
  id: string;
  type: DecisionType;
  playerId: string;
  sourceId?: string;           // Card/ability that caused this decision
  sourceName?: string;
  description: string;         // Human-readable description
  
  // Context for the decision
  options?: DecisionOption[];  // Available choices
  minSelections?: number;      // Minimum selections required
  maxSelections?: number;      // Maximum selections allowed
  filters?: SelectionFilter[]; // Filters for valid selections
  
  // For targeting
  targetTypes?: string[];      // Types of valid targets
  
  // For X values
  minX?: number;
  maxX?: number;
  
  // For mana payment
  manaCost?: string;           // The cost to pay
  
  // Timeout (optional)
  timeoutMs?: number;
  createdAt: number;
  
  // Is this decision mandatory?
  mandatory: boolean;
  
  // Default choice if timeout or auto-pass
  defaultChoice?: any;
}

/**
 * Option for player to choose from
 */
export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  imageUrl?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Filter for valid selections
 */
export interface SelectionFilter {
  type: 'card_type' | 'color' | 'controller' | 'zone' | 'name' | 'custom';
  value: string | string[];
}

/**
 * Result of processing a decision
 */
export interface DecisionResult {
  success: boolean;
  error?: string;
  continueAutomation: boolean; // Should automation continue after this decision?
}

/**
 * Automation context passed to automation functions
 */
export interface AutomationContext {
  gameId: string;
  state: GameState;
  emit: (event: any) => void;
}

/**
 * Result of automation step
 */
export interface AutomationResult {
  state: GameState;
  pendingDecisions: PendingDecision[];
  log: string[];
  shouldContinue: boolean;      // Should automation continue?
  stateChanged: boolean;        // Did the state change?
}
