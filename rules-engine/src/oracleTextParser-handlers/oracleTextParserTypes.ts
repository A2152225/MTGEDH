/**
 * Origin parent: rules-engine/src/oracleTextParser.ts
 * Cluster moved: ParsedAbility, ChoiceRequirement, AbilityType, ParsedKeywordAction, OracleTextParseResult
 * Public entry symbols: ParsedAbility, ChoiceRequirement, AbilityType, ParsedKeywordAction, OracleTextParseResult
 * Leaf must not import oracleTextParser.ts or oracleTextParser-handlers/index.ts.
 */

/**
 * Parsed ability structure
 */
export interface ParsedAbility {
  readonly type: AbilityType;
  readonly text: string;
  readonly cost?: string;
  readonly effect?: string;
  readonly triggerCondition?: string;
  readonly triggerKeyword?: 'when' | 'whenever' | 'at';
  readonly interveningIf?: string;
  readonly isOptional?: boolean;
  readonly isManaAbility?: boolean;
  readonly isLoyaltyAbility?: boolean;
  readonly targets?: readonly string[];
  readonly modes?: readonly string[];
  readonly requiresChoice?: ChoiceRequirement;
  /** Station / Spacecraft charge-counter gate (N in `N+ | {cost}: effect`). */
  readonly stationChargeThreshold?: number;
}

/**
 * Choice requirement for cards that need a choice on ETB or cast
 */
export interface ChoiceRequirement {
  readonly choiceType: 'color' | 'creature_type' | 'card_type' | 'player' | 'mode' | 'other';
  readonly timing: 'etb' | 'cast' | 'activation' | 'trigger';
  readonly description: string;
}

/**
 * Types of abilities that can be parsed
 */
export enum AbilityType {
  ACTIVATED = 'activated',
  TRIGGERED = 'triggered',
  STATIC = 'static',
  REPLACEMENT = 'replacement',
  SPELL = 'spell',
  KEYWORD = 'keyword',
}

/**
 * Parsed keyword action
 */
export interface ParsedKeywordAction {
  readonly action: string;
  readonly value?: number | string;
  readonly target?: string;
  readonly modifier?: string;
}

/**
 * Main parsing result for oracle text
 */
export interface OracleTextParseResult {
  readonly abilities: readonly ParsedAbility[];
  readonly keywords: readonly string[];
  readonly keywordActions: readonly ParsedKeywordAction[];
  readonly isTriggered: boolean;
  readonly isActivated: boolean;
  readonly isReplacement: boolean;
  readonly hasTargets: boolean;
  readonly hasModes: boolean;
}
