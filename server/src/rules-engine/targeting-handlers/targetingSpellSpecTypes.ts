// server/src/rules-engine/targeting-handlers/targetingSpellSpecTypes.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: SpellOp, PermanentFilter, SpellTypeFilter, StatRequirement,
//   TargetRestrictionType, TargetRestriction, SpellSpec.
// Public entry symbols: SpellOp, PermanentFilter, SpellTypeFilter,
//   StatRequirement, TargetRestrictionType, TargetRestriction, SpellSpec.

// Spell spec derived heuristically from oracle text
export type SpellOp =
  | 'DESTROY_TARGET' | 'EXILE_TARGET'
  | 'DESTROY_ALL' | 'EXILE_ALL'
  | 'DESTROY_ALL_TARGET_PLAYER' | 'EXILE_ALL_TARGET_PLAYER'
  | 'DESTROY_EACH' | 'DAMAGE_EACH'
  | 'DAMAGE_EACH_OPPONENT' | 'DAMAGE_EACH_PLAYER'
  | 'ANY_TARGET_DAMAGE'
  | 'DAMAGE_TARGET'
  | 'DAMAGE_TARGET_PLAYER'
  | 'GAIN_LIFE' | 'GAIN_LIFE_TARGET_PLAYER'
  | 'LOSE_LIFE' | 'LOSE_LIFE_TARGET_PLAYER'
  | 'GAIN_LIFE_EACH_OPPONENT' | 'GAIN_LIFE_EACH_PLAYER'
  | 'LOSE_LIFE_EACH_OPPONENT' | 'LOSE_LIFE_EACH_PLAYER'
  | 'BOUNCE_TARGET'
  | 'TAP_TARGET' | 'UNTAP_TARGET'
  | 'TAP_ALL' | 'UNTAP_ALL'
  | 'TAP_ALL_TARGET_PLAYER' | 'UNTAP_ALL_TARGET_PLAYER'
  | 'CREATE_TOKEN' | 'INVESTIGATE'
  | 'SCRY' | 'SCRY_EACH_OPPONENT' | 'SCRY_EACH_PLAYER'
  | 'SURVEIL' | 'SURVEIL_TARGET_PLAYER' | 'SURVEIL_EACH_OPPONENT' | 'SURVEIL_EACH_PLAYER'
  | 'MILL_SELF' | 'MILL_TARGET_PLAYER'
  | 'MILL_EACH_OPPONENT' | 'MILL_EACH_PLAYER'
  | 'GOAD_TARGET'
  | 'TARGET_PERMANENT' | 'TARGET_CREATURE' | 'TARGET_PLAYER'
  | 'COUNTER_TARGET_SPELL' | 'COUNTER_TARGET_ABILITY'
  | 'FLICKER_TARGET'
  | 'DRAW_CARDS'
  | 'DRAW_TARGET_PLAYER'
  | 'DRAW_CARDS_EACH_OPPONENT' | 'DRAW_CARDS_EACH_PLAYER'
  | 'DISCARD_TARGET_PLAYER'
  | 'DISCARD_EACH_OPPONENT' | 'DISCARD_EACH_PLAYER'
  | 'BLIGHT_SELF'
  | 'BLIGHT_EACH_OPPONENT' | 'BLIGHT_EACH_PLAYER'
  | 'BLIGHT_TARGET_OPPONENT' | 'BLIGHT_TARGET_PLAYER'
  | 'ADD_COUNTERS_TARGET'
  | 'ADD_COUNTERS_EACH'; // Exile and return to battlefield (Acrobatic Maneuver, Cloudshift, etc.)

export type PermanentFilter = 'ANY' | 'CREATURE' | 'PLANESWALKER' | 'BATTLE' | 'PERMANENT' | 'ARTIFACT' | 'ENCHANTMENT' | 'LAND';

// Spell type filter for counterspells
export type SpellTypeFilter = 'ANY_SPELL' | 'INSTANT_SORCERY' | 'NONCREATURE' | 'CREATURE_SPELL';

