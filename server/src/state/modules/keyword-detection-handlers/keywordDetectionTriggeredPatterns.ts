// server/src/state/modules/keyword-detection-handlers/keywordDetectionTriggeredPatterns.ts
// Origin parent: server/src/state/modules/keyword-detection.ts
// Cluster moved: TRIGGERED_KEYWORD_PATTERNS.
// Public entry symbols: TRIGGERED_KEYWORD_PATTERNS.

import type { KeywordPattern } from "./keywordDetectionTypes.js";

/**
 * Keyword patterns for triggered abilities
 */
export const TRIGGERED_KEYWORD_PATTERNS: KeywordPattern[] = [
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

  // Haunt - When this creature dies, exile it haunting target creature
  {
    pattern: /\bhaunt\b/i,
    keyword: 'haunt',
    category: 'triggered',
    timing: 'dies',
    effect: () => 'Exile this card haunting target creature',
    mandatory: true,
    requiresChoice: true,
    choiceType: 'target_creature',
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
