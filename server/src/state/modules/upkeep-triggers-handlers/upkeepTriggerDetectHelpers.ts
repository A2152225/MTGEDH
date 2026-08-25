// server/src/state/modules/upkeep-triggers-handlers/upkeepTriggerDetectHelpers.ts
// Origin parent: server/src/state/modules/upkeep-triggers.ts
// Cluster moved: exclusive detectUpkeepTriggers helpers (sacrifice-or-self
// patterns, effect-text normalize/dedupe) plus the UpkeepTrigger interface.
// Public entry symbols: UpkeepTrigger, normalizeUpkeepEffectText,
// hasMatchingUpkeepEffect, isSacrificeCreatureOrSelfOracle.

// ============================================================================
// DYNAMIC PATTERN DETECTION REGEXES
// ============================================================================

/**
 * Pattern for "sacrifice a creature, if you can't sacrifice this" style triggers
 * Matches: "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice ~"
 * Examples: Eldrazi Monument, Demonic Appetite
 * 
 * Breakdown:
 * - `at the beginning of your upkeep,?` - matches the upkeep timing
 * - `\s*sacrifice a creature\.?` - matches "sacrifice a creature" with optional period
 * - `\s*if you (?:can't|cannot),?` - matches "if you can't" or "if you cannot"
 * - `\s*sacrifice` - matches the start of "sacrifice this/~"
 */
const SACRIFICE_CREATURE_OR_SELF_PATTERN = /at the beginning of your upkeep,?\s*sacrifice a creature\.?\s*if you (?:can't|cannot),?\s*sacrifice/i;

/**
 * Pattern for "sacrifice a creature or sacrifice this" style triggers
 * Matches: "At the beginning of your upkeep, sacrifice a creature or sacrifice ~"
 * Examples: Jinxed Idol variants
 * 
 * Breakdown:
 * - `at the beginning of your upkeep,?` - matches the upkeep timing
 * - `\s*sacrifice a creature` - matches "sacrifice a creature"
 * - `\s+or\s+sacrifice` - matches "or sacrifice" with required whitespace
 */
const SACRIFICE_OR_PATTERN = /at the beginning of your upkeep,?\s*sacrifice a creature\s+or\s+sacrifice/i;

export function normalizeUpkeepEffectText(effectText: string): string {
  return String(effectText || '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();
}

function normalizeUpkeepEffectKey(effectText: string): string {
  return normalizeUpkeepEffectText(effectText)
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSacrificeCreatureOrSelfOracle(oracleText: string): boolean {
  return SACRIFICE_CREATURE_OR_SELF_PATTERN.test(oracleText) || SACRIFICE_OR_PATTERN.test(oracleText);
}

export function hasMatchingUpkeepEffect(
  triggers: readonly UpkeepTrigger[],
  effectText: string,
  triggerTypes: readonly UpkeepTrigger['triggerType'][] = ['upkeep_effect'],
): boolean {
  const key = normalizeUpkeepEffectKey(effectText);
  if (!key) return false;
  return triggers.some((trigger) => {
    if (!triggerTypes.includes(trigger.triggerType)) return false;
    return normalizeUpkeepEffectKey(String(trigger.effect || trigger.description || '')) === key;
  });
}

export interface UpkeepTrigger {
  permanentId: string;
  cardName: string;
  triggerType: 
    | 'cumulative_upkeep' 
    | 'echo' 
    | 'fading' 
    | 'vanishing' 
    | 'pact' 
    | 'upkeep_cost' 
    | 'upkeep_effect'
    | 'each_upkeep'
    | 'each_player_upkeep'
    | 'opponent_upkeep'
    | 'upkeep_create_copy'  // Progenitor Mimic - create token copy at beginning of upkeep
    | 'saga_lore_counter'   // Saga - add lore counter at beginning of your precombat main phase (Rule 714.3b)
    | 'sacrifice_creature_or_self'  // Eldrazi Monument - sacrifice a creature or sacrifice this
    | 'next_turn_upkeep'
    | 'planeswalk_and_upkeep'
    | 'rebound'
    | 'your_next_upkeep'
    | 'enchanted_controller_upkeep'
    | 'enchanted_player_first_upkeep'
    | 'enchanted_player_upkeep'
    | 'first_upkeep'
    | 'your_first_upkeep'
    | 'chosen_player_upkeep'
    | 'each_participant_upkeep'
    | 'each_other_player_upkeep'
    | 'exiled_card_owner_upkeep'
    | 'each_of_that_player_upkeep';
  cost?: string;
  description: string;
  effect?: string;
  counters?: number;
  mandatory: boolean;
  consequence?: string;
  requiresChoice?: boolean;
  controllerTrigger: boolean; // True if triggers on controller's upkeep
  anyPlayerTrigger: boolean;  // True if triggers on any player's upkeep
  copySourceId?: string; // For copy effects - the permanent to copy
  // For sagas
  chapterAbilities?: { chapter: number; effect: string }[];
  currentChapter?: number;
  maxChapter?: number;
  // For sacrifice_creature_or_self - the type of permanent to sacrifice if no creatures
  sacrificeAlternativeType?: string;
  imageUrl?: string;
}

