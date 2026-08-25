/**
 * keyword-detection.ts
 * 
 * Centralized keyword detection service using dynamic regex parsing.
 * Designed to be scalable and work for any card using standard MTG templating.
 * 
 * This module provides:
 * 1. Dynamic keyword ability detection from oracle text
 * 2. Dynamic keyword action detection from oracle text
 * 3. Unified interface for keyword effects
 * 4. Support for parameterized keywords (e.g., "Annihilator 4", "Prowess")
 * 
 * Keywords are detected using regex patterns based on MTG Comprehensive Rules.
 * No hardcoded card tables - everything is parsed dynamically.
 */

import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { stripCreateTokenGrantedAbilities } from "../../../../rules-engine/src/oracleReminderText.js";

import type {
  KeywordCategory,
  KeywordTiming,
  DetectedKeyword,
  KeywordDetectionResult,
  KeywordPattern,
} from "./keyword-detection-handlers/keywordDetectionTypes.js";
import { TRIGGERED_KEYWORD_PATTERNS } from "./keyword-detection-handlers/keywordDetectionTriggeredPatterns.js";

export type {
  KeywordCategory,
  KeywordTiming,
  DetectedKeyword,
  KeywordDetectionResult,
};


/**
 * Keyword patterns for static abilities
 */
