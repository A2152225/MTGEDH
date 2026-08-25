// server/src/state/planeswalker/templates/registry-handlers/planeswalkerTemplateControlSearchNamedDamageRegexes.ts
// Origin parent: server/src/state/planeswalker/templates/registry.ts
// Cluster moved: control / fight / library-search / named-damage loyalty regex tables
// Public entry symbols: UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT_REGEX, plus 94 sibling regex tables

const UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT_REGEX =
  /^until your next turn, up to one target creature gets ([+-]\d+)\/([+-]\d+)\.?$/i;

const UP_TO_ONE_TARGET_CREATURE_GETS_PT_UNTIL_YOUR_NEXT_TURN_REGEX =
  /^up to one target creature gets ([+-]\d+)\/([+-]\d+) until your next turn\.?$/i;

const UNTIL_YOUR_NEXT_TURN_UP_TO_TWO_TARGET_CREATURES_HAVE_BASE_POWER_AND_TOUGHNESS_0_3_AND_LOSE_ALL_ABILITIES_REGEX =
  /^until your next turn, up to two target creatures each have base power and toughness 0\/3 and lose all abilities\.?$/i;

const TARGET_CREATURE_BECOMES_A_TREASURE_ARTIFACT_WITH_TREASURE_ABILITY_AND_LOSES_ALL_OTHER_CARD_TYPES_AND_ABILITIES_REGEX =
  /^target creature becomes a treasure artifact with\s+"?\{t\},\s*sacrifice this artifact:\s*add one mana of any color"?\s+and loses all other card types and abilities\.?$/i;

const TARGET_ARTIFACT_OR_CREATURE_LOSES_ALL_ABILITIES_AND_BECOMES_A_GREEN_ELK_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_3_3_REGEX =
  /^target (?:artifact or creature|artifact|creature) loses all abilities and becomes a green elk creature with base power and toughness 3\/3\.?$/i;

const GAIN_CONTROL_OF_TARGET_CREATURE_REGEX = /^gain control of target creature\.?$/i;

const GAIN_CONTROL_OF_TARGET_ARTIFACT_REGEX = /^gain control of target artifact\.?$/i;

const GAIN_CONTROL_OF_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_REGEX =
  /^gain control of all creatures target opponent controls\.?$/i;

const EXILE_EACH_NONLAND_PERMANENT_YOUR_OPPONENTS_CONTROL_REGEX =
  /^exile each nonland permanent your opponents control\.?$/i;

const GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_EOT_UNTAP_HASTE_REGEX =
  /^gain control of target creature until end of turn\.\s*untap (?:it|that creature)\.\s*it gains haste until end of turn\.?$/i;

const GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_EOT_UNTAP_HASTE_SAC_NEXT_END_STEP_IF_MV_LE_3_REGEX =
  /^gain control of target creature until end of turn\.\s*untap (?:it|that creature)\.\s*it gains haste until end of turn\.\s*sacrifice it at the beginning of the next end step if (?:it has|its) mana value (?:is )?3 or less\.?$/i;

const EACH_PLAYER_DISCARDS_A_CARD_REGEX = /^each player discards a card\.?$/i;

const REVEAL_TOP_CARD_PUT_INTO_HAND_EACH_OPPONENT_LOSES_LIFE_EQUAL_MV_REGEX =
  /^reveal the top card of your library(?:\.|\s+and)\s*put that card into your hand\.?\s*each opponent loses life equal to its mana value\.?$/i;

const DISCARD_ALL_CARDS_THEN_DRAW_THAT_MANY_PLUS_ONE_REGEX =
  /^discard all the cards in your hand, then draw that many cards plus one\.?$/i;

const EACH_OPPONENT_LOSES_LIFE_EQUAL_CARDS_IN_GRAVEYARD_REGEX =
  /^each opponent loses life equal to the number of cards in their graveyard\.?$/i;

