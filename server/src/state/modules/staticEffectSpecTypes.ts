// Origin parent: server/src/state/modules/staticEffectSpec.ts
// Cluster moved: StaticEffectScopeKind through StaticEffectSpec (declarative spec types).
// Public: all StaticEffect* types; re-exported from staticEffectSpec.ts.

/** Declarative static spec (Phase 5.3). See docs/oracle-ir-phase5-continuous-effects-design.md */
export type StaticEffectScopeKind =
  | 'self'
  | 'creatures_you_control'
  | 'other_creatures_you_control'
  | 'planeswalkers_you_control'
  | 'all_creatures'
  | 'all_creatures_of_type'
  | 'other_all_creatures_of_type'
  | 'other_all_creatures'
  | 'other_all_permanents'
  | 'creature_type'
  | 'opponent_creatures_of_type'
  | 'opponent_creatures'
  | 'opponent_permanents'
  | 'lands_you_control'
  | 'all_permanents'
  | 'permanents_you_control'
  | 'other_permanents_you_control'
  | 'player_you'
  | 'player_opponents';

/** Extra recipient filter on a scope (creature tokens, creatures with flying, with a +1/+1 counter). */
export interface StaticEffectScopeQualifier {
  token?: boolean;
  keyword?: string;
  counter?: string;
  /** "with a counter on it" (any kind). */
  anyCounter?: boolean;
  /** Printed colour letters ("white legendary creatures"). */
  colors?: readonly string[];
  legendary?: boolean;
  /** Type-line word for non-creature groups ("Treasures you control"). */
  subtype?: string;
}

export interface StaticEffectScope {
  kind: StaticEffectScopeKind;
  creatureType?: string;
  qualifier?: StaticEffectScopeQualifier;
}

export interface StaticEffectGrant {
  power?: number;
  toughness?: number;
  /** Layer 7b characteristic-setting ("have base power and toughness N/M"). */
  setPower?: number;
  setToughness?: number;
  /** Layer 4 type-changing ("are Bears in addition"). */
  typeAdditions?: readonly string[];
  /** "is a <creature type>" (CR 205.1b): typeAdditions replace the printed creature subtypes (Goddric). */
  loseOtherCreatureTypes?: boolean;
  abilities?: readonly string[];
  playerHexproof?: boolean;
  playerShroud?: boolean;
  /** Color words/symbols added in addition to printed colors (layer 5). */
  colorAdditions?: readonly string[];
  /** Keywords this effect removes (layer 6 lose / can't have or gain). */
  removeAbilities?: readonly string[];
  /**
   * Keywords every player may ignore when targeting (as-though they didn't
   * have …, without "you control"). Does not strip abilities globally.
   */
  asThoughNoAbilities?: readonly string[];
  /**
   * Keywords the source controller may ignore when targeting (as-though they
   * didn't have …). Does not strip abilities globally.
   */
  asThoughNoAbilitiesForController?: readonly string[];
  /** Multiply power/toughness by a battlefield count (Coat of Arms, Sliver Legion). */
  countBasis?: StaticEffectCountBasis;
  /** Counter type for countBasis source_counters. */
  countCounterType?: string;
  /** controller_permanents_of_type / controller_graveyard_cards_of_type: card type to count ('' = any). */
  countCardType?: string;
  /** controller_permanents_of_type: "for each OTHER creature you control" excludes the counted-around permanent. */
  countExcludeSource?: boolean;
  /** player_counters: whose counters are counted. */
  countWho?: 'you' | 'opponents';
  /** creatures_with_keyword: the keyword (lower-case). */
  countKeyword?: string;
  /** source_counters: count counters on the Aura/Equipment (effectSourcePermanentId), e.g. Sigil of Distinction. */
  countOnEffectSource?: boolean;
  /** attachments_on_source: attachment subtypes counted on the source (aura, equipment). */
  countAttachmentKinds?: readonly string[];
  /**
   * Pillowfort: extra generic mana to attack this spec's source controller,
   * charged once per attacking creature (Ghostly Prison {2}, Baird {1}).
   */
  attackYouTaxGeneric?: number;
  /** Multiply attackYouTaxGeneric by a defender battlefield count (Sphere / domain). */
  attackYouTaxCountBasis?: StaticEffectAttackYouTaxCountBasis;
  /**
   * Norn's Annex: per-creature Phyrexian tax (`{W/P}` = that color or 2 life).
   * Not converted to attackYouTaxGeneric.
   */
  attackYouTaxPhyrexian?: {
    color: 'white' | 'blue' | 'black' | 'red' | 'green';
    symbol: 'W' | 'U' | 'B' | 'R' | 'G';
    life: number;
  };
  /**
   * Hard attack-you lock (Blazing Archon / Elephant Grass black creatures).
   * Evaluated per attacking creature, not as blanket can't-attack.
   */
  attackYouProhibited?: boolean;
  /** Crawlspace: no more than N creatures can attack you each combat. */
  attackYouMaxAttackers?: number;
  /** Silent Arbiter / Dueling Grounds: no more than N creatures can attack each combat. */
  maxAttackersEachCombat?: number;
  /** Silent Arbiter / Dueling Grounds: no more than N creatures can block each combat. */
  maxBlockersEachCombat?: number;
  /**
   * Archangel of Tithes: extra generic mana to block, charged once per
   * blocking creature while the source is attacking.
   */
  blockTaxGeneric?: number;
  /**
   * Heat Wave: extra life to block creatures the source controller controls,
   * charged once per blocking creature. Optional except-color skips that color
   * (nonblue → except blue).
   */
  blockTaxLife?: number;
  blockTaxLifeExceptColor?: 'white' | 'blue' | 'black' | 'red' | 'green';
  /**
   * Heat Wave: creatures matching the spec condition can't block creatures
   * the source controller controls (not a blanket can't-block).
   */
  cantBlockCreaturesYouControl?: boolean;
  /**
   * Onakke Oathkeeper: extra generic mana to attack planeswalkers this spec's
   * source controller controls (not "attack you").
   */
  attackPlaneswalkerYouControlTaxGeneric?: number;
  /**
   * Steward / Hazel: copy activated abilities of cards exiled with the
   * source (`land` / `creature` / `artifact` type-line filter).
   */
  copyActivatedFromExiledWithCardType?: string;
}

