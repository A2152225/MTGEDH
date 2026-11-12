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
  /** B73: Sheltering Prayers — Basic lands. */
  basic?: boolean;
  /** Type-line word for non-creature groups ("Treasures you control"). */
  subtype?: string;
  /** Excluded card type ("each nonland permanent you control"). */
  nonType?: string;
  /** "attacking tokens you control" (Starry-Eyed Skyrider). */
  attacking?: boolean;
  blocking?: boolean;
  /** "transformed permanent you control" (Mutagen Connoisseur). */
  transformed?: boolean;
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
  /** B62: Aettir ? set base power to controller life total. */
  setPowerFromControllerLife?: boolean;
  /** B62: Aettir ? set base toughness to controller life total. */
  setToughnessFromControllerLife?: boolean;
  /** B70: Animate Artifact — base P/T each equal to the recipient's mana value. */
  setPowerToughnessFromManaValue?: boolean;
  /** Layer 4 type-changing ("are Bears in addition"). */
  typeAdditions?: readonly string[];
  /** "is a <creature type>" (CR 205.1b): typeAdditions replace the printed creature subtypes (Goddric). */
  loseOtherCreatureTypes?: boolean;
  /** B72: Aeve — "~ isn't legendary if it's a token" (removes Legendary for legend rule / type checks). */
  notLegendary?: boolean;
  abilities?: readonly string[];
  /** B58: Tam - grant hexproof from each of the recipient's colors. */
  hexproofFromOwnColors?: boolean;
  /** B68: Earnest Fellowship - protection from each of the recipient's colors. */
  protectionFromOwnColors?: boolean;
  /** B71: Empty-Shrine Kannushi - protection from each color among permanents you control. */
  protectionFromColorsAmongPermanentsYouControl?: boolean;
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
  countWho?: 'you' | 'opponents' | 'all';
  /** creatures_with_keyword: the keyword (lower-case). */
  countKeyword?: string;
  /** creatures_named: lower-case card name. */
  countName?: string;
  /** B74: recipient_mana_symbols — color word (white/blue/…) or letter (W/U/…). */
  countColor?: string;
  /** source_counters: count counters on the Aura/Equipment (effectSourcePermanentId), e.g. Sigil of Distinction. */
  countOnEffectSource?: boolean;
  /** B79: "for every N cards…" — floor-divide the countBasis result by this (Dark Matter Manipulator). */
  countDivisor?: number;
  /** attachments_on_source: attachment subtypes counted on the source (aura, equipment). */
  countAttachmentKinds?: readonly string[];
  /** controller_permanents_of_type: extra filter on counted permanents ("for each legendary creature you control"). */
  countQualifier?: StaticEffectScopeQualifier;
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
  /** Eternal Wanderer: no more than N creatures can attack this permanent each combat. */
  maxAttackersAgainstSource?: number;
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
  /** Necrotic Ooze family: borrow activated abilities from a zone / filter (staticEffectSpecBorrowedActivated). */
  borrowActivated?: import('./staticEffectSpecBorrowedActivated.js').BorrowedActivatedSpec;
}

export type StaticEffectAttackYouTaxCountBasis =
  | 'enchantments_you_control'
  | 'basic_land_types_you_control'
  | 'counters_on_target';