const TARGET_PLAYER_MILLS_THREE_THEN_DRAW_DEPENDING_GRAVEYARD_20_REGEX =
  /^target player mills three cards\. then if a graveyard has twenty or more cards in it, you draw three cards\. otherwise, you draw a card\.?$/i;

const DEAL_X_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_AND_GAIN_X_LIFE_REGEX =
  /^([a-z0-9 ,'-]+) deals x damage to target creature or planeswalker and you gain x life\.?$/i;

const UNTAP_UP_TO_ONE_TARGET_CREATURE_AND_UP_TO_ONE_TARGET_LAND_REGEX =
  /^untap up to one target creature and up to one target land\.?$/i;

const UNTAP_UP_TO_TWO_TARGET_CREATURES_AND_UP_TO_TWO_TARGET_LANDS_REGEX =
  /^untap up to two target creatures and up to two target lands\.?$/i;

const EXILE_TARGET_TAPPED_CREATURE_YOU_GAIN_2_LIFE_REGEX =
  /^exile target tapped creature\. you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i;

const PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_FIRST_STRIKE_EOT_REGEX =
  /^put a \+1\/\+1 counter on up to one target creature\. it gains first strike until end of turn\.?$/i;

const PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_VIGILANCE_EOT_REGEX =
  /^put a \+1\/\+1 counter on up to one target creature\. it gains vigilance until end of turn\.?$/i;

const TARGET_CREATURE_YOU_CONTROL_FIGHTS_ANOTHER_TARGET_CREATURE_REGEX =
  /^target creature you control fights another target creature\.?$/i;

const TARGET_CREATURE_YOU_CONTROL_FIGHTS_TARGET_CREATURE_YOU_DONT_CONTROL_REGEX =
  /^target creature you control fights target creature you don't control\.?$/i;

const TARGET_SUBTYPE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_YOU_DONT_CONTROL_REGEX =
  /^target ([a-z]+) you control deals damage equal to its power to target creature you don't control\.?$/i;

const DEALS_X_DAMAGE_TO_EACH_CREATURE_REGEX = /^([a-z0-9 ,'-]+) deals x damage to each creature\.?$/i;

const EXILE_TARGET_PERMANENT_REGEX = /^exile target permanent\.?$/i;

const DESTROY_TARGET_NONLAND_PERMANENT_REGEX =
  /^destroy target nonland permanent(?: (?:you control|you don't control|an opponent controls))?(?: with mana value \d+ or (?:less|greater))?\.?$/i;

const DESTROY_TARGET_PERMANENT_THATS_ONE_OR_MORE_COLORS_REGEX =
  /^destroy target permanent that['’]s one or more colors\.?$/i;

const YOU_AND_TARGET_OPPONENT_EACH_DRAW_A_CARD_REGEX = /^you and target opponent each draw a card\.?$/i;

const TARGET_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND_REGEX = /^target player exiles a card from their hand\.?$/i;

const TARGET_PLAYER_SACRIFICES_A_CREATURE_REGEX = /^target player sacrifices a creature\.?$/i;

const RETURN_UP_TO_TWO_TARGET_CREATURES_TO_THEIR_OWNERS_HANDS_REGEX =
  /^return up to two target creatures to their owners'? hands\.?$/i;

const PUT_TARGET_CREATURE_ON_TOP_OF_ITS_OWNERS_LIBRARY_REGEX =
  /^put target creature on top of its owner['’]s library\.?$/i;

const TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE_REGEX = /^take an extra turn after this one\.?$/i;

const TAP_ALL_CREATURES_YOUR_OPPONENTS_CONTROL_TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE_REGEX =
  /^tap all creatures your opponents control\.?\s*(?:you\s+)?take an extra turn after this one\.?$/i;

const DEALS_N_DAMAGE_TO_EACH_OPPONENT_REGEX =
  /^([a-z0-9 ,'-]+) deals (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) damage to each opponent\.?$/i;

const RETURN_UP_TO_ONE_TARGET_LAND_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX =
  /^return up to one target land card from your graveyard to your hand\.?$/i;

const RETURN_TARGET_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX =
  /^return target (?:permanent )?card from your graveyard to your hand\.?$/i;

const RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_REGEX =
  /^return (?:another )?target nonland permanent to its owner(?:'|’)s hand\.?$/i;

const RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_THEN_THAT_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND_REGEX =
  /^return target nonland permanent to its owner(?:'|’)s hand, then that player exiles a card from their hand\.?$/i;

const RETURN_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX =
  /^return target creature card(?: with mana value (\d+) or less)? from your graveyard to the battlefield\.(?:\s*[\s\S]+)?$/i;

const RETURN_TARGET_SUBTYPE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX =
  /^return target ([a-z][a-z-]*) card from your graveyard to the battlefield\.?$/i;

const LOOK_AT_TOP_CARD_IF_ITS_A_CREATURE_CARD_YOU_MAY_REVEAL_PUT_INTO_HAND_REGEX =
  /^look at the top card of your library\. if it's a creature card, you may reveal it and put it into your hand\.?$/i;

const CREATE_FRACTAL_0_0_PUT_X_P1P1_COUNTERS_ON_IT_REGEX =
  /^create a 0\/0 green and blue fractal creature token\. put x \+1\/\+1 counters on it\.?$/i;

const CREATE_N_1_1_COLOR_ELEMENTAL_CREATURE_TOKENS_THEY_GAIN_HASTE_SACRIFICE_NEXT_END_STEP_REGEX =
  /^create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) 1\/1 ([a-z]+) elemental creature tokens?\.\s*they gain haste\.\s*sacrifice them at the beginning of the next end step\.?$/i;

const FOR_EACH_ARTIFACT_YOU_CONTROL_CREATE_TOKEN_THATS_A_COPY_TOKENS_GAIN_HASTE_EXILE_NEXT_END_STEP_REGEX =
  /^for each artifact you control, create a token that['’]s a copy of it\.\s*those tokens gain haste\.\s*exile those tokens at the beginning of the next end step\.?$/i;

const CREATE_TOKEN_THATS_A_COPY_OF_TARGET_ARTIFACT_OR_CREATURE_YOU_CONTROL_IT_GAINS_HASTE_EXILE_NEXT_END_STEP_REGEX =
  /^create a token that['’]s a copy of target (?:artifact or creature|artifact|creature) you control(?:, except it(?:'|’)s an artifact in addition to its other types)?\.\s*that token gains haste\.\s*exile (?:it|that token) at the beginning of the next end step\.?$/i;

const CREATE_N_N_COLOR_SUBTYPE_CREATURE_TOKEN_FOR_EACH_LAND_YOU_CONTROL_REGEX =
  /^create a (\d+)\/(\d+) ([a-z]+(?: and [a-z]+)*) ([a-z][a-z-]*(?: [a-z][a-z-]*)*) creature tokens? for each land you control\.?$/i;

const SURVEIL_N_REGEX = /^surveil (\d+)\.?$/i;

const SURVEIL_N_THEN_EXILE_A_CARD_FROM_A_GRAVEYARD_REGEX =
  /^surveil (\d+), then exile a card from a graveyard\.?$/i;

const UNTAP_TARGET_ARTIFACT_OR_CREATURE_IF_ARTIFACT_CREATURE_P1P1_REGEX =
  /^untap target artifact or creature\. if it's an artifact creature, put a \+1\/\+1 counter on it\.?$/i;
const GAIN_LIFE_SELF_REGEX = /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i;
const LOSE_LIFE_SELF_REGEX = /^you lose (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i;

const CREATE_PREDEFINED_ARTIFACT_TOKENS_REGEX =
  /^create (a|an|one|two|three|four|five|\d+) (food|treasure|clue|map|blood|gold|powerstone|shard) tokens?\.?(?:\s*\([^)]*\))?\.?$/i;

const CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS_REGEX =
  /^create (a|an|one|two|three|four|five|\d+) tapped (food|treasure|clue|map|blood|gold|powerstone|shard) tokens?\.?(?:\s*\([^)]*\))?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX =
  /^search your library for a card named (.+), put it onto the battlefield, then shuffle\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_WITH_MANA_VALUE_N_OR_LESS_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX =
  /^search your library for (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land) card with mana value (\d+) or less, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_ANY_NUMBER_OF_SUBTYPE_CREATURE_CARDS_PUT_THEM_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX =
  /^search your library for any number of ([a-z][a-z-]*) creature cards, put them onto the battlefield, then shuffle\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_A_SUBTYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX =
  /^search your library for (?:a|an) (basic )?([a-z][a-z-]*) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_A_CARD_THEN_SHUFFLE_PUT_ON_TOP_REGEX =
  /^search your library for a card(?:,|\.)\s*then shuffle and put that card on top(?: of your library)?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_AN_ARTIFACT_CARD_WITH_MANA_VALUE_X_OR_LESS_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX =
  /^search your library for an artifact card with mana value x or less, put (?:it|that card) onto the battlefield(?:,|\.)\s*then shuffle(?: your library)?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_A_BASIC_LAND_CARD_PUT_IT_ONTO_THE_BATTLEFIELD_OPTIONALLY_TAPPED_THEN_SHUFFLE_REGEX =
  /^search your library for a basic land card, put (?:it|that card) onto the battlefield( tapped)?(?:,|\.)\s*then shuffle(?: your library)?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX =
  /^search your library for (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land|instant|sorcery) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_UP_TO_ONE_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX =
  /^search your library for up to one (?:a|an) (creature|artifact|enchantment|planeswalker|land|basic land|instant|sorcery) card, reveal it, put (?:it|that card) into your hand(?:,|\.)\s*then shuffle(?: your library)?\.?$/i;

const SEARCH_YOUR_LIBRARY_FOR_AN_INSTANT_OR_SORCERY_CARD_THAT_SHARES_A_COLOR_WITH_THIS_PLANESWALKER_EXILE_THEN_SHUFFLE_YOU_MAY_CAST_THAT_CARD_WITHOUT_PAYING_ITS_MANA_COST_REGEX =
  /^search your library for an instant or sorcery card that shares a color with this planeswalker, exile that card(?:,|\.)\s*then shuffle\.?\s*you may cast that card without paying its mana cost\.?$/i;

const SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_SHUFFLE_IF_LIBRARY_REGEX =
  /^search your library and\/or graveyard for a card named (.+) and put it onto the battlefield\. if you search your library this way, shuffle\.?$/i;

const SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_REVEAL_PUT_IT_INTO_YOUR_HAND_SHUFFLE_IF_LIBRARY_REGEX =
  /^search your library and\/or graveyard for a card named (.+), reveal it, and put it into your hand\. if you search your library this way, shuffle\.?$/i;

// Batch: additional unmatched planeswalker loyalty lines (2026-01)
const EACH_OPPONENT_LOSES_1_YOU_GAIN_LIFE_EQUAL_TO_THE_LIFE_LOST_THIS_WAY_REGEX =
  /^each opponent loses 1 life\.\s*you gain life equal to the life lost this way\.?$/i;

const EXILE_TOP_N_CARDS_OF_TARGET_OPPONENTS_LIBRARY_REGEX =
  /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of target opponent(?:'|’)s library\.?$/i;

const DESTROY_TARGET_PLANESWALKER_REGEX = /^destroy (?:another )?target planeswalker\.?$/i;

const DESTROY_ALL_NON_ZOMBIE_CREATURES_REGEX = /^destroy all non-zombie creatures\.?$/i;

const DESTROY_ALL_LANDS_TARGET_PLAYER_CONTROLS_REGEX = /^destroy all lands target player controls\.?$/i;

const EXILE_ALL_CARDS_FROM_TARGET_PLAYERS_LIBRARY_THEN_SHUFFLE_HAND_INTO_LIBRARY_REGEX =
  /^exile all cards from target player(?:'|’)s library, then that player shuffles their hand into their library\.?$/i;

const EXILE_ALL_CARDS_FROM_ALL_OPPONENTS_HANDS_AND_GRAVEYARDS_REGEX =
  /^exile all cards from all opponents(?:'|’) hands and graveyards\.?$/i;

const GAIN_CONTROL_OF_ALL_ARTIFACTS_AND_CREATURES_TARGET_OPPONENT_CONTROLS_REGEX =
  /^gain control of all artifacts and creatures target opponent controls\.?$/i;

const UNTAP_EACH_ENCHANTED_PERMANENT_YOU_CONTROL_REGEX = /^untap each enchanted permanent you control\.?$/i;

const YOU_GAIN_LIFE_EQUAL_TO_CREATURES_YOU_CONTROL_PLUS_PLANESWALKERS_YOU_CONTROL_REGEX =
  /^you gain life equal to the number of creatures you control plus the number of planeswalkers you control\.?$/i;

const SARKHAN_DEALS_1_DAMAGE_TO_EACH_OPPONENT_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL_REGEX =
  /^sarkhan deals 1 damage to each opponent and each creature your opponents control\.?$/i;

const KOTH_DEALS_DAMAGE_TO_TARGET_CREATURE_EQUAL_TO_NUMBER_OF_MOUNTAINS_YOU_CONTROL_REGEX =
  /^koth deals damage to target creature equal to the number of mountains you control\.?$/i;

const NAHIRI_DEALS_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_EQUAL_TO_TWICE_NUMBER_OF_EQUIPMENT_YOU_CONTROL_REGEX =
  /^nahiri deals damage to target creature or planeswalker equal to twice the number of equipment you control\.?$/i;

const NAHIRI_DEALS_X_DAMAGE_TO_TARGET_TAPPED_CREATURE_REGEX = /^nahiri deals x damage to target tapped creature\.?$/i;

const SORIN_MARKOV_DEALS_2_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_2_LIFE_REGEX =
  /^sorin markov deals 2 damage to any target and you gain 2 life\.?$/i;

const KAYA_DEALS_DAMAGE_TO_TARGET_PLAYER_EQUAL_TO_CARDS_THE_PLAYER_OWNS_IN_EXILE_AND_YOU_GAIN_THAT_MUCH_LIFE_REGEX =
  /^kaya deals damage to target player equal to the number of cards that player owns in exile and you gain that much life\.?$/i;

const NICOL_BOLAS_DEALS_7_DAMAGE_TO_EACH_OPPONENT_YOU_DRAW_SEVEN_CARDS_REGEX =
  /^nicol bolas deals 7 damage to each opponent\. you draw seven cards\.?$/i;

const NICOL_BOLAS_DEALS_7_DAMAGE_TO_TARGET_OPPONENT_CREATURE_OR_PLANESWALKER_AN_OPPONENT_CONTROLS_REGEX =
  /^nicol bolas deals 7 damage to target opponent, creature an opponent controls, or planeswalker an opponent controls\.?$/i;

const CHANDRA_DEALS_3_DAMAGE_TO_EACH_NON_ELEMENTAL_CREATURE_REGEX =
  /^chandra deals 3 damage to each non-elemental creature\.?$/i;

const CHANDRA_DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER_AND_EACH_CREATURE_THAT_PLAYER_OR_THAT_PLANESWALKERS_CONTROLLER_CONTROLS_REGEX =
  /^chandra(?: nalaar)? deals (\d+) damage to target player or planeswalker and each creature that player or that planeswalker(?:'|’)s controller controls\.?$/i;

const CHANDRA_NALAAR_DEALS_X_DAMAGE_TO_TARGET_CREATURE_REGEX = /^chandra nalaar deals x damage to target creature\.?$/i;

const YOU_GET_AN_ADVENTURING_PARTY_REGEX = /^you get an adventuring party\.(?:\s*\([^)]*\))?\.?$/i;

const AMASS_ZOMBIES_N_REGEX = /^amass zombies (\d+)\.(?:\s*\([^)]*\))?\.?$/i;

const DESTROY_UP_TO_SIX_TARGET_NONLAND_PERMANENTS_THEN_CREATE_SIX_CAT_WARRIOR_TOKENS_WITH_FORESTWALK_REGEX =
  /^destroy up to six target nonland permanents, then create six 2\/2 green cat warrior creature tokens with forestwalk\.?$/i;

const PUT_THREE_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_THOSE_CREATURES_GAIN_TRAMPLE_EOT_REGEX =
  /^put three \+1\/\+1 counters on each creature you control\. those creatures gain trample until end of turn\.?$/i;

const ROWAN_DEALS_1_DAMAGE_TO_EACH_OF_UP_TO_TWO_TARGET_CREATURES_THOSE_CREATURES_CANT_BLOCK_THIS_TURN_REGEX =
  /^rowan deals 1 damage to each of up to two target creatures\. those creatures can(?:'|’)t block this turn\.?$/i;

const RETURN_UP_TO_ONE_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX =
  /^return up to one target creature card from your graveyard to your hand\.?$/i;

export {
  UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT_REGEX,
  UP_TO_ONE_TARGET_CREATURE_GETS_PT_UNTIL_YOUR_NEXT_TURN_REGEX,
  UNTIL_YOUR_NEXT_TURN_UP_TO_TWO_TARGET_CREATURES_HAVE_BASE_POWER_AND_TOUGHNESS_0_3_AND_LOSE_ALL_ABILITIES_REGEX,
  TARGET_CREATURE_BECOMES_A_TREASURE_ARTIFACT_WITH_TREASURE_ABILITY_AND_LOSES_ALL_OTHER_CARD_TYPES_AND_ABILITIES_REGEX,
  TARGET_ARTIFACT_OR_CREATURE_LOSES_ALL_ABILITIES_AND_BECOMES_A_GREEN_ELK_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_3_3_REGEX,
  GAIN_CONTROL_OF_TARGET_CREATURE_REGEX,
  GAIN_CONTROL_OF_TARGET_ARTIFACT_REGEX,
  GAIN_CONTROL_OF_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_REGEX,
  EXILE_EACH_NONLAND_PERMANENT_YOUR_OPPONENTS_CONTROL_REGEX,
  GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_EOT_UNTAP_HASTE_REGEX,
  GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_EOT_UNTAP_HASTE_SAC_NEXT_END_STEP_IF_MV_LE_3_REGEX,
  EACH_PLAYER_DISCARDS_A_CARD_REGEX,
  REVEAL_TOP_CARD_PUT_INTO_HAND_EACH_OPPONENT_LOSES_LIFE_EQUAL_MV_REGEX,
  DISCARD_ALL_CARDS_THEN_DRAW_THAT_MANY_PLUS_ONE_REGEX,
  EACH_OPPONENT_LOSES_LIFE_EQUAL_CARDS_IN_GRAVEYARD_REGEX,
  TARGET_PLAYER_MILLS_THREE_THEN_DRAW_DEPENDING_GRAVEYARD_20_REGEX,
  DEAL_X_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_AND_GAIN_X_LIFE_REGEX,
  UNTAP_UP_TO_ONE_TARGET_CREATURE_AND_UP_TO_ONE_TARGET_LAND_REGEX,
  UNTAP_UP_TO_TWO_TARGET_CREATURES_AND_UP_TO_TWO_TARGET_LANDS_REGEX,
  EXILE_TARGET_TAPPED_CREATURE_YOU_GAIN_2_LIFE_REGEX,
  PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_FIRST_STRIKE_EOT_REGEX,
  PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_VIGILANCE_EOT_REGEX,
  TARGET_CREATURE_YOU_CONTROL_FIGHTS_ANOTHER_TARGET_CREATURE_REGEX,
  TARGET_CREATURE_YOU_CONTROL_FIGHTS_TARGET_CREATURE_YOU_DONT_CONTROL_REGEX,
  TARGET_SUBTYPE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_YOU_DONT_CONTROL_REGEX,
  DEALS_X_DAMAGE_TO_EACH_CREATURE_REGEX,
  EXILE_TARGET_PERMANENT_REGEX,
  DESTROY_TARGET_NONLAND_PERMANENT_REGEX,
  DESTROY_TARGET_PERMANENT_THATS_ONE_OR_MORE_COLORS_REGEX,
  YOU_AND_TARGET_OPPONENT_EACH_DRAW_A_CARD_REGEX,
  TARGET_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND_REGEX,
  TARGET_PLAYER_SACRIFICES_A_CREATURE_REGEX,
  RETURN_UP_TO_TWO_TARGET_CREATURES_TO_THEIR_OWNERS_HANDS_REGEX,
  PUT_TARGET_CREATURE_ON_TOP_OF_ITS_OWNERS_LIBRARY_REGEX,
  TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE_REGEX,
  TAP_ALL_CREATURES_YOUR_OPPONENTS_CONTROL_TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE_REGEX,
  DEALS_N_DAMAGE_TO_EACH_OPPONENT_REGEX,
  RETURN_UP_TO_ONE_TARGET_LAND_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX,
  RETURN_TARGET_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX,
  RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_REGEX,
  RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_THEN_THAT_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND_REGEX,
  RETURN_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX,
  RETURN_TARGET_SUBTYPE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX,
  LOOK_AT_TOP_CARD_IF_ITS_A_CREATURE_CARD_YOU_MAY_REVEAL_PUT_INTO_HAND_REGEX,
  CREATE_FRACTAL_0_0_PUT_X_P1P1_COUNTERS_ON_IT_REGEX,
  CREATE_N_1_1_COLOR_ELEMENTAL_CREATURE_TOKENS_THEY_GAIN_HASTE_SACRIFICE_NEXT_END_STEP_REGEX,
  FOR_EACH_ARTIFACT_YOU_CONTROL_CREATE_TOKEN_THATS_A_COPY_TOKENS_GAIN_HASTE_EXILE_NEXT_END_STEP_REGEX,
  CREATE_TOKEN_THATS_A_COPY_OF_TARGET_ARTIFACT_OR_CREATURE_YOU_CONTROL_IT_GAINS_HASTE_EXILE_NEXT_END_STEP_REGEX,
  CREATE_N_N_COLOR_SUBTYPE_CREATURE_TOKEN_FOR_EACH_LAND_YOU_CONTROL_REGEX,
  SURVEIL_N_REGEX,
  SURVEIL_N_THEN_EXILE_A_CARD_FROM_A_GRAVEYARD_REGEX,
  UNTAP_TARGET_ARTIFACT_OR_CREATURE_IF_ARTIFACT_CREATURE_P1P1_REGEX,
  GAIN_LIFE_SELF_REGEX,
  LOSE_LIFE_SELF_REGEX,
  CREATE_PREDEFINED_ARTIFACT_TOKENS_REGEX,
  CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_WITH_MANA_VALUE_N_OR_LESS_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_ANY_NUMBER_OF_SUBTYPE_CREATURE_CARDS_PUT_THEM_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_A_SUBTYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_A_CARD_THEN_SHUFFLE_PUT_ON_TOP_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_AN_ARTIFACT_CARD_WITH_MANA_VALUE_X_OR_LESS_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_A_BASIC_LAND_CARD_PUT_IT_ONTO_THE_BATTLEFIELD_OPTIONALLY_TAPPED_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_UP_TO_ONE_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX,
  SEARCH_YOUR_LIBRARY_FOR_AN_INSTANT_OR_SORCERY_CARD_THAT_SHARES_A_COLOR_WITH_THIS_PLANESWALKER_EXILE_THEN_SHUFFLE_YOU_MAY_CAST_THAT_CARD_WITHOUT_PAYING_ITS_MANA_COST_REGEX,
  SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_SHUFFLE_IF_LIBRARY_REGEX,
  SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_REVEAL_PUT_IT_INTO_YOUR_HAND_SHUFFLE_IF_LIBRARY_REGEX,
  EACH_OPPONENT_LOSES_1_YOU_GAIN_LIFE_EQUAL_TO_THE_LIFE_LOST_THIS_WAY_REGEX,
  EXILE_TOP_N_CARDS_OF_TARGET_OPPONENTS_LIBRARY_REGEX,
  DESTROY_TARGET_PLANESWALKER_REGEX,
  DESTROY_ALL_NON_ZOMBIE_CREATURES_REGEX,
  DESTROY_ALL_LANDS_TARGET_PLAYER_CONTROLS_REGEX,
  EXILE_ALL_CARDS_FROM_TARGET_PLAYERS_LIBRARY_THEN_SHUFFLE_HAND_INTO_LIBRARY_REGEX,
  EXILE_ALL_CARDS_FROM_ALL_OPPONENTS_HANDS_AND_GRAVEYARDS_REGEX,
  GAIN_CONTROL_OF_ALL_ARTIFACTS_AND_CREATURES_TARGET_OPPONENT_CONTROLS_REGEX,
  UNTAP_EACH_ENCHANTED_PERMANENT_YOU_CONTROL_REGEX,
  YOU_GAIN_LIFE_EQUAL_TO_CREATURES_YOU_CONTROL_PLUS_PLANESWALKERS_YOU_CONTROL_REGEX,
  SARKHAN_DEALS_1_DAMAGE_TO_EACH_OPPONENT_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL_REGEX,
  KOTH_DEALS_DAMAGE_TO_TARGET_CREATURE_EQUAL_TO_NUMBER_OF_MOUNTAINS_YOU_CONTROL_REGEX,
  NAHIRI_DEALS_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_EQUAL_TO_TWICE_NUMBER_OF_EQUIPMENT_YOU_CONTROL_REGEX,
  NAHIRI_DEALS_X_DAMAGE_TO_TARGET_TAPPED_CREATURE_REGEX,
  SORIN_MARKOV_DEALS_2_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_2_LIFE_REGEX,
  KAYA_DEALS_DAMAGE_TO_TARGET_PLAYER_EQUAL_TO_CARDS_THE_PLAYER_OWNS_IN_EXILE_AND_YOU_GAIN_THAT_MUCH_LIFE_REGEX,
  NICOL_BOLAS_DEALS_7_DAMAGE_TO_EACH_OPPONENT_YOU_DRAW_SEVEN_CARDS_REGEX,
  NICOL_BOLAS_DEALS_7_DAMAGE_TO_TARGET_OPPONENT_CREATURE_OR_PLANESWALKER_AN_OPPONENT_CONTROLS_REGEX,
  CHANDRA_DEALS_3_DAMAGE_TO_EACH_NON_ELEMENTAL_CREATURE_REGEX,
  CHANDRA_DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER_AND_EACH_CREATURE_THAT_PLAYER_OR_THAT_PLANESWALKERS_CONTROLLER_CONTROLS_REGEX,
  CHANDRA_NALAAR_DEALS_X_DAMAGE_TO_TARGET_CREATURE_REGEX,
  YOU_GET_AN_ADVENTURING_PARTY_REGEX,
  AMASS_ZOMBIES_N_REGEX,
  DESTROY_UP_TO_SIX_TARGET_NONLAND_PERMANENTS_THEN_CREATE_SIX_CAT_WARRIOR_TOKENS_WITH_FORESTWALK_REGEX,
  PUT_THREE_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_THOSE_CREATURES_GAIN_TRAMPLE_EOT_REGEX,
  ROWAN_DEALS_1_DAMAGE_TO_EACH_OF_UP_TO_TWO_TARGET_CREATURES_THOSE_CREATURES_CANT_BLOCK_THIS_TURN_REGEX,
  RETURN_UP_TO_ONE_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX,
};