// Power/toughness requirement for targeted creatures
export interface StatRequirement {
  stat: 'power' | 'toughness';
  comparison: '<=' | '>=' | '<' | '>' | '=';
  value: number;
  // Repel Calamity: "with power or toughness N or greater/less".
  // Existing power XOR toughness stays on `stat` alone; do not set this for those.
  orStat?: 'power' | 'toughness';
}

// Target restriction - "that..." clauses after "target X"
// These define additional criteria that valid targets must meet
export type TargetRestrictionType = 
  | 'dealt_damage_to_you_this_turn'     // Reciprocate: "target creature that dealt damage to you this turn"
  | 'dealt_combat_damage_to_you_this_turn' // Similar but combat-only
  | 'attacked_this_turn'                 // "target creature that attacked this turn"
  | 'attacked_or_blocked_this_turn'      // "target attacking or blocking creature" (Repel Calamity)
  | 'blocked_this_turn'                  // "target creature that blocked this turn"
  | 'entered_this_turn'                  // "target creature that entered the battlefield this turn"
  | 'tapped'                             // "target tapped creature"
  | 'untapped'                           // "target untapped creature"
  | 'has_keyword'                        // "target creature with flying" (Atraxa's Fall, Wing Snare)
  | 'controlled_by_active_player';       // Delirium: "target creature that player controls" (where "that player" = opponent whose turn it is)

export interface TargetRestriction {
  type: TargetRestrictionType;
  description: string;  // Human-readable description like "that dealt damage to you this turn"
  keyword?: string;     // For has_keyword type: the keyword ability required (flying, reach, etc.)
}

export type SpellSpec = {
  op: SpellOp;
  filter: PermanentFilter;
  minTargets: number;
  maxTargets: number;
  minTargetsIsX?: boolean;
  maxTargetsIsX?: boolean;
  amount?: number;
  amountIsX?: boolean; // For X spells: populate amount at cast/resolve time when X is known.
  nonlandOnly?: boolean; // For "nonland permanents" patterns.
  counterType?: string; // For ADD_COUNTERS_* ops (e.g., '+1/+1', '-1/-1').
  tokenKind?: 'CLUE' | 'TREASURE' | 'FOOD' | 'CREATURE';
  tokenCount?: number;
  tokenCountIsX?: boolean;
  tokenName?: string;
  tokenPower?: number;
  tokenToughness?: number;
  tokenColor?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';
  tokenSubtype?: string;
  scryCount?: number;
  scryCountIsX?: boolean;
  surveilCount?: number;
  surveilCountIsX?: boolean;
  millCount?: number;
  millCountIsX?: boolean; // For X spells: populate millCount at cast/resolve time when X is known.
  millCountDoubleIfCastFromGraveyard?: boolean; // Increasing Confusion: flashback mills twice X.
  spellTypeFilter?: SpellTypeFilter; // For counterspells that only counter certain spell types
  targetDescription?: string; // Human-readable description of what can be targeted
  returnDelay?: 'immediate' | 'end_of_turn' | 'end_of_combat'; // For flicker effects
  statRequirement?: StatRequirement; // For spells like Repel Calamity (toughness 4 or greater)
  targetRestriction?: TargetRestriction; // For "target X that..." clauses (Reciprocate, etc.)
  controllerOnly?: boolean; // For "creature you control" patterns (Acrobatic Maneuver, Cloudshift)
  opponentOnly?: boolean; // For "an opponent controls" patterns
  excludeSource?: boolean; // For "another target" patterns (Skrelv, etc.) - cannot target the source
  multiFilter?: PermanentFilter[]; // For "artifact or enchantment" patterns (Nature's Claim) - uses OR logic
  creatureRestriction?: TargetRestriction; // For restrictions that only apply to creatures when multiFilter includes CREATURE (Atraxa's Fall)
  addExtraCombat?: boolean;
};