const STATIC_KEYWORD_PATTERNS: KeywordPattern[] = [
  // Flying
  {
    pattern: /\bflying\b/i,
    keyword: 'flying',
    category: 'static',
    timing: 'always',
    effect: () => 'Can only be blocked by creatures with flying or reach',
    mandatory: true,
  },
  
  // Reach
  {
    pattern: /\breach\b/i,
    keyword: 'reach',
    category: 'static',
    timing: 'always',
    effect: () => 'Can block creatures with flying',
    mandatory: true,
  },
  
  // Deathtouch
  {
    pattern: /\bdeathtouch\b/i,
    keyword: 'deathtouch',
    category: 'static',
    timing: 'always',
    effect: () => 'Any amount of damage this deals to a creature is enough to destroy it',
    mandatory: true,
  },
  
  // First Strike
  {
    pattern: /\bfirst strike\b/i,
    keyword: 'first_strike',
    category: 'static',
    timing: 'always',
    effect: () => 'Deals combat damage before creatures without first strike',
    mandatory: true,
  },
  
  // Double Strike
  {
    pattern: /\bdouble strike\b/i,
    keyword: 'double_strike',
    category: 'static',
    timing: 'always',
    effect: () => 'Deals both first strike and regular combat damage',
    mandatory: true,
  },
  
  // Trample
  {
    pattern: /\btrample\b/i,
    keyword: 'trample',
    category: 'static',
    timing: 'always',
    effect: () => 'Excess combat damage is dealt to defending player or planeswalker',
    mandatory: true,
  },
  
  // Vigilance
  {
    pattern: /\bvigilance\b/i,
    keyword: 'vigilance',
    category: 'static',
    timing: 'always',
    effect: () => "Attacking doesn't cause this creature to tap",
    mandatory: true,
  },
  
  // Haste
  {
    pattern: /\bhaste\b/i,
    keyword: 'haste',
    category: 'static',
    timing: 'always',
    effect: () => 'Can attack and use tap abilities the turn it enters',
    mandatory: true,
  },
  
  // Indestructible
  {
    pattern: /\bindestructible\b/i,
    keyword: 'indestructible',
    category: 'static',
    timing: 'always',
    effect: () => "Cannot be destroyed by damage or effects that say 'destroy'",
    mandatory: true,
  },
  
  // Hexproof
  {
    pattern: /\bhexproof\b/i,
    keyword: 'hexproof',
    category: 'static',
    timing: 'always',
    effect: () => "Cannot be the target of spells or abilities your opponents control",
    mandatory: true,
  },
  
  // Shroud
  {
    pattern: /\bshroud\b/i,
    keyword: 'shroud',
    category: 'static',
    timing: 'always',
    effect: () => 'Cannot be the target of any spells or abilities',
    mandatory: true,
  },
  
  // Protection from [X]
  {
    pattern: /\bprotection from\s+([\w\s,]+?)(?:\.|,|\band\b|$)/i,
    keyword: 'protection',
    category: 'static',
    timing: 'always',
    effect: (match) => `Protection from ${match[1]} (can't be damaged, blocked, enchanted, or targeted by ${match[1]} sources)`,
    mandatory: true,
  },
  
  // Ward N
  {
    pattern: /\bward\s*(?:\{([^}]+)\}|(\d+))/i,
    keyword: 'ward',
    category: 'triggered',
    timing: 'always',
    effect: (match) => `When this becomes the target of a spell or ability an opponent controls, counter it unless they pay ${match[1] || match[2]}`,
    mandatory: true,
  },
  
  // Defender
  {
    pattern: /\bdefender\b/i,
    keyword: 'defender',
    category: 'static',
    timing: 'always',
    effect: () => "Can't attack",
    mandatory: true,
  },
  
  // Menace
  {
    pattern: /\bmenace\b/i,
    keyword: 'menace',
    category: 'static',
    timing: 'always',
    effect: () => "Can't be blocked except by two or more creatures",
    mandatory: true,
  },
  
  // Fear
  {
    pattern: /\bfear\b(?!\s+(?:the|is|itself))/i,
    keyword: 'fear',
    category: 'static',
    timing: 'always',
    effect: () => "Can't be blocked except by artifact creatures and/or black creatures",
    mandatory: true,
  },
  
  // Intimidate
  {
    pattern: /\bintimidate\b/i,
    keyword: 'intimidate',
    category: 'static',
    timing: 'always',
    effect: () => "Can't be blocked except by artifact creatures and/or creatures that share a color with it",
    mandatory: true,
  },
  
  // Skulk
  {
    pattern: /\bskulk\b/i,
    keyword: 'skulk',
    category: 'static',
    timing: 'always',
    effect: () => "Can't be blocked by creatures with greater power",
    mandatory: true,
  },
  
  // Shadow
  {
    pattern: /\bshadow\b/i,
    keyword: 'shadow',
    category: 'static',
    timing: 'always',
    effect: () => 'Can only block or be blocked by creatures with shadow',
    mandatory: true,
  },
  
  // Horsemanship
  {
    pattern: /\bhorsemanship\b/i,
    keyword: 'horsemanship',
    category: 'static',
    timing: 'always',
    effect: () => 'Can only be blocked by creatures with horsemanship',
    mandatory: true,
  },
  
  // Changeling
  {
    pattern: /\bchangeling\b/i,
    keyword: 'changeling',
    category: 'static',
    timing: 'always',
    effect: () => 'This creature is every creature type',
    mandatory: true,
  },
  
  // Devoid
  {
    pattern: /\bdevoid\b/i,
    keyword: 'devoid',
    category: 'static',
    timing: 'always',
    effect: () => 'This card is colorless',
    mandatory: true,
  },
  
  // Infect
  {
    pattern: /\binfect\b/i,
    keyword: 'infect',
    category: 'static',
    timing: 'always',
    effect: () => 'Deals damage to creatures as -1/-1 counters and to players as poison counters',
    mandatory: true,
  },
  
  // Wither
  {
    pattern: /\bwither\b/i,
    keyword: 'wither',
    category: 'static',
    timing: 'always',
    effect: () => 'Deals damage to creatures as -1/-1 counters',
    mandatory: true,
  },
  
  // Split Second
  {
    pattern: /\bsplit second\b/i,
    keyword: 'split_second',
    category: 'static',
    timing: 'always',
    effect: () => 'While this spell is on the stack, players cannot cast other spells or activate abilities that are not mana abilities',
    mandatory: true,
  },
  
  // Affinity for [type]
  {
    pattern: /\baffinity for\s+(\w+)/i,
    keyword: 'affinity',
    category: 'cost_modifier',
    timing: 'cast',
    effect: (match) => `This spell costs {1} less for each ${match[1]} you control`,
    mandatory: true,
  },
  
  // Convoke
  {
    pattern: /\bconvoke\b/i,
    keyword: 'convoke',
    category: 'cost_modifier',
    timing: 'cast',
    effect: () => 'Your creatures can help cast this spell. Each creature you tap pays for {1} or one mana of that creature\'s color',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'tap_creatures',
  },
  
  // Delve
  {
    pattern: /\bdelve\b/i,
    keyword: 'delve',
    category: 'cost_modifier',
    timing: 'cast',
    effect: () => 'You may exile cards from your graveyard. Each card exiled pays for {1}',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'exile_cards',
  },
  
  // Improvise
  {
    pattern: /\bimprovise\b/i,
    keyword: 'improvise',
    category: 'cost_modifier',
    timing: 'cast',
    effect: () => 'Your artifacts can help cast this spell. Each artifact you tap pays for {1}',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'tap_artifacts',
  },
  
  // Assist
  {
    pattern: /\bassist\b/i,
    keyword: 'assist',
    category: 'cost_modifier',
    timing: 'cast',
    effect: () => 'Another player can help pay the generic mana cost of this spell',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'player_payment',
  },
  
  // Undaunted
  {
    pattern: /\bundaunted\b/i,
    keyword: 'undaunted',
    category: 'cost_modifier',
    timing: 'cast',
    effect: () => 'This spell costs {1} less for each opponent',
    mandatory: true,
  },
];