export type StaticEffectAttackYouTaxCountBasis =
  | 'enchantments_you_control'
  | 'basic_land_types_you_control'
  | 'counters_on_target';

/** How to count "each other …" for dynamic P/T statics. */
export type StaticEffectCountBasis =
  | 'controller_permanents_of_type'
  | 'attachments_on_source'
  | 'controller_hand_size'
  | 'controller_life_total'
  | 'controller_graveyard_cards_of_type'
  | 'other_creatures_sharing_creature_type'
  | 'other_creatures_matching_scope'
  /** Phase 5: "for each <type> counter on this <permanent>" (Crescendo of War, Chitterspitter). */
  | 'source_counters'
  /** Phase 5: "for each time you've cast your commander from the command zone this game". */
  | 'controller_commander_casts'
  /** "for each Mountain you control" (Earth Servant): effective land subtype in countCardType. */
  | 'controller_lands_of_subtype'
  /** Domain: "for each basic land type among lands you control" (Strength of Unity). */
  | 'controller_basic_land_types'
  /** "for each experience counter you have" (Kalemne), "poison counter your opponents have" (Vishgraz). */
  | 'player_counters'
  /** "for each other creature on the battlefield with flying" (Pride of the Clouds). */
  | 'creatures_with_keyword';

export type StaticEffectLayer = 4 | 5 | 6 | 7;
export type StaticEffectSublayer = '7a' | '7b' | '7c' | '7d';