/** How to count "each other …" for dynamic P/T statics. */
export type StaticEffectCountBasis =
  /** R26: "for each opponent whose life total is less than half their starting life total" (Anya). */
  | 'opponents_below_half_starting_life'
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
  | 'creatures_with_keyword'
  /** R35: "for each card in its controller's hand" (attached host's controller). */
  | 'host_controller_hand_size'
  /** R35: "for each of its colors" (the counted-around permanent's colors). */
  | 'host_color_count'
  /** R35: "for each other creature on the battlefield named <name>" (countName). */
  | 'creatures_named'
  /** B74: Light from Within — for each COLOR mana symbol in the recipient's mana cost. */
  | 'recipient_mana_symbols'
  /** B75: Coram — greatest power among creature cards in all graveyards. */
  | 'greatest_power_among_creature_cards_in_all_graveyards'
  /** B77: Omnath — for each unspent mana you have. */
  | 'controller_unspent_mana'
  /** B81: Faeburrow Elder — for each color among permanents you control. */
  | 'controller_colors_among_permanents'
  /** B81: Gleam of Authority — for each +1/+1 counter on other creatures you control. */
  | 'counters_on_other_creatures_you_control'
  /** B82: Death's Approach — creature cards in the host controller's graveyard. */
  | 'host_controller_graveyard_cards_of_type'
  /** B82: Sword of the Squeak — creatures you control with base power or toughness N. */
  | 'controller_creatures_with_base_power_or_toughness'
  /** B83: Emissary Escort — greatest mana value among [other] artifacts you control. */
  | 'greatest_mana_value_among_controller_permanents'
  /** B83: Knowledge Is Power — cards you've drawn this turn. */
  | 'controller_cards_drawn_this_turn'
  /** B84: Aspect of Wolf — half Forests rounded down / up. */
  | 'controller_lands_of_subtype_half_down'
  | 'controller_lands_of_subtype_half_up'
  /** B85: Earthen Ally — colors among <subtype> you control. */
  | 'controller_colors_among_creature_type'
  /** B85: Moraug — times the recipient has attacked this turn. */
  | 'recipient_times_attacked_this_turn'
  /** B87: Upriser Renegade — other modified creatures you control. */
  | 'controller_modified_creatures'
  /** B87: Rampant Frogantua — players who have lost the game. */
  | 'players_who_lost_the_game'
  /** B87: Bearded Axe — Dwarf / Equipment / Vehicle you control (any match). */
  | 'controller_permanents_matching_any_type'
  /** B88: Cid — Artificers you control + Artificer cards in your graveyard. */
  | 'controller_subtype_battlefield_and_graveyard'
  /** B88: Copperhoof — untapped permanents opponents control. */
  | 'opponents_untapped_permanents'
  /** B88: Strata Scythe — lands sharing the effect source's exiled card name. */
  | 'lands_matching_effect_source_exiled_name'

export type StaticEffectLayer = 4 | 5 | 6 | 7;
export type StaticEffectSublayer = '7a' | '7b' | '7c' | '7d';