/**
 * Keyword patterns for replacement effects
 */
const REPLACEMENT_KEYWORD_PATTERNS: KeywordPattern[] = [
  // Undying - When this creature dies, if it had no +1/+1 counters, return it with a +1/+1 counter
  {
    pattern: /\bundying\b/i,
    keyword: 'undying',
    category: 'replacement',
    timing: 'dies',
    effect: () => 'When this creature dies, if it had no +1/+1 counters, return it to the battlefield with a +1/+1 counter',
    mandatory: true,
  },
  
  // Persist - When this creature dies, if it had no -1/-1 counters, return it with a -1/-1 counter
  {
    pattern: /\bpersist\b/i,
    keyword: 'persist',
    category: 'replacement',
    timing: 'dies',
    effect: () => 'When this creature dies, if it had no -1/-1 counters, return it to the battlefield with a -1/-1 counter',
    mandatory: true,
  },
  
  // Bloodthirst N - If an opponent was dealt damage this turn, this creature enters with N +1/+1 counters
  {
    pattern: /\bbloodthirst\s+(\d+)\b/i,
    keyword: 'bloodthirst',
    category: 'enters_effect',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Enters with ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} if an opponent was dealt damage this turn`,
    mandatory: true,
  },
  
  // Sunburst - This enters with a +1/+1 (creature) or charge (noncreature) counter for each color of mana spent to cast it
  {
    pattern: /\bsunburst\b/i,
    keyword: 'sunburst',
    category: 'enters_effect',
    timing: 'etb',
    effect: () => 'Enters with a counter for each color of mana spent to cast it',
    mandatory: true,
  },
  
  // Graft N - This creature enters with N +1/+1 counters. Whenever another creature enters, you may move a counter to it
  {
    pattern: /\bgraft\s+(\d+)\b/i,
    keyword: 'graft',
    category: 'enters_effect',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Enters with ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''}. When another creature enters, you may move a counter to it`,
    mandatory: false,
    requiresChoice: true,
    choiceType: 'move_counter',
  },
  
  // Fading N - This enters with N fade counters. At upkeep, remove one. If you can't, sacrifice it
  {
    pattern: /\bfading\s+(\d+)\b/i,
    keyword: 'fading',
    category: 'enters_effect',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Enters with ${match[1]} fade counters. Remove one at upkeep; sacrifice when you can't`,
    mandatory: true,
  },
  
  // Vanishing N - This enters with N time counters. At upkeep, remove one. When last is removed, sacrifice it
  {
    pattern: /\bvanishing\s+(\d+)\b/i,
    keyword: 'vanishing',
    category: 'enters_effect',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Enters with ${match[1]} time counters. Remove one at upkeep; sacrifice when last is removed`,
    mandatory: true,
  },
  
  // Riot - This creature enters with your choice of a +1/+1 counter or haste
  {
    pattern: /\briot\b/i,
    keyword: 'riot',
    category: 'enters_effect',
    timing: 'etb',
    effect: () => 'Choose: enters with a +1/+1 counter OR enters with haste',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'riot_choice',
  },
  
  // Unleash - You may have this creature enter with a +1/+1 counter. It can't block while it has a +1/+1 counter
  {
    pattern: /\bunleash\b/i,
    keyword: 'unleash',
    category: 'enters_effect',
    timing: 'etb',
    effect: () => 'You may have this enter with a +1/+1 counter. If it has one, it can\'t block',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'unleash_choice',
  },
  
  // Renown N - When this creature deals combat damage to a player, if it isn't renowned, put N +1/+1 counters on it
  {
    pattern: /\brenown\s+(\d+)\b/i,
    keyword: 'renown',
    category: 'triggered',
    timing: 'combat_damage',
    valueType: 'counters',
    effect: (match) => `When this deals combat damage to a player, if it isn't renowned, put ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} on it and it becomes renowned`,
    mandatory: true,
  },
  
  // Decayed - This creature can't block. When it attacks, sacrifice it at end of combat
  {
    pattern: /\bdecayed\b/i,
    keyword: 'decayed',
    category: 'static',
    timing: 'always',
    effect: () => "Can't block. When it attacks, sacrifice it at end of combat",
    mandatory: true,
  },
];