export type StaticEffectConditionKind =
  | 'controller_life_at_least_starting_plus'
  | 'target_is_token'
  | 'target_is_not_token'
  | 'target_is_token_during_source_controller_turn'
  | 'during_source_controller_turn'
  | 'target_has_mana_color'
  | 'target_is_not_black_creature'
  | 'target_is_not_human_creature'
  | 'target_is_legendary_creature'
  | 'target_is_nonlegendary_creature'
  | 'source_in_graveyard'
  | 'source_in_graveyard_and_control_land_type'
  | 'target_is_tapped'
  | 'target_is_untapped'
  | 'target_is_attacking'
  | 'target_is_ring_bearer'
  | 'source_controller_has_threshold'
  /** "As long as there are N or more cards in your graveyard" (amount = N). */
  | 'source_controller_graveyard_at_least'
  | 'target_is_equipped'
  /** Raid / “if you attacked this turn” (controller attacked). */
  | 'source_controller_attacked_this_turn'
  /** Moat / Katabatic: creatures with / without a keyword. */
  | 'target_has_keyword'
  | 'target_lacks_keyword'
  /** Island Sanctuary stamp: lacks every listed keyword (flying and/or islandwalk). */
  | 'target_lacks_all_keywords'
  /** Ensnaring Bridge: power > cards in source controller’s hand. */
  | 'target_power_greater_than_source_controller_hand_size'
  /** Reverence: creatures with power N or less can't attack you. */
  | 'target_power_at_most'
  /** Combat Calligrapher: Inklings can't attack you. */
  | 'target_has_creature_type'
  /** Clash of Realities: Non-Spirit creatures (generic N-type). */
  | 'target_lacks_creature_type'
  /** Backgrounds: commander creatures you own. */
  | 'target_is_commander'
  | 'target_owned_by_source_controller'
  /** Artifact / enchantment / land creature lords (card type, not subtype). */
  | 'target_has_type'
  /** OTJ designation: Assassin, Mercenary, Pirate, Rogue, or Warlock. */
  | 'target_is_outlaw'
  /** Colorless / gold lords (Ruination Guide / Rienne). */
  | 'target_is_colorless'
  | 'target_is_multicolored'
  /** CR 700.9: counters, Equipment, or Auras. */
  | 'target_is_modified'
  /** Teferi's Moat: chosen color without a keyword. */
  | 'target_has_mana_color_and_lacks_keyword'
  /** Eriette: enchanted by an Aura the source controller controls. */
  | 'target_enchanted_by_aura_you_control'
  /** Archangel of Tithes: as long as this creature is untapped. */
  | 'source_is_untapped'
  /** Archangel of Tithes: as long as this creature is attacking. */
  | 'source_is_attacking'
  /** Raksha Golden Cub: as long as this creature is equipped (lord gated on source). */
  | 'source_is_equipped'
  /** Dawnglade Regent: as long as you're the monarch. */
  | 'source_controller_is_monarch'
  /** Phase 5: Narfi / Khod non-creature-type lord words (snow, Nautilid); negation of target_has_type. */
  | 'target_lacks_type'
  /** Phase 5: chosen-mode statics (Siege cycle, Ano'thr). */
  | 'source_chose_option'
  /** Phase 5: "as long as there are N or more <type> counters on this" (Obscura Ascendancy). */
  | 'source_counter_at_least'
  | 'controller_gained_life_this_turn'
  | 'controller_attacked_with_at_least'
  | 'controller_nonland_entered_at_least'
  | 'controller_graveyard_card_types_at_least'
  | 'controller_library_top_is_color'
  | 'source_attached_is_tapped'
  | 'source_attached_is_untapped'
  | 'controller_controls_named_exactly'
  | 'source_is_solved'
  | 'target_is_face_down'
  /** Wanderglyph: as long as you have the city's blessing. */
  | 'source_controller_has_citys_blessing'
  /** Historic = artifact, legendary, or Saga. */
  | 'target_is_historic'
  | 'target_is_historic_during_source_controller_turn'
  /** Printed or granted tap-for-mana (Raggadragga). */
  | 'target_has_mana_ability'
  /** "As long as you control a/another/N or more <type>" (conditional self statics). */
  | 'source_controller_controls_matching'
  /** "As long as you have N or more life". */
  | 'source_controller_life_at_least'
  /** "As long as it has a +1/+1 counter on it". */
  | 'target_has_counter'
  /** Ozai: "as long as you have N or more unspent mana" (amount). */
  | 'source_controller_unspent_mana_at_least'
  /** Storied: "as long as you have an enduring story". */
  | 'source_controller_has_enduring_story'
  /** "as long as an opponent controls a white permanent" (Black Scarab): color? + cardType. */
  | 'opponent_controls_matching'
  | 'color_most_common_among_permanents'
  | 'target_lacks_mana_color'
  /** Magemark cycle: "creatures you control that are enchanted". */
  | 'target_is_enchanted';

export interface StaticEffectCondition {
  kind: StaticEffectConditionKind;
  /** Life above starting total required (Leyline of Hope). */
  offset?: number;
  /** Mana color name for chosen-color anthems (Caged Sun). */
  color?: string;
  /** Basic land type for GY incarnation statics (Anger / Wonder). */
  landType?: string;
  /** Keyword name for target_has_keyword / target_lacks_keyword (flying). */
  keyword?: string;
  /** Keyword list for target_lacks_all_keywords (flying and islandwalk). */
  keywords?: readonly string[];
  /** Printed/effective power cap for target_power_at_most. */
  power?: number;
  /** Creature type for target_has_creature_type (Inkling). */
  creatureType?: string;
  /** Card type for target_has_type (artifact / enchantment / land). */
  cardType?: string;
  /** source_controller_controls_matching: how many, and whether the source is excluded. */
  count?: number;
  other?: boolean;
  creaturesOnly?: boolean;
  /** source_controller_life_at_least threshold. */
  amount?: number;
  /** target_has_counter counter name ("+1/+1"). */
  counterType?: string;
  /** Mode label / bullet text for source_chose_option. */
  option?: string;
}

export interface StaticEffectSpec {
  id: string;
  scope: StaticEffectScope;
  grant: StaticEffectGrant;
  condition?: StaticEffectCondition;
  /** Extra conditions; all must match with `condition`. */
  conditions?: readonly StaticEffectCondition[];
  /** "Otherwise" half of a conditional static: applies exactly when the condition(s) do NOT hold. */
  conditionNegated?: boolean;
  /** CR 613 layer (default: 7 for P/T, 6 for ability grants). */
  layer?: StaticEffectLayer;
  /** CR 613 sublayer within layer 7 (default: 7b for +N/+N). */
  sublayer?: StaticEffectSublayer;
  sourcePermanentId?: string;
  /** Attached-host specs: the Aura/Equipment itself (sourcePermanentId is the host). */
  effectSourcePermanentId?: string;
  sourceController?: string;
  sourceName?: string;
}
