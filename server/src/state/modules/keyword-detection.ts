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

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Categories of keyword abilities
 */
export type KeywordCategory = 
  | 'triggered'      // Triggers on specific events (e.g., prowess, dethrone)
  | 'static'         // Always active (e.g., flying, deathtouch)
  | 'activated'      // Requires activation (e.g., equip, cycling)
  | 'replacement'    // Modifies events (e.g., undying, persist)
  | 'cost_modifier'  // Modifies costs (e.g., affinity, convoke)
  | 'enters_effect'; // ETB modifications (e.g., bloodthirst, sunburst)

/**
 * When the keyword triggers
 */
export type KeywordTiming =
  | 'cast'              // When you cast a spell
  | 'etb'               // Enters the battlefield
  | 'ltb'               // Leaves the battlefield
  | 'dies'              // When creature dies
  | 'attacks'           // When creature attacks
  | 'blocks'            // When creature blocks
  | 'combat_damage'     // Deals combat damage
  | 'any_damage'        // Deals any damage
  | 'upkeep'            // At beginning of upkeep
  | 'end_step'          // At beginning of end step
  | 'draw'              // When a card is drawn
  | 'discard'           // When a card is discarded
  | 'creature_etb'      // When another creature ETB
  | 'noncreature_cast'  // When noncreature spell cast
  | 'opponent_attacks'  // When opponent's creature attacks
  | 'always';           // Static, always active

/**
 * Detected keyword from oracle text
 */
export interface DetectedKeyword {
  keyword: string;           // Keyword name (lowercase)
  category: KeywordCategory;
  timing: KeywordTiming;
  value?: number;            // Numeric value if any (e.g., annihilator 4)
  valueType?: string;        // Type of value (e.g., 'counters', 'damage', 'mana')
  condition?: string;        // Trigger condition if any
  effect: string;            // Effect description
  mandatory: boolean;        // Is the effect mandatory?
  requiresChoice?: boolean;  // Does it require player choice?
  choiceType?: string;       // Type of choice required
  raw?: string;              // Raw matched text
}

/**
 * Result of keyword detection
 */
export interface KeywordDetectionResult {
  keywords: DetectedKeyword[];
  hasTriggeredAbilities: boolean;
  hasStaticAbilities: boolean;
  hasActivatedAbilities: boolean;
  hasReplacementEffects: boolean;
  hasCostModifiers: boolean;
}

// ============================================================================
// Keyword Pattern Definitions
// ============================================================================

/**
 * Pattern definitions for keyword abilities
 * Each pattern extracts the keyword and optionally a numeric value
 */
interface KeywordPattern {
  pattern: RegExp;
  keyword: string;
  category: KeywordCategory;
  timing: KeywordTiming;
  valueType?: string;
  effect: (match: RegExpMatchArray, cardName: string) => string;
  mandatory?: boolean;
  requiresChoice?: boolean;
  choiceType?: string;
}

/**
 * Keyword patterns for triggered abilities
 */