/**
 * Keyword action patterns - keyword actions that are performed as effects
 * These are distinct from keyword abilities in that they describe actions
 * that happen as part of spell/ability resolution.
 */
const KEYWORD_ACTION_PATTERNS: KeywordPattern[] = [
  // Connive - Draw a card, then discard a card. If nonland discarded, put +1/+1 counter
  {
    pattern: /\bconnive\b/i,
    keyword: 'connive',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'discard_selection',
  },
  
  // Connive N
  {
    pattern: /\bconnive\s+(\d+)\b/i,
    keyword: 'connive',
    category: 'triggered',
    timing: 'etb',
    valueType: 'cards',
    effect: (match) => `Draw ${match[1]} cards, then discard ${match[1]} cards. Put a +1/+1 counter for each nonland discarded`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'discard_selection',
  },
  
  // Bolster N - Put N +1/+1 counters on creature you control with least toughness
  {
    pattern: /\bbolster\s+(\d+)\b/i,
    keyword: 'bolster',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Put ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} on the creature you control with least toughness`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'target_creature',
  },
  
  // Support N - Put +1/+1 counter on up to N target creatures
  {
    pattern: /\bsupport\s+(\d+)\b/i,
    keyword: 'support',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Put a +1/+1 counter on each of up to ${match[1]} target creatures`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'target_creatures',
  },
  
  // Amass N - Put N +1/+1 counters on an Army you control. If you don't control one, create a 0/0 Army first
  {
    pattern: /\bamass\s+(\w+)\s*(\d+)\b/i,
    keyword: 'amass',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Amass ${match[1]} ${match[2]} - Put ${match[2]} +1/+1 counters on an Army you control. If you don't control one, create a 0/0 ${match[1]} Army creature token first`,
    mandatory: true,
  },
  
  // Amass N (original version without type)
  {
    pattern: /\bamass\s+(\d+)\b(?!\s+\w+\b)/i,
    keyword: 'amass',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Amass ${match[1]} - Put ${match[1]} +1/+1 counters on an Army you control. If you don't control one, create a 0/0 Zombie Army creature token first`,
    mandatory: true,
  },
  
  // Incubate N - Create an Incubator token with N +1/+1 counters
  {
    pattern: /\bincubate\s+(\d+)\b/i,
    keyword: 'incubate',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Create an Incubator token with ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} on it`,
    mandatory: true,
  },
  
  // Populate - Create a copy of a creature token you control
  {
    pattern: /\bpopulate\b/i,
    keyword: 'populate',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'Create a copy of a creature token you control',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'target_token',
  },
  
  // Forage - Exile three cards from your graveyard or sacrifice a Food
  {
    pattern: /\bforage\b/i,
    keyword: 'forage',
    category: 'cost_modifier',
    timing: 'cast',
    effect: () => 'Exile three cards from your graveyard or sacrifice a Food',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'forage_choice',
  },
  
  // Monstrosity N - Put N +1/+1 counters on this creature
  {
    pattern: /\bmonstrosity\s+(\d+)\b/i,
    keyword: 'monstrosity',
    category: 'activated',
    timing: 'always',
    valueType: 'counters',
    effect: (match) => `Put ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} on this creature. It becomes monstrous`,
    mandatory: true,
  },
  
  // Adapt N - Put N +1/+1 counters on this creature if it has none
  {
    pattern: /\badapt\s+(\d+)\b/i,
    keyword: 'adapt',
    category: 'activated',
    timing: 'always',
    valueType: 'counters',
    effect: (match) => `If this creature has no +1/+1 counters on it, put ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} on it`,
    mandatory: true,
  },
  
  // Exert - When you exert, creature doesn't untap during next untap step
  {
    pattern: /\bexert\b/i,
    keyword: 'exert',
    category: 'triggered',
    timing: 'attacks',
    effect: () => "You may exert this creature as it attacks. It won't untap during your next untap step",
    mandatory: false,
    requiresChoice: true,
    choiceType: 'exert_choice',
  },
  
  // Explore - Reveal top card. If land, put in hand. Otherwise, put +1/+1 counter and decide to keep or put back
  {
    pattern: /\bexplore\b/i,
    keyword: 'explore',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'Reveal the top card of your library. If it\'s a land, put it in your hand. Otherwise, put a +1/+1 counter on this creature and you may put that card in your graveyard',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'explore_choice',
  },
  
  // Scry N - Look at top N cards, put any on bottom in any order
  {
    pattern: /(?:^|[.!?]\s+|\bwhen\s+(?:~|this\s+(?:land|permanent|artifact|creature|enchantment))\s+enters(?:\s+the\s+battlefield)?,\s*)scry\s+(\d+)\b/i,
    keyword: 'scry',
    category: 'triggered',
    timing: 'etb',
    valueType: 'cards',
    effect: (match) => `Look at the top ${match[1]} card${parseInt(match[1]) > 1 ? 's' : ''} of your library. Put any number on the bottom in any order`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'scry',
  },
  
  // Surveil N - Look at top N cards, put any into graveyard, rest on top in any order
  {
    pattern: /\bsurveil\s+(\d+)\b/i,
    keyword: 'surveil',
    category: 'triggered',
    timing: 'etb',
    valueType: 'cards',
    effect: (match) => `Look at the top ${match[1]} card${parseInt(match[1]) > 1 ? 's' : ''} of your library. Put any into your graveyard, rest on top in any order`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'surveil',
  },
  
  // Mill N - Put top N cards from library into graveyard
  {
    pattern: /\bmill\s+(\d+)\b/i,
    keyword: 'mill',
    category: 'triggered',
    timing: 'etb',
    valueType: 'cards',
    effect: (match) => `Put the top ${match[1]} card${parseInt(match[1]) > 1 ? 's' : ''} of your library into your graveyard`,
    mandatory: true,
  },
  
  // Discover N - Exile cards from library until nonland with MV <= N, cast it or put in hand
  {
    pattern: /\bdiscover\s+(\d+)\b/i,
    keyword: 'discover',
    category: 'triggered',
    timing: 'cast',
    valueType: 'mana_value',
    effect: (match) => `Exile cards from the top of your library until you exile a nonland card with mana value ${match[1]} or less. Cast it without paying its mana cost or put it into your hand`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'discover_choice',
  },
  
  // Manifest - Put top card face down as 2/2 creature
  {
    pattern: /\bmanifest\b/i,
    keyword: 'manifest',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'Put the top card of your library onto the battlefield face down as a 2/2 creature. Turn it face up any time for its mana cost if it\'s a creature card',
    mandatory: true,
  },
  
  // Cloak - Put card face down as 2/2 creature with ward {2}
  {
    pattern: /\bcloak\b/i,
    keyword: 'cloak',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'Put the card onto the battlefield face down as a 2/2 creature with ward {2}. Turn it face up any time for its mana cost if it\'s a creature card',
    mandatory: true,
  },
  
  // Transform - Transform this permanent
  {
    pattern: /\btransform\b/i,
    keyword: 'transform',
    category: 'triggered',
    timing: 'always',
    effect: () => 'Transform this permanent (turn it to its other face)',
    mandatory: true,
  },
  
  // Goad - Target creature becomes goaded until your next turn
  {
    pattern: /\bgoad\b/i,
    keyword: 'goad',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'Target creature becomes goaded - it attacks each combat if able and attacks a player other than you if able',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'target_creature',
  },
  
  // Fight - Target creature you control fights target creature you don't control
  {
    pattern: /\bfight\b/i,
    keyword: 'fight',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'Each creature deals damage equal to its power to the other',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'fight_targets',
  },
];

/**
 * All keyword patterns combined
 */
const ALL_KEYWORD_PATTERNS: KeywordPattern[] = [
  ...TRIGGERED_KEYWORD_PATTERNS,
  ...STATIC_KEYWORD_PATTERNS,
  ...REPLACEMENT_KEYWORD_PATTERNS,
  ...KEYWORD_ACTION_PATTERNS,
];

// ============================================================================
// Detection Functions
// ============================================================================

function isGrantedKeywordAbilityMatch(
  text: string,
  match: RegExpMatchArray,
  keyword: string,
): boolean {
  const idx = typeof match.index === 'number'
    ? match.index
    : String(text || '').toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return false;
  const before = String(text || '').slice(Math.max(0, idx - 48), idx);
  return /\b(?:have|has|gains?|gained)\s+$/i.test(before);
}

function stripKeywordReminderText(oracleText: string): string {
  // Shared create-token strip removes type parentheticals and inline `with` /
  // `that is|are|has|have` ability tails so token keywords are not attributed
  // to the creator. Then strip remaining parenthetical reminder text.
  return stripCreateTokenGrantedAbilities(String(oracleText || ''))
    .replace(/\([^)]*\)/g, ' ');
}

/**
 * True when another permanent you control grants this creature riot as it enters
 * (e.g. Rhythm of the Wild: "Nontoken creatures you control have riot").
 */
export function battlefieldGrantsRiotToPermanent(permanent: any, battlefield: readonly any[]): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;

  const isToken = permanent?.isToken === true;
  const controller = String(permanent?.controller || '').trim();
  const enteringId = String(permanent?.id || '').trim();

  for (const perm of battlefield || []) {
    if (!perm) continue;
    if (enteringId && String(perm.id || '').trim() === enteringId) continue;
    if (controller && String(perm.controller || '').trim() !== controller) continue;

    const oracle = stripKeywordReminderText(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
    if (/nontoken creatures you control have riot/i.test(oracle)) {
      if (!isToken) return true;
      continue;
    }
    if (/(?:^|[.\n])\s*(?:each )?(?:other )?creatures? you control (?:have|has) riot/i.test(oracle)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect all keywords from oracle text
 * @param oracleText - Card's oracle text
 * @param cardName - Card's name (for context)
 * @returns Detection result with all found keywords
 */
export function detectKeywords(oracleText: string, cardName: string = ''): KeywordDetectionResult {
  const keywords: DetectedKeyword[] = [];
  const text = oracleText || '';
  
  // Strip parenthetical + create-token reminders so static keywords inside token
  // definitions (e.g. Vibranium) are not attributed to the creator card.
  const textForKeywordMatch = stripKeywordReminderText(text);
  
  for (const pattern of ALL_KEYWORD_PATTERNS) {
    // Match against stripped text. Fall back to full oracle only for non-static
    // patterns that may genuinely need reminder-text context.
    let matchedIn = textForKeywordMatch;
    let match = textForKeywordMatch.match(pattern.pattern);
    if (!match && pattern.category !== 'static') {
      match = text.match(pattern.pattern);
      matchedIn = text;
    }
    
    if (match) {
      // "Nontoken creatures you control have riot" grants riot to others; the source
      // itself does not have riot as a keyword (Rhythm of the Wild).
      if (pattern.keyword === 'riot' && isGrantedKeywordAbilityMatch(matchedIn, match, 'riot')) {
        continue;
      }

      // Extract numeric value if present (group 1 for most patterns)
      let value: number | undefined;
      if (match[1] && /^\d+$/.test(match[1])) {
        value = parseInt(match[1], 10);
      }
      
      keywords.push({
        keyword: pattern.keyword,
        category: pattern.category,
        timing: pattern.timing,
        value,
        valueType: pattern.valueType,
        effect: pattern.effect(match, cardName),
        mandatory: pattern.mandatory ?? true,
        requiresChoice: pattern.requiresChoice,
        choiceType: pattern.choiceType,
        raw: match[0],
      });
    }
  }
  
  // Also detect keywords that appear in keyword lists (at start of oracle text)
  // E.g., "Flying, vigilance, lifelink" or "Flying\nVigilance"
  const keywordLinePattern = /^([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*)/;
  const keywordLineMatch = text.match(keywordLinePattern);
  if (keywordLineMatch) {
    const keywordList = keywordLineMatch[1].split(/,\s*/);
    for (const kw of keywordList) {
      const kwLower = kw.toLowerCase().trim();
      // Skip if already detected
      if (keywords.some(k => k.keyword === kwLower || k.keyword === kwLower.replace(/\s+/g, '_'))) {
        continue;
      }
      // Find matching pattern
      const matchingPattern = ALL_KEYWORD_PATTERNS.find(p => 
        p.keyword === kwLower || p.keyword === kwLower.replace(/\s+/g, '_')
      );
      if (matchingPattern) {
        // Create a dummy RegExpMatchArray for patterns without capture groups
        const dummyMatch = Object.assign([kw] as string[], { 
          index: 0, 
          input: kw, 
          groups: undefined 
        }) as RegExpMatchArray;
        
        keywords.push({
          keyword: matchingPattern.keyword,
          category: matchingPattern.category,
          timing: matchingPattern.timing,
          effect: matchingPattern.effect(dummyMatch, cardName),
          mandatory: matchingPattern.mandatory ?? true,
          requiresChoice: matchingPattern.requiresChoice,
          choiceType: matchingPattern.choiceType,
          raw: kw,
        });
      }
    }
  }
  
  return {
    keywords,
    hasTriggeredAbilities: keywords.some(k => k.category === 'triggered'),
    hasStaticAbilities: keywords.some(k => k.category === 'static'),
    hasActivatedAbilities: keywords.some(k => k.category === 'activated'),
    hasReplacementEffects: keywords.some(k => k.category === 'replacement'),
    hasCostModifiers: keywords.some(k => k.category === 'cost_modifier'),
  };
}

/**
 * Get triggered keywords for a specific timing
 */
export function getKeywordsForTiming(
  keywords: DetectedKeyword[],
  timing: KeywordTiming
): DetectedKeyword[] {
  return keywords.filter(k => k.timing === timing);
}

/**
 * Check if a keyword requires player interaction
 */
export function keywordRequiresInteraction(keyword: DetectedKeyword): boolean {
  return keyword.requiresChoice === true || keyword.mandatory === false;
}

/**
 * Get all keyword abilities that should trigger on spell cast
 */
export function getSpellCastTriggerKeywords(keywords: DetectedKeyword[]): DetectedKeyword[] {
  return keywords.filter(k => 
    k.timing === 'cast' || 
    k.timing === 'noncreature_cast' ||
    k.keyword === 'prowess' ||
    k.keyword === 'cascade' ||
    k.keyword === 'storm' ||
    k.keyword === 'extort'
  );
}

/**
 * Get all keyword abilities that should trigger on attack
 */
export function getAttackTriggerKeywords(keywords: DetectedKeyword[]): DetectedKeyword[] {
  return keywords.filter(k => 
    k.timing === 'attacks' ||
    k.keyword === 'dethrone' ||
    k.keyword === 'melee' ||
    k.keyword === 'myriad' ||
    k.keyword === 'annihilator' ||
    k.keyword === 'exalted' ||
    k.keyword === 'battle_cry' ||
    k.keyword === 'mentor' ||
    k.keyword === 'training' ||
    k.keyword === 'enlist'
  );
}

/**
 * Get all keyword abilities that should trigger on combat damage
 */
export function getCombatDamageTriggerKeywords(keywords: DetectedKeyword[]): DetectedKeyword[] {
  return keywords.filter(k => 
    k.timing === 'combat_damage' ||
    k.keyword === 'poisonous' ||
    k.keyword === 'toxic' ||
    k.keyword === 'renown'
  );
}

/**
 * Get all keyword abilities that modify ETB
 */
export function getETBKeywords(keywords: DetectedKeyword[]): DetectedKeyword[] {
  return keywords.filter(k => 
    k.timing === 'etb' ||
    k.category === 'enters_effect' ||
    k.keyword === 'bloodthirst' ||
    k.keyword === 'sunburst' ||
    k.keyword === 'graft' ||
    k.keyword === 'riot' ||
    k.keyword === 'unleash' ||
    k.keyword === 'fabricate' ||
    k.keyword === 'modular' ||
    k.keyword === 'tribute' ||
    k.keyword === 'exploit' ||
    k.keyword === 'backup'
  );
}

/**
 * Get all keyword abilities that trigger on death
 */
export function getDeathTriggerKeywords(keywords: DetectedKeyword[]): DetectedKeyword[] {
  return keywords.filter(k => 
    k.timing === 'dies' ||
    k.keyword === 'undying' ||
    k.keyword === 'persist' ||
    k.keyword === 'afterlife' ||
    k.keyword === 'soulshift' ||
    k.keyword === 'haunt' ||
    k.keyword === 'modular'
  );
}

/**
 * Get static evasion keywords
 */
export function getEvasionKeywords(keywords: DetectedKeyword[]): DetectedKeyword[] {
  const evasionKeywords = [
    'flying', 'reach', 'menace', 'fear', 'intimidate', 
    'skulk', 'shadow', 'horsemanship', 'protection'
  ];
  return keywords.filter(k => evasionKeywords.includes(k.keyword));
}

/**
 * Get combat-relevant static keywords
 */
export function getCombatStaticKeywords(keywords: DetectedKeyword[]): DetectedKeyword[] {
  const combatKeywords = [
    'deathtouch', 'first_strike', 'double_strike', 'trample', 
    'vigilance', 'lifelink', 'infect', 'wither', 'flanking', 'bushido'
  ];
  return keywords.filter(k => combatKeywords.includes(k.keyword));
}

/**
 * Debug helper: Log all detected keywords
 */
export function logDetectedKeywords(result: KeywordDetectionResult, cardName: string): void {
  debug(2, `[KeywordDetection] ${cardName}:`);
  debug(2, `  Triggered: ${result.hasTriggeredAbilities}`);
  debug(2, `  Static: ${result.hasStaticAbilities}`);
  debug(2, `  Replacement: ${result.hasReplacementEffects}`);
  debug(2, `  Cost Modifiers: ${result.hasCostModifiers}`);
  
  for (const kw of result.keywords) {
    debug(2, `    - ${kw.keyword}${kw.value ? ` ${kw.value}` : ''}: ${kw.effect}`);
  }
}

// Export default object with all functions
export default {
  detectKeywords,
  getKeywordsForTiming,
  keywordRequiresInteraction,
  getSpellCastTriggerKeywords,
  getAttackTriggerKeywords,
  getCombatDamageTriggerKeywords,
  getETBKeywords,
  getDeathTriggerKeywords,
  getEvasionKeywords,
  getCombatStaticKeywords,
  logDetectedKeywords,
};