export type StaticEffectConditionKind =
  | 'controller_life_at_least_starting_plus'
  | 'target_is_token'
  | 'target_is_not_token'
  | 'target_is_token_during_source_controller_turn'
  | 'during_source_controller_turn'
  /** Mesa Lynx: during turns other than yours. */
  | 'not_during_source_controller_turn'
  | 'target_has_mana_color'
  | 'target_is_not_black_creature'
  | 'target_is_not_human_creature'
  | 'target_is_legendary_creature'
  | 'target_is_nonlegendary_creature'
  | 'source_in_graveyard'
  | 'source_in_graveyard_and_control_land_type'
  | 'target_is_tapped'
  | 'target_is_untapped'
  /** B78: Mirri — as long as this creature is tapped. */
  | 'source_is_tapped'
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
  /** Stormtide / mass combat: lacks any of the listed keywords (flying or islandwalk). */
  | 'target_lacks_keywords'
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
  /** B58: Don Andres - creatures you control but don't own. */
  | 'target_not_owned_by_source_controller'
  /** Artifact / enchantment / land creature lords (card type, not subtype). */
  | 'target_has_type'
  /** OTJ designation: Assassin, Mercenary, Pirate, Rogue, or Warlock. */
  | 'target_is_outlaw'
  /** Colorless / gold lords (Ruination Guide / Rienne). */
  | 'target_is_colorless'
  | 'target_is_multicolored'
  /** CR 700.9: counters, Equipment, or Auras. */
  | 'target_is_modified'
  /** B70: Koll — enchanted or equipped (Aura or Equipment attached). */
  | 'target_is_enchanted_or_equipped'
  /** B71: Boarded Window — creatures attacking you. */
  | 'target_is_attacking_source_controller'
  /** B71: Living Conundrum — no cards in your library. */
  | 'controller_library_empty'
  /** B71: On Wings of Gold — Zombie and/or token. */
  | 'target_is_zombie_or_token'
  /** B71: Champion's Drake — you control a creature with N+ counters of a type. */
  | 'controller_controls_creature_with_counter_at_least'
  /** Fledgling Osprey: as long as it's enchanted (any Aura). */
  | 'target_is_enchanted'
  /** Karakyk Guardian: "if it hasn't dealt damage yet" (permanent.hasDealtDamage, set when it deals damage). */
  | 'target_has_not_dealt_damage'
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
  /** R24 Timber Paladin: "enchanted by exactly N Auras" / "N or more Auras" (amount, exact, cardType = subtype). */
  | 'source_attachment_count'
  /** R24: Guul Draz Vampire / Erebos's Titan / Murasa Behemoth (staticEffectSpecOpponentStateConditions.ts). */
  | 'opponent_life_at_most'
  | 'no_opponent_controls_matching'
  | 'controller_graveyard_type_at_least'
  /** "Max speed — ..." P/T riders (Walking Sarcophagus): controller's speed is at least amount. */
  | 'controller_speed_at_least'
  /** R26: "a library has twenty or fewer cards in it" (Isleback Spawn). */
  | 'any_library_at_most'
  /** R26: "an opponent's life total is less than half their starting life total" (Anya). */
  | 'opponent_life_below_half_starting'
  /** R26: "an opponent has three or more poison counters" (Skrelv's Hive). */
  | 'opponent_poison_at_least'
  /** R26: "you control exactly one creature" (Deadly Wanderings). */
  | 'controller_creature_count_exactly'
  | 'controller_gained_life_this_turn'
  /** B60: Essence Channeler - as long as you've lost life this turn. */
  | 'controller_lost_life_this_turn'
  /** B60: Gloom Stalker - as long as you've completed a dungeon. */
  | 'controller_completed_dungeon'
  /** B60: Swordsworn Cavalier - another <type> entered under your control this turn. */
  | 'controller_creature_type_entered_this_turn'
  | 'controller_attacked_with_at_least'
  | 'controller_nonland_entered_at_least'
  | 'controller_graveyard_card_types_at_least'
  /** B59: "N or more mana values among cards in your graveyard". */
  | 'controller_graveyard_mana_values_at_least'
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
  | 'opponent_controls_creature_with_keyword_excluding_name'
  | 'color_most_common_among_permanents'
  | 'target_lacks_mana_color'
  /** Magemark cycle: "creatures you control that are enchanted". */
  | 'target_is_enchanted'
  /** R35 (staticEffectSpecR35Conditions.ts). */
  | 'defending_player_controls_matching'
  | 'defending_player_has_counter'
  | 'any_player_hand_at_most'
  | 'controller_spells_cast_this_turn_at_least'
  | 'controller_controls_no_other'
  | 'target_power_less_than_source'
  /** B52: Curse of Hospitality -- target is attacking the player the source Aura enchants. */
  | 'target_is_attacking_enchanted_player'
  /** B62: Beast / Kid Loki ? counters put on the permanent this turn. */
  | 'target_had_counters_put_this_turn'
  /** B62: Archangel of Strife ? creature's controller chose war/peace on the source. */
  | 'target_controller_chose_option_on_source'
  /** B62: Brenard / Miriam ? type_line matches any of the listed subtypes. */
  | 'target_has_any_subtype'
  /** B62: Earth Rumble ? land creature you control OR a land entered under you this turn. */
  | 'controller_land_creature_or_land_entered_this_turn'
  /** B63: Triarch ? creatures attacking the last chosen player. */
  | 'target_is_attacking_last_chosen_player_on_source'
  /** B67: Omenport Vigilante / Slickshot — as long as you've committed a crime this turn. */
  | 'source_controller_committed_crime_this_turn'
  /** B67: War Historian — as long as it attacked a battle this turn. */
  | 'target_attacked_battle_this_turn'
  /** B69: Solitary Camel — Desert you control or Desert card in graveyard. */
  | 'controller_desert_or_desert_in_graveyard'
  /** B72: Rohgahh — creatures you control named <Name>. */
  | 'target_has_name'
  /** B72: Evolved Spinoderm — N or fewer counters on source. */
  | 'source_counter_at_most'
  /** B72: Lyse Hext — cast N+ noncreature spells this turn. */
  | 'controller_noncreature_spells_cast_at_least'
  /** B72: Glacial Crasher — there is a Mountain (etc.) on the battlefield. */
  | 'battlefield_has_matching'
  /** B73: Sheltering Prayers — that player controls ≤N permanents of a type. */
  | 'target_controller_controls_at_most'
  /** B73: Keen-Eyed Curator — N+ card types among cards exiled with source. */
  | 'source_exiled_card_types_at_least'
  /** B75: Technodrome — power is N or greater. */
  | 'target_power_at_least'
  /** B75: Soul Swindler — visited an Attraction this turn. */
  | 'source_controller_visited_attraction_this_turn'
  /** B76: Chillerpillar — as long as it is monstrous. */
  | 'target_is_monstrous'
  /** B76: Flutterfox — you control an artifact or enchantment. */
  | 'source_controller_controls_artifact_or_enchantment'
  /** B76: Hungry Ridgewolf — another Wolf or Werewolf. */
  | 'source_controller_controls_creature_type_any'
  /** B76: Goblin Blast-Runner — sacrificed a permanent this turn. */
  | 'source_controller_sacrificed_permanent_this_turn'
  /** B85: Furtive Courier — sacrificed an artifact this turn. */
  | 'source_controller_sacrificed_artifact_this_turn'
  /** B85: Runadi — creatures with N+ counters of a type. */
  | 'target_has_counter_at_least'
  /** B86: Tromokratis — hexproof unless attacking or blocking. */
  | 'target_is_attacking_or_blocking'
  /** B86: Hooded Horror — defending player controls the most creatures (or tied). */
  | 'defending_player_controls_most_creatures'
  /** B87: Bloodcrazed Goblin — an opponent has been dealt damage this turn. */
  | 'opponent_dealt_damage_this_turn'
  /** B87: Flowering Lumberknot — paired with a soulbond creature. */
  | 'target_is_paired_with_soulbond'
  /** B87: Doctor Doom — control an artifact creature or a named subtype (Plan). */
  | 'source_controller_controls_artifact_creature_or_subtype'
  /** B87: Hundred-Battle Veteran — N+ distinct counter kinds among your creatures. */
  | 'controller_creatures_distinct_counter_kinds_at_least'
  /** B87: Gimli — N+ creatures died under your control this turn. */
  | 'source_controller_creatures_died_this_turn_at_least'
  /** B76: Homarid — exactly N counters of a type on source. */
  | 'source_counter_exactly'
  /** B76: Tenacious Hunter — a creature has a given counter. */
  | 'battlefield_has_creature_with_counter'
  /** B77: Tom Bombadil — N+ lore counters among Sagas you control. */
  | 'source_controller_saga_lore_counters_at_least'
  /** B78: Leapfrog — cast an instant or sorcery this turn. */
  | 'controller_instant_or_sorcery_cast_this_turn'
  /** B78: Swimmer — any single graveyard has N+ cards. */
  | 'any_graveyard_at_least'
  /** B78: Arcus — recipient lacks a counter of a type. */
  | 'target_lacks_counter'
  /** B79: The Space Family Goblinson — rolled N+ dice this turn. */
  | 'source_controller_dice_rolled_at_least'
  /** B79: Kumena's Speaker — another Merfolk or an Island (creature type OR land type). */
  | 'source_controller_controls_creature_or_land_type_any'
  /** B80: Warden of the Beyond — an opponent owns a card in exile. */
  | 'opponent_owns_card_in_exile'
  /** B81: Guul Draz Specter — an opponent has ≤N cards in hand. */
  | 'opponent_hand_at_most'
  /** B81: Secretkeeper — more cards in hand than each opponent. */
  | 'controller_hand_larger_than_each_opponent'
  /** B81: Formation Breaker — you control a creature with any counter. */
  | 'source_controller_controls_creature_with_any_counter'
  /** B81: Curse of Death's Hold — recipient's controller is the enchanted player. */
  | 'target_controller_is_enchanted_player'
  /** B82: Phoenix Fleet — you control N or more permanents named X. */
  | 'controller_controls_named_at_least'
  /** B83: Lovestruck Beast — you control a printed N/M creature. */
  | 'source_controller_controls_creature_with_base_pt'
  /** B83: creatures you control that entered this turn. */
  | 'target_entered_this_turn'
  /** B88: hellbent / zone-count gates (e.g. no cards in hand). */
  | 'zone_count';

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
  /** B83: source_controller_controls_creature_with_base_pt printed toughness. */
  toughness?: number;
  /** Creature type for target_has_creature_type (Inkling). */
  creatureType?: string;
  /** B76: source_controller_controls_creature_type_any — any of these creature types. */
  creatureTypes?: readonly string[];
  /** B79: source_controller_controls_creature_or_land_type_any — land subtypes (Island). */
  landTypes?: readonly string[];
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
  /** source_attachment_count: exact match instead of at-least. */
  exact?: boolean;
  /** Mode label / bullet text for source_chose_option. */
  option?: string;
  /** B61: Escaped Shapeshifter - excluded creature name. */
  excludedName?: string;
  /** B62: target_has_any_subtype ? lower-case subtype words (food, golem, mount). */
  subtypes?: readonly string[];
  /** B72: target_has_name — exact card name (lower-cased compare). */
  cardName?: string;
  /** zone_count: zone name (hand, graveyard, library, ...). */
  zone?: string;
  /** zone_count: whose zone is counted. */
  who?: 'you' | 'opponents' | 'all';
  /** zone_count: comparison (max / min / eq / at_most / at_least). */
  cmp?: string;
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
