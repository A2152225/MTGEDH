// server/src/state/planeswalker/templates/registry-handlers/planeswalkerTemplateDamageDestroyEmblemRegexes.ts
// Origin parent: server/src/state/planeswalker/templates/registry.ts
// Cluster moved: damage / destroy / emblem / mill / targeted-pump loyalty regex tables
// Public entry symbols: TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE_REGEX, plus 89 sibling regex tables

const TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE_REGEX =
  /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards? and loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) life\.?$/i;

const TARGET_PLAYER_DRAWS_N_CARDS_THEN_DISCARDS_M_CARDS_REGEX =
  /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?, then discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i;

const TARGET_PLAYER_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX =
  /^target player gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i;

const TARGET_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX =
  /^target opponent gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i;

const EACH_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX =
  /^each opponent gets an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i;

const ANY_NUMBER_OF_TARGET_PLAYERS_EACH_DRAW_N_CARDS_REGEX =
  /^any number of target players each draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i;

const ADD_MANA_SYMBOLS_REGEX = /^add (\{[WUBRGC]\}(?:\{[WUBRGC]\})*)\.?$/i;

const DEALS_DAMAGE_TO_TARGET_CREATURE_REGEX = /^([a-z0-9 ,'-]+) deals (\d+) damage to target creature\.?$/i;
const DEALS_N_DAMAGE_TO_TARGET_CREATURE_AND_M_DAMAGE_TO_THAT_CREATURES_CONTROLLER_REGEX =
  /^([a-z0-9 ,'-]+) deals (\d+) damage to target creature and (\d+) damage to that creature's controller\.?$/i;

const DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_THAT_PLAYER_CONTROLS_REGEX =
  /^([a-z0-9 ,'-]+) deals (\d+) damage to target player and each creature that player controls\.?$/i;

const DEALS_X_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS_REGEX =
  /^([a-z0-9 ,'-]+) deals x damage to each of up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) targets?\.?$/i;

const DEALS_N_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS_REGEX =
  /^([a-z0-9 ,'-]+) deals (\d+) damage to each of up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) targets?\.?$/i;
const DEALS_N_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_REGEX =
  /^[a-z0-9 ,'-]+ deals (\d+) damage to target creature or planeswalker\.?$/i;

const YOU_DEAL_X_DAMAGE_TO_ANY_TARGET_REGEX = /^you deal x damage to any target\.?$/i;

const TARGET_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_OR_PLANESWALKER_REGEX =
  /^target creature you control deals damage equal to its power to target creature or planeswalker\.?$/i;

const EXILE_TARGET_CREATURE_REGEX = /^exile target creature\.?$/i;

const EXILE_TARGET_CREATURE_WITH_POWER_N_OR_GREATER_REGEX =
  /^exile target creature with power (\d+) or greater\.?$/i;

const EXILE_TARGET_ENCHANTMENT_TAPPED_ARTIFACT_OR_TAPPED_CREATURE_REGEX =
  /^exile target enchantment, tapped artifact, or tapped creature\.?$/i;

const DESTROY_TARGET_ARTIFACT_OR_ENCHANTMENT_REGEX = /^destroy target artifact or enchantment\.?$/i;

const DESTROY_TARGET_ARTIFACT_ENCHANTMENT_OR_CREATURE_WITH_FLYING_REGEX =
  /^destroy target artifact, enchantment, or creature with flying\.?$/i;

const DESTROY_TARGET_CREATURE_DRAW_A_CARD_REGEX = /^destroy target creature\.\s*draw a card\.?$/i;

const DESTROY_TARGET_CREATURE_PUT_LOYALTY_COUNTERS_ON_SOURCE_EQUAL_TO_THAT_CREATURES_TOUGHNESS_REGEX =
  /^destroy target creature\.\s*put loyalty counters on [a-z0-9 ,'-]+ equal to that creature's toughness\.?$/i;

const DESTROY_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_CREATE_A_TREASURE_TOKEN_REGEX =
  /^destroy target artifact, creature, or enchantment\.\s*create a treasure token\.?(?:\s*\([^)]*\))*\.?$/i;

const DESTROY_TARGET_CREATURE_ITS_CONTROLLER_LOSES_2_LIFE_REGEX =
  /^destroy target creature\.\s*its controller loses 2 life\.?$/i;

const DESTROY_TARGET_CREATURE_WITH_A_MINUS1_MINUS1_COUNTER_ON_IT_REGEX =
  /^destroy target creature with a -1\/\-1 counter on it\.?$/i;

const DESTROY_TARGET_CREATURE_YOU_GAIN_LIFE_EQUAL_TO_ITS_TOUGHNESS_REGEX =
  /^destroy target creature\.\s*you gain life equal to its toughness\.?$/i;

const YOU_GAIN_LIFE_AND_DRAW_A_CARD_REGEX =
  /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and draw a card\.?$/i;

const YOU_GAIN_N_LIFE_AND_DRAW_M_CARDS_REGEX =
  /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) life and draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i;

const TARGET_PLAYERS_LIFE_TOTAL_BECOMES_1_REGEX = /^target player's life total becomes 1\.?$/i;

const YOU_GAIN_LIFE_FOR_EACH_CREATURE_YOU_CONTROL_REGEX =
  /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life for each creature you control\.?$/i;

const REVEAL_TOP_CARD_IF_CREATURE_OR_PLANESWALKER_PUT_INTO_HAND_OTHERWISE_MAY_PUT_ON_BOTTOM_REGEX =
  /^reveal the top card of your library\. if it's a creature or planeswalker card, put it into your hand\. otherwise, you may put it on the bottom of your library\.?$/i;

const REVEAL_TOP_CARD_IF_ITS_A_CREATURE_CARD_PUT_INTO_HAND_OTHERWISE_PUT_ON_BOTTOM_REGEX =
  /^reveal the top card of your library\. if it(?:'|’)s a creature card, put it into your hand\. otherwise, put it on the bottom of your library\.?$/i;

const REVEAL_TOP_TWO_PUT_LANDS_ONTO_BATTLEFIELD_REST_INTO_HAND_REGEX =
  /^reveal the top two cards of your library\. put all land cards from among them onto the battlefield and the rest into your hand\.?$/i;

const REVEAL_TOP_FOUR_PUT_LANDS_INTO_HAND_REST_INTO_GRAVEYARD_REGEX =
  /^reveal the top four cards of your library\. put all land cards revealed this way into your hand and the rest into your graveyard\.?$/i;

const RETURN_TARGET_ARTIFACT_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX =
  /^return target artifact card from your graveyard to your hand\.?$/i;

const TARGET_PLAYER_MILLS_N_REGEX =
  /^target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i;
const TARGET_PLAYER_MILLS_N_THEN_DRAW_REGEX =
  /^target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.\s*draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i;
const TARGET_PLAYER_MILLS_THREE_TIMES_X_REGEX = /^target player mills three times x cards?\.?$/i;

const TARGET_PLAYERS_LIFE_TOTAL_BECOMES_N_REGEX =
  /^target (?:player's|opponent's) life total becomes (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\.?$/i;

const PUT_P1P1_ON_TARGETS_REGEX =
  /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on (?:each of )?(?:up to (?:one|two|three|four|five|\d+) )?(?:target|targets?) (?:creature|creatures)[^\.]*\.?$/i;

const PUT_X_P1P1_COUNTERS_ON_TARGET_CREATURE_WHERE_X_IS_YOUR_LIFE_TOTAL_REGEX =
  /^put x \+1\/\+1 counters on target creature, where x is your life total(?:\.\s*that creature gains trample until end of turn)?\.?$/i;

const TARGET_CREATURE_GETS_PT_EOT_REGEX =
  /^(?:until end of turn,?\s*)?(?:up to (?:one|two|three|four|five|\d+) )?target (?:[a-z][a-z-]* )?creatures? gets? ([+-]\d+)\/([+-]\d+)(?: and gains ([^.]+?))?(?: until end of turn)?\.?$/i;

const TARGET_CREATURE_GETS_PLUSX_PLUSX_EOT_WHERE_X_IS_NUMBER_OF_CREATURES_YOU_CONTROL_REGEX =
  /^target creature gets \+x\/\+x until end of turn, where x is the number of creatures you control\.?$/i;

const TARGET_CREATURE_GETS_PLUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ARTIFACTS_YOU_CONTROL_REGEX =
  /^target creature gets \+x\/-x until end of turn, where x is the number of artifacts you control\.?$/i;

const TARGET_CREATURE_GETS_MINUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ZOMBIES_YOU_CONTROL_REGEX =
  /^target creature gets -x\/-x until end of turn, where x is the number of zombies you control\.?$/i;

const DESTROY_TARGET_NONCREATURE_PERMANENT_REGEX = /^destroy target noncreature permanent\.?$/i;
const DESTROY_TARGET_CREATURE_REGEX =
  /^destroy target creature(?: (?:you control|you don't control|an opponent controls))?(?: with mana value \d+ or (?:less|greater))?\.?$/i;
const DESTROY_TARGET_TAPPED_CREATURE_REGEX = /^destroy target tapped creature\.?$/i;
const DESTROY_ALL_CREATURES_POWER_GE_N_REGEX = /^destroy all creatures with power (\d+) or greater\.?$/i;

const DESTROY_ALL_NON_DRAGON_CREATURES_REGEX = /^destroy all non-dragon creatures\.?$/i;

const DESTROY_ALL_CREATURES_YOU_DONT_CONTROL_REGEX = /^destroy all creatures (?:you don't|[a-z0-9 ,'-]+ doesn't) control\.?$/i;

const DESTROY_ALL_OTHER_PERMANENTS_EXCEPT_LANDS_AND_TOKENS_REGEX =
  /^destroy all other permanents except for lands and tokens\.?$/i;

const DESTROY_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_THEN_DEALS_DAMAGE_EQUAL_TO_THEIR_TOTAL_POWER_REGEX =
  /^destroy all creatures target opponent controls\.?\s*(?:[a-z0-9 ,'-]+|it) deals damage to that player equal to their total power\.?$/i;

const EXILE_TARGET_NONLAND_PERMANENT_REGEX =
  /^exile target nonland permanent(?: (?:you control|you don't control|an opponent controls))?(?: with mana value \d+ or (?:less|greater))?\.?$/i;

const DEALS_N_DAMAGE_TO_TARGET_OPPONENT_OR_PLANESWALKER_AND_EACH_CREATURE_THEY_CONTROL_REGEX =
  /^([a-z0-9 ,'-]+) deals (\d+) damage to target opponent or planeswalker and each creature (?:they control|that player or that planeswalker's controller controls)\.?$/i;

const DEALS_DAMAGE_TO_ANY_TARGET_REGEX = /^([a-z0-9 ,'-]+) deals (\d+) damage to any target\.?$/i;

const UNTAP_TARGET_PERMANENT_REGEX = /^untap target permanent\.?$/i;

const UNTAP_ALL_CREATURES_YOU_CONTROL_THEY_GET_PT_EOT_REGEX =
  /^untap all creatures you control\. those creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i;

const UNTAP_TARGET_LAND_YOU_CONTROL_MAY_BECOME_3_3_ELEMENTAL_HASTE_MENACE_EOT_REGEX =
  /^untap target land you control\.\s*you may have it become a 3\/3 elemental creature with haste and menace until end of turn\.\s*it's still a land\.?$/i;

const UNTAP_TARGET_MOUNTAIN_BECOMES_4_4_RED_ELEMENTAL_EOT_REGEX =
  /^untap target mountain\.\s*it becomes a 4\/4 red elemental creature until end of turn\.\s*it's still a land\.?$/i;

const TARGET_LAND_YOU_CONTROL_BECOMES_4_4_ELEMENTAL_TRAMPLE_REGEX =
  /^target land you control becomes a 4\/4 elemental creature with trample\.(?:\s*it's still a land\.)?$/i;

// Gideon-style animation + damage prevention.
// Examples:
// - "Until end of turn, Gideon becomes a 5/5 white Soldier creature that's still a planeswalker. Prevent all damage that would be dealt to him this turn. (He can't attack if he was cast this turn.)"
// - "Until end of turn, Gideon Jura becomes a 6/6 Human Soldier creature that's still a planeswalker. Prevent all damage that would be dealt to him this turn."
const UNTIL_END_OF_TURN_SOURCE_PLANESWALKER_BECOMES_N_N_CREATURE_PREVENT_ALL_DAMAGE_TO_IT_REGEX =
  /^until end of turn,\s*[a-z0-9 ,'-]+ becomes a (\d+)\/(\d+) [a-z0-9 ,'-]+ creature(?: with indestructible)? that's still a planeswalker\.\s*prevent all damage that would be dealt to (?:him|her|it) this turn\.(?:\s*\(he can't attack if he was cast this turn\.\))?$/i;

const UNTAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_REGEX =
  /^untap up to one target artifact or creature\.?$/i;

const UNTAP_UP_TO_N_TARGET_ARTIFACTS_REGEX =
  /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target artifacts?\.?$/i;

const UNTAP_UP_TO_N_TARGET_CREATURES_REGEX =
  /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target creatures?\.?$/i;

const UNTAP_UP_TO_N_TARGET_LANDS_WITH_SUBTYPE_REGEX =
  /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target (plains?|islands?|swamps?|mountains?|forests?)\.?$/i;

const TARGET_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_ARTIFACTS_YOU_CONTROL_REGEX =
  /^target opponent loses life equal to the number of artifacts you control\.?$/i;

const TARGET_CREATURE_CANT_BE_BLOCKED_THIS_TURN_REGEX = /^target creature can't be blocked this turn\.?$/i;

const CREATURES_YOU_CONTROL_CANT_BE_BLOCKED_THIS_TURN_REGEX = /^creatures you control can't be blocked this turn\.?$/i;

const CREATURES_CANT_BE_BLOCKED_THIS_TURN_REGEX = /^creatures (?:can't|cannot) be blocked this turn\.?$/i;

const EACH_OPPONENT_DISCARDS_A_CARD_AND_YOU_DRAW_A_CARD_REGEX =
  /^each opponent discards a card and you draw a card\.?$/i;

const EACH_OPPONENT_LOSES_N_LIFE_AND_YOU_GAIN_N_LIFE_REGEX =
  /^each opponent loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i;

const TARGET_CREATURE_GAINS_FLYING_AND_DOUBLE_STRIKE_EOT_REGEX =
  /^target creature gains flying and double strike until end of turn\.?$/i;

const ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_TARGET_PLAYER_REGEX =
  /^add (\{[wubrgc]\}(?:\{[wubrgc]\})*)\.?\s*[a-z0-9 ,'-]+ deals (\d+) damage to target player\.?$/i;

const ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_UP_TO_ONE_TARGET_PLAYER_OR_PLANESWALKER_REGEX =
  /^add (\{[wubrgc]\}(?:\{[wubrgc]\})*)\.?\s*[a-z0-9 ,'-]+ deals (\d+) damage to up to one target player or planeswalker\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_UP_TO_M_CREATURE_CARDS_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) creature cards? from among them and put them into your hand\. put the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_CARD_AND_OR_A_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal a ([a-zA-Z][a-zA-Z\-]*) card and\/or an? ([a-zA-Z][a-zA-Z\-]*) card from among them and put them into your hand\. put the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? ([a-zA-Z][a-zA-Z\-]*) card from among them and put it into your hand\. put the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_OR_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? ([a-zA-Z][a-zA-Z\-]*) or ([a-zA-Z][a-zA-Z\-]*) card from among them and put it into your hand\. put the rest on the bottom of your library in a random order\.?$/i;

const SCRY_N_REGEX = /^scry (\d+)\.?$/i;

const SCRY_N_THEN_DRAW_A_CARD_REGEX = /^scry (\d+),? then draw a card\.?$/i;

const SCRY_N_IF_YOU_CONTROL_AN_ARTIFACT_DRAW_A_CARD_REGEX =
  /^scry (\d+)\. if you control an artifact, draw a card\.?$/i;

const SCRY_N_THEN_DEALS_M_DAMAGE_TO_EACH_OPPONENT_REGEX =
  /^scry (\d+)\.?\s*(?:[a-z0-9 ,'-]+|it) deals (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) damage to each opponent\.?$/i;

// Some cards include reminder text after the quoted emblem text.
// Example: Wrenn and Six includes a parenthetical rules reminder.
const YOU_GET_EMBLEM_REGEX = /^you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i;

// Catch-all for effects that include a "You get an emblem with \"...\"" clause alongside other effects.
// We treat these as manual-resolution templates unless/until we add safe automation for the full line.
const CONTAINS_YOU_GET_EMBLEM_WITH_QUOTED_TEXT_REGEX = /you get an emblem with,?\s+"([\s\S]+)"/i;

const CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT_REGEX =
  /^creatures you control get ([+-]\d+)\/([+-]\d+) and gain haste until end of turn\.?$/i;

// Some planeswalkers use the leading clause form: "Until end of turn, creatures you control …".
const UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_REGEX =
  /^until end of turn, creatures you control get ([+-]\d+)\/([+-]\d+) and gain haste\.?$/i;

const CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_EOT_REGEX =
  /^creatures you control get ([+-]\d+)\/([+-]\d+) and gain trample until end of turn\.?$/i;

const UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_REGEX =
  /^until end of turn, creatures you control get ([+-]\d+)\/([+-]\d+) and gain trample\.?$/i;

const CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_EOT_REGEX =
  /^creatures you control get ([+-]\d+)\/([+-]\d+) and gain flying until end of turn\.?$/i;

export {
  TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE_REGEX,
  TARGET_PLAYER_DRAWS_N_CARDS_THEN_DISCARDS_M_CARDS_REGEX,
  TARGET_PLAYER_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX,
  TARGET_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX,
  EACH_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX,
  ANY_NUMBER_OF_TARGET_PLAYERS_EACH_DRAW_N_CARDS_REGEX,
  ADD_MANA_SYMBOLS_REGEX,
  DEALS_DAMAGE_TO_TARGET_CREATURE_REGEX,
  DEALS_N_DAMAGE_TO_TARGET_CREATURE_AND_M_DAMAGE_TO_THAT_CREATURES_CONTROLLER_REGEX,
  DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_THAT_PLAYER_CONTROLS_REGEX,
  DEALS_X_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS_REGEX,
  DEALS_N_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS_REGEX,
  DEALS_N_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_REGEX,
  YOU_DEAL_X_DAMAGE_TO_ANY_TARGET_REGEX,
  TARGET_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_OR_PLANESWALKER_REGEX,
  EXILE_TARGET_CREATURE_REGEX,
  EXILE_TARGET_CREATURE_WITH_POWER_N_OR_GREATER_REGEX,
  EXILE_TARGET_ENCHANTMENT_TAPPED_ARTIFACT_OR_TAPPED_CREATURE_REGEX,
  DESTROY_TARGET_ARTIFACT_OR_ENCHANTMENT_REGEX,
  DESTROY_TARGET_ARTIFACT_ENCHANTMENT_OR_CREATURE_WITH_FLYING_REGEX,
  DESTROY_TARGET_CREATURE_DRAW_A_CARD_REGEX,
  DESTROY_TARGET_CREATURE_PUT_LOYALTY_COUNTERS_ON_SOURCE_EQUAL_TO_THAT_CREATURES_TOUGHNESS_REGEX,
  DESTROY_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_CREATE_A_TREASURE_TOKEN_REGEX,
  DESTROY_TARGET_CREATURE_ITS_CONTROLLER_LOSES_2_LIFE_REGEX,
  DESTROY_TARGET_CREATURE_WITH_A_MINUS1_MINUS1_COUNTER_ON_IT_REGEX,
  DESTROY_TARGET_CREATURE_YOU_GAIN_LIFE_EQUAL_TO_ITS_TOUGHNESS_REGEX,
  YOU_GAIN_LIFE_AND_DRAW_A_CARD_REGEX,
  YOU_GAIN_N_LIFE_AND_DRAW_M_CARDS_REGEX,
  TARGET_PLAYERS_LIFE_TOTAL_BECOMES_1_REGEX,
  YOU_GAIN_LIFE_FOR_EACH_CREATURE_YOU_CONTROL_REGEX,
  REVEAL_TOP_CARD_IF_CREATURE_OR_PLANESWALKER_PUT_INTO_HAND_OTHERWISE_MAY_PUT_ON_BOTTOM_REGEX,
  REVEAL_TOP_CARD_IF_ITS_A_CREATURE_CARD_PUT_INTO_HAND_OTHERWISE_PUT_ON_BOTTOM_REGEX,
  REVEAL_TOP_TWO_PUT_LANDS_ONTO_BATTLEFIELD_REST_INTO_HAND_REGEX,
  REVEAL_TOP_FOUR_PUT_LANDS_INTO_HAND_REST_INTO_GRAVEYARD_REGEX,
  RETURN_TARGET_ARTIFACT_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX,
  TARGET_PLAYER_MILLS_N_REGEX,
  TARGET_PLAYER_MILLS_N_THEN_DRAW_REGEX,
  TARGET_PLAYER_MILLS_THREE_TIMES_X_REGEX,
  TARGET_PLAYERS_LIFE_TOTAL_BECOMES_N_REGEX,
  PUT_P1P1_ON_TARGETS_REGEX,
  PUT_X_P1P1_COUNTERS_ON_TARGET_CREATURE_WHERE_X_IS_YOUR_LIFE_TOTAL_REGEX,
  TARGET_CREATURE_GETS_PT_EOT_REGEX,
  TARGET_CREATURE_GETS_PLUSX_PLUSX_EOT_WHERE_X_IS_NUMBER_OF_CREATURES_YOU_CONTROL_REGEX,
  TARGET_CREATURE_GETS_PLUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ARTIFACTS_YOU_CONTROL_REGEX,
  TARGET_CREATURE_GETS_MINUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ZOMBIES_YOU_CONTROL_REGEX,
  DESTROY_TARGET_NONCREATURE_PERMANENT_REGEX,
  DESTROY_TARGET_CREATURE_REGEX,
  DESTROY_TARGET_TAPPED_CREATURE_REGEX,
  DESTROY_ALL_CREATURES_POWER_GE_N_REGEX,
  DESTROY_ALL_NON_DRAGON_CREATURES_REGEX,
  DESTROY_ALL_CREATURES_YOU_DONT_CONTROL_REGEX,
  DESTROY_ALL_OTHER_PERMANENTS_EXCEPT_LANDS_AND_TOKENS_REGEX,
  DESTROY_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_THEN_DEALS_DAMAGE_EQUAL_TO_THEIR_TOTAL_POWER_REGEX,
  EXILE_TARGET_NONLAND_PERMANENT_REGEX,
  DEALS_N_DAMAGE_TO_TARGET_OPPONENT_OR_PLANESWALKER_AND_EACH_CREATURE_THEY_CONTROL_REGEX,
  DEALS_DAMAGE_TO_ANY_TARGET_REGEX,
  UNTAP_TARGET_PERMANENT_REGEX,
  UNTAP_ALL_CREATURES_YOU_CONTROL_THEY_GET_PT_EOT_REGEX,
  UNTAP_TARGET_LAND_YOU_CONTROL_MAY_BECOME_3_3_ELEMENTAL_HASTE_MENACE_EOT_REGEX,
  UNTAP_TARGET_MOUNTAIN_BECOMES_4_4_RED_ELEMENTAL_EOT_REGEX,
  TARGET_LAND_YOU_CONTROL_BECOMES_4_4_ELEMENTAL_TRAMPLE_REGEX,
  UNTIL_END_OF_TURN_SOURCE_PLANESWALKER_BECOMES_N_N_CREATURE_PREVENT_ALL_DAMAGE_TO_IT_REGEX,
  UNTAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_REGEX,
  UNTAP_UP_TO_N_TARGET_ARTIFACTS_REGEX,
  UNTAP_UP_TO_N_TARGET_CREATURES_REGEX,
  UNTAP_UP_TO_N_TARGET_LANDS_WITH_SUBTYPE_REGEX,
  TARGET_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_ARTIFACTS_YOU_CONTROL_REGEX,
  TARGET_CREATURE_CANT_BE_BLOCKED_THIS_TURN_REGEX,
  CREATURES_YOU_CONTROL_CANT_BE_BLOCKED_THIS_TURN_REGEX,
  CREATURES_CANT_BE_BLOCKED_THIS_TURN_REGEX,
  EACH_OPPONENT_DISCARDS_A_CARD_AND_YOU_DRAW_A_CARD_REGEX,
  EACH_OPPONENT_LOSES_N_LIFE_AND_YOU_GAIN_N_LIFE_REGEX,
  TARGET_CREATURE_GAINS_FLYING_AND_DOUBLE_STRIKE_EOT_REGEX,
  ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_TARGET_PLAYER_REGEX,
  ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_UP_TO_ONE_TARGET_PLAYER_OR_PLANESWALKER_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_UP_TO_M_CREATURE_CARDS_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_CARD_AND_OR_A_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_OR_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  SCRY_N_REGEX,
  SCRY_N_THEN_DRAW_A_CARD_REGEX,
  SCRY_N_IF_YOU_CONTROL_AN_ARTIFACT_DRAW_A_CARD_REGEX,
  SCRY_N_THEN_DEALS_M_DAMAGE_TO_EACH_OPPONENT_REGEX,
  YOU_GET_EMBLEM_REGEX,
  CONTAINS_YOU_GET_EMBLEM_WITH_QUOTED_TEXT_REGEX,
  CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT_REGEX,
  UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_REGEX,
  CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_EOT_REGEX,
  UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_REGEX,
  CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_EOT_REGEX,
};