const TRIGGERED_KEYWORD_PATTERNS: KeywordPattern[] = [
  // Prowess - Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn
  {
    pattern: /\bprowess\b/i,
    keyword: 'prowess',
    category: 'triggered',
    timing: 'noncreature_cast',
    effect: () => '+1/+1 until end of turn when you cast a noncreature spell',
    mandatory: true,
  },
  
  // Dethrone - Whenever this creature attacks the player with the most life, put a +1/+1 counter on it
  {
    pattern: /\bdethrone\b/i,
    keyword: 'dethrone',
    category: 'triggered',
    timing: 'attacks',
    effect: () => 'Put a +1/+1 counter on this creature if attacking player with most life',
    mandatory: true,
  },
  
  // Evolve - Whenever a creature with greater P or T enters under your control, put a +1/+1 counter
  {
    pattern: /\bevolve\b/i,
    keyword: 'evolve',
    category: 'triggered',
    timing: 'creature_etb',
    effect: () => 'Put a +1/+1 counter when creature with greater power or toughness enters',
    mandatory: true,
  },
  
  // Extort - Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much
  {
    pattern: /\bextort\b/i,
    keyword: 'extort',
    category: 'triggered',
    timing: 'cast',
    effect: () => 'You may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'mana_payment',
  },
  
  // Afflict N - Whenever this creature becomes blocked, defending player loses N life
  {
    pattern: /\bafflict\s+(\d+)\b/i,
    keyword: 'afflict',
    category: 'triggered',
    timing: 'blocks',
    valueType: 'life_loss',
    effect: (match) => `Defending player loses ${match[1]} life when this creature becomes blocked`,
    mandatory: true,
  },
  
  // Annihilator N - Whenever this creature attacks, defending player sacrifices N permanents
  {
    pattern: /\bannihilator\s+(\d+)\b/i,
    keyword: 'annihilator',
    category: 'triggered',
    timing: 'attacks',
    valueType: 'sacrifice',
    effect: (match) => `Defending player sacrifices ${match[1]} permanent${parseInt(match[1]) > 1 ? 's' : ''} when this creature attacks`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'sacrifice_selection',
  },
  
  // Melee - Whenever this creature attacks, it gets +1/+1 for each opponent you attacked this combat
  {
    pattern: /\bmelee\b/i,
    keyword: 'melee',
    category: 'triggered',
    timing: 'attacks',
    effect: () => '+1/+1 for each opponent you attacked this combat',
    mandatory: true,
  },
  
  // Myriad - Whenever this creature attacks, create token copies attacking each other opponent
  {
    pattern: /\bmyriad\b/i,
    keyword: 'myriad',
    category: 'triggered',
    timing: 'attacks',
    effect: () => 'Create token copies attacking each other opponent',
    mandatory: true,
  },
  
  // Exalted - Whenever a creature you control attacks alone, it gets +1/+1 until end of turn
  {
    pattern: /\bexalted\b/i,
    keyword: 'exalted',
    category: 'triggered',
    timing: 'attacks',
    effect: () => '+1/+1 until end of turn when a creature you control attacks alone',
    mandatory: true,
  },
  
  // Battle Cry - Whenever this creature attacks, each other attacking creature gets +1/+0
  {
    pattern: /\bbattle\s*cry\b/i,
    keyword: 'battle_cry',
    category: 'triggered',
    timing: 'attacks',
    effect: () => 'Each other attacking creature gets +1/+0 until end of turn',
    mandatory: true,
  },
  
  // Mentor - Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power
  {
    pattern: /\bmentor\b/i,
    keyword: 'mentor',
    category: 'triggered',
    timing: 'attacks',
    effect: () => 'Put a +1/+1 counter on target attacking creature with lesser power',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'target_creature',
  },
  
  // Training - Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this
  {
    pattern: /\btraining\b/i,
    keyword: 'training',
    category: 'triggered',
    timing: 'attacks',
    effect: () => 'Put a +1/+1 counter on this creature if attacking with greater power creature',
    mandatory: true,
  },
  
  // Flanking - Whenever a creature without flanking blocks this creature, it gets -1/-1
  {
    pattern: /\bflanking\b/i,
    keyword: 'flanking',
    category: 'triggered',
    timing: 'blocks',
    effect: () => 'Blocking creature without flanking gets -1/-1 until end of turn',
    mandatory: true,
  },
  
  // Bushido N - Whenever this creature blocks or becomes blocked, it gets +N/+N
  {
    pattern: /\bbushido\s+(\d+)\b/i,
    keyword: 'bushido',
    category: 'triggered',
    timing: 'blocks',
    valueType: 'pt_bonus',
    effect: (match) => `+${match[1]}/+${match[1]} until end of turn when blocking or blocked`,
    mandatory: true,
  },
  
  // Rampage N - Whenever this creature becomes blocked, it gets +N/+N for each creature blocking it beyond the first
  {
    pattern: /\brampage\s+(\d+)\b/i,
    keyword: 'rampage',
    category: 'triggered',
    timing: 'blocks',
    valueType: 'pt_bonus',
    effect: (match) => `+${match[1]}/+${match[1]} for each creature blocking beyond the first`,
    mandatory: true,
  },
  
  // Lifelink is static but has a triggered component for tracking
  {
    pattern: /\blifelink\b/i,
    keyword: 'lifelink',
    category: 'static',
    timing: 'any_damage',
    effect: () => 'Damage dealt by this creature also gains you that much life',
    mandatory: true,
  },
  
  // Cascade - When you cast this spell, exile cards from top until you exile a nonland card with lesser CMC, cast it free
  {
    pattern: /\bcascade\b/i,
    keyword: 'cascade',
    category: 'triggered',
    timing: 'cast',
    effect: () => 'Exile cards until you exile a nonland card with lesser mana value. You may cast it without paying its mana cost',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'cast_or_decline',
  },
  
  // Storm - When you cast this spell, copy it for each spell cast before it this turn
  {
    pattern: /\bstorm\b/i,
    keyword: 'storm',
    category: 'triggered',
    timing: 'cast',
    effect: () => 'Copy this spell for each spell cast before it this turn',
    mandatory: true,
  },
  
  // Gravestorm - When you cast this spell, copy it for each permanent put into a graveyard this turn
  {
    pattern: /\bgravestorm\b/i,
    keyword: 'gravestorm',
    category: 'triggered',
    timing: 'cast',
    effect: () => 'Copy this spell for each permanent put into a graveyard this turn',
    mandatory: true,
  },
  
  // Ripple N - When you cast this spell, reveal top N cards and cast copies with same name
  {
    pattern: /\bripple\s+(\d+)\b/i,
    keyword: 'ripple',
    category: 'triggered',
    timing: 'cast',
    valueType: 'cards_revealed',
    effect: (match) => `Reveal top ${match[1]} cards. Cast any with same name for free`,
    mandatory: true,
  },
  
  // Poisonous N - Whenever this creature deals combat damage to a player, that player gets N poison counters
  {
    pattern: /\bpoisonous\s+(\d+)\b/i,
    keyword: 'poisonous',
    category: 'triggered',
    timing: 'combat_damage',
    valueType: 'poison',
    effect: (match) => `Player dealt combat damage gets ${match[1]} poison counter${parseInt(match[1]) > 1 ? 's' : ''}`,
    mandatory: true,
  },
  
  // Toxic N - Whenever this creature deals combat damage to a player, that player gets N poison counters
  {
    pattern: /\btoxic\s+(\d+)\b/i,
    keyword: 'toxic',
    category: 'triggered',
    timing: 'combat_damage',
    valueType: 'poison',
    effect: (match) => `Player dealt combat damage gets ${match[1]} poison counter${parseInt(match[1]) > 1 ? 's' : ''}`,
    mandatory: true,
  },
  
  // Modular N - This creature enters with N +1/+1 counters. When it dies, you may put its counters on target artifact creature
  {
    pattern: /\bmodular\s+(\d+)\b/i,
    keyword: 'modular',
    category: 'triggered',
    timing: 'dies',
    valueType: 'counters',
    effect: (match) => `Enters with ${match[1]} +1/+1 counters. When it dies, move counters to target artifact creature`,
    mandatory: false,
    requiresChoice: true,
    choiceType: 'target_artifact_creature',
  },
  
  // Afterlife N - When this creature dies, create N 1/1 Spirit tokens with flying
  {
    pattern: /\bafterlife\s+(\d+)\b/i,
    keyword: 'afterlife',
    category: 'triggered',
    timing: 'dies',
    valueType: 'tokens',
    effect: (match) => `Create ${match[1]} 1/1 white and black Spirit creature token${parseInt(match[1]) > 1 ? 's' : ''} with flying`,
    mandatory: true,
  },
  
  // Soulshift N - When this creature dies, return target Spirit card with mana value N or less from graveyard to hand
  {
    pattern: /\bsoulshift\s+(\d+)\b/i,
    keyword: 'soulshift',
    category: 'triggered',
    timing: 'dies',
    valueType: 'mana_value',
    effect: (match) => `Return target Spirit card with mana value ${match[1]} or less from your graveyard to your hand`,
    mandatory: false,
    requiresChoice: true,
    choiceType: 'target_spirit',
  },
  
  // Fabricate N - When this creature enters, put N +1/+1 counters on it or create N 1/1 Servo tokens
  {
    pattern: /\bfabricate\s+(\d+)\b/i,
    keyword: 'fabricate',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters_or_tokens',
    effect: (match) => `Put ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} on this or create ${match[1]} 1/1 Servo token${parseInt(match[1]) > 1 ? 's' : ''}`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'counters_or_tokens',
  },
  
  // Tribute N - When this creature enters, opponent may put N +1/+1 counters on it. If they don't, [effect]
  {
    pattern: /\btribute\s+(\d+)\b/i,
    keyword: 'tribute',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Opponent may put ${match[1]} +1/+1 counters on this. If they don't, a bonus effect triggers`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'opponent_choice',
  },
  
  // Exploit - When this creature enters, you may sacrifice a creature
  {
    pattern: /\bexploit\b/i,
    keyword: 'exploit',
    category: 'triggered',
    timing: 'etb',
    effect: () => 'You may sacrifice a creature. If you do, a bonus effect triggers',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'sacrifice_creature',
  },
  
  // Enlist - As this creature attacks, you may tap an untapped nonattacking creature to add its power
  {
    pattern: /\benlist\b/i,
    keyword: 'enlist',
    category: 'triggered',
    timing: 'attacks',
    effect: () => 'Tap an untapped nonattacking creature to add its power to this creature',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'tap_creature',
  },
  
  // Boast - Activated ability usable once per turn if creature attacked
  {
    pattern: /\bboast\b/i,
    keyword: 'boast',
    category: 'activated',
    timing: 'attacks',
    effect: () => 'Activated ability usable once per turn if this creature attacked this turn',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'activation',
  },
  
  // Backup N - When this creature enters, put N +1/+1 counters on target creature
  {
    pattern: /\bbackup\s+(\d+)\b/i,
    keyword: 'backup',
    category: 'triggered',
    timing: 'etb',
    valueType: 'counters',
    effect: (match) => `Put ${match[1]} +1/+1 counter${parseInt(match[1]) > 1 ? 's' : ''} on target creature. If it's another creature, it gains this creature's abilities until end of turn`,
    mandatory: true,
    requiresChoice: true,
    choiceType: 'target_creature',
  },
  
  // Encore - {cost}, Exile this card from your graveyard: For each opponent, create a token copy that attacks that opponent
  {
    pattern: /\bencore\b/i,
    keyword: 'encore',
    category: 'activated',
    timing: 'always',
    effect: () => 'Create token copies attacking each opponent, exile them at end step',
    mandatory: false,
    requiresChoice: true,
    choiceType: 'activation',
  },
];

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
 * All keyword patterns combined
 */
const ALL_KEYWORD_PATTERNS: KeywordPattern[] = [
  ...TRIGGERED_KEYWORD_PATTERNS,
  ...STATIC_KEYWORD_PATTERNS,
  ...REPLACEMENT_KEYWORD_PATTERNS,
];

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect all keywords from oracle text
 * @param oracleText - Card's oracle text
 * @param cardName - Card's name (for context)
 * @returns Detection result with all found keywords
 */
export function detectKeywords(oracleText: string, cardName: string = ''): KeywordDetectionResult {
  const keywords: DetectedKeyword[] = [];
  const text = oracleText || '';
  
  // Remove reminder text (text in parentheses) for cleaner matching
  // But keep original for some patterns that need full context
  const textWithoutReminder = text.replace(/\([^)]*\)/g, '');
  
  for (const pattern of ALL_KEYWORD_PATTERNS) {
    // Try matching in text without reminder first, then full text
    let match = textWithoutReminder.match(pattern.pattern);
    if (!match) {
      match = text.match(pattern.pattern);
    }
    
    if (match) {
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
