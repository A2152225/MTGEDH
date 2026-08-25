// server/src/state/planeswalker/templates/registry-handlers/planeswalkerTemplateDrawExileLookRegexes.ts
// Origin parent: server/src/state/planeswalker/templates/registry.ts
// Cluster moved: draw / exile-top / look-at-top / discard-draw loyalty regex tables (lines 4-251)
// Public entry symbols: DRAW_SELF_REGEXES, plus 85 sibling regex tables

const DRAW_SELF_REGEXES: RegExp[] = [
  /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i,
  /^you draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i,
];

const DRAW_N_CARDS_YOU_GET_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX =
  /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\. you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?$/i;

const RETURN_TARGET_CREATURE_TO_OWNERS_HAND_REGEX = /^return target creature to its owner's hand\.?$/i;

const RETURN_UP_TO_ONE_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_TO_OWNERS_HAND_DRAW_A_CARD_REGEX =
  /^return up to one target artifact, creature, or enchantment to its owner's hand\.\s*draw a card\.?$/i;

const EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_PLAY_IT_THIS_TURN_REGEX =
  /^exile the top card of your library\.\s*you may play (?:it|that card) this turn\.?$/i;

const EXILE_TOP_CARD_OF_YOUR_LIBRARY_IF_ITS_RED_YOU_MAY_CAST_IT_THIS_TURN_REGEX =
  /^exile the top card of your library\.\s*if it(?:'|’)s red, you may cast it this turn\.?$/i;

const EXILE_TOP_N_CARDS_OF_YOUR_LIBRARY_YOU_MAY_PLAY_THEM_THIS_TURN_REGEX =
  /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may play them this turn\.?$/i;

const EXILE_TOP_TWO_CARDS_OF_YOUR_LIBRARY_CHOOSE_ONE_YOU_MAY_PLAY_IT_THIS_TURN_REGEX =
  /^exile the top two cards of your library\.\s*choose one of them\.\s*you may play that card this turn\.?$/i;

const EXILE_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REGEX =
  /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may put any number of creature and\/or land cards from among them onto the battlefield\.?$/i;

const EXILE_TOP_N_PUT_ALL_ARTIFACT_CARDS_ONTO_BATTLEFIELD_REGEX =
  /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*put all artifact cards from among them onto the battlefield\.?$/i;

const EXILE_TOP_N_CREATURE_CARDS_GAIN_CAST_FROM_EXILE_WHILE_YOU_CONTROL_A_LUKKA_PLANESWALKER_REGEX =
  /^exile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*creature cards exiled this way gain "you may cast this card from exile as long as you control a lukka planeswalker\."\.?$/i;

const EXILE_TARGET_CREATURE_YOU_CONTROL_REVEAL_UNTIL_CREATURE_GREATER_MV_PUT_BATTLEFIELD_REST_BOTTOM_RANDOM_REGEX =
  /^exile target creature you control, then reveal cards from the top of your library until you reveal a creature card with greater mana value\.\s*put that card onto the battlefield and the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_SEVEN_MAY_PUT_PERMANENT_MV3_OR_LESS_ONTO_BATTLEFIELD_WITH_SHIELD_COUNTER_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top seven cards of your library\.\s*you may put a permanent card with mana value 3 or less from among them onto the battlefield with a shield counter on it\.\s*put the rest on the bottom of your library in a random order\.?$/i;

const DRAW_TWO_CARDS_THEN_DISCARD_TWO_UNLESS_DISCARD_AN_ARTIFACT_CARD_REGEX =
  /^draw two cards\.\s*then discard two cards unless you discard an artifact card\.?$/i;

const EACH_PLAYER_SACRIFICES_TWO_CREATURES_REGEX =
  /^each player sacrifices two creatures of their choice\.?$/i;

const DRAW_A_CARD_THEN_ADD_ONE_MANA_OF_ANY_COLOR_REGEX = /^draw a card, then add one mana of any color\.?$/i;

const DRAW_A_CARD_THEN_SCRY_N_REGEX = /^draw a card, then scry (\d+)\.?$/i;

const DRAW_A_CARD_THEN_DISCARD_A_CARD_AT_RANDOM_REGEX = /^draw a card, then discard a card at random\.?$/i;

const DRAW_A_CARD_TARGET_PLAYER_MILLS_A_CARD_REGEX = /^draw a card\.\s*target player mills a card\.?$/i;

const DRAW_A_CARD_EACH_PLAYER_MILLS_TWO_CARDS_REGEX = /^draw a card\.\s*each player mills two cards\.?$/i;

const DRAW_N_CARDS_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_THE_BOTTOM_OF_YOUR_LIBRARY_REGEX =
  /^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, then put a card from your hand on the bottom of your library\.?$/i;

const DRAW_A_CARD_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_TOP_OF_YOUR_LIBRARY_REGEX =
  /^draw a card, then put a card from your hand on top of your library\.?$/i;

const DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX =
  /^draw cards equal to the greatest power among creatures you control\.?$/i;

const DISCARD_YOUR_HAND_THEN_DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX =
  /^discard your hand, then draw cards equal to the greatest power among creatures you control\.?$/i;

const DISCARD_YOUR_HAND_THEN_EXILE_TOP_THREE_CARDS_OF_YOUR_LIBRARY_UNTIL_END_OF_TURN_YOU_MAY_PLAY_CARDS_EXILED_THIS_WAY_REGEX =
  /^discard your hand, then exile the top three cards of your library\.\s*until end of turn, you may play cards exiled this way\.?$/i;

const YOU_GAIN_LIFE_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX =
  /^you gain life equal to the greatest power among creatures you control\.?$/i;

const EACH_PLAYER_DISCARDS_THEIR_HAND_THEN_DRAWS_THREE_CARDS_REGEX =
  /^each player discards their hand, then draws three cards\.?$/i;

const EACH_PLAYER_DRAWS_A_CARD_REGEX = /^each player draws a card\.?$/i;

const REVEAL_CARDS_UNTIL_ARTIFACT_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^reveal cards from the top of your library until you reveal an artifact card\. put that card into your hand and the rest on the bottom of your library in a random order\.?$/i;

const EACH_PLAYER_SHUFFLES_HAND_AND_GRAVEYARD_INTO_LIBRARY_YOU_DRAW_SEVEN_REGEX =
  /^each player shuffles their hand and graveyard into their library\. you draw seven cards\.?$/i;

const RETURN_UP_TO_TWO_TARGET_LAND_CARDS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX =
  /^return up to two target land cards from your graveyard to the battlefield\.?$/i;

const DISCARD_A_CARD_THEN_DRAW_A_CARD_IF_LAND_DISCARDED_DRAW_AN_ADDITIONAL_CARD_REGEX =
  /^discard a card, then draw a card\. if a land card is discarded this way, draw an additional card\.?$/i;

const DISCARD_A_CARD_THEN_DRAW_A_CARD_REGEX = /^discard a card, then draw a card\.?$/i;

const ATTACH_THIS_EQUIPMENT_TO_UP_TO_ONE_TARGET_CREATURE_YOU_CONTROL_REGEX =
  /^attach this equipment to up to one target creature you control\.?$/i;

const IF_TARGET_PLAYER_HAS_FEWER_THAN_NINE_POISON_COUNTERS_THEY_GET_DIFFERENCE_REGEX =
  /^if target player has fewer than nine poison counters, they get a number of poison counters equal to the difference\.?$/i;

const CREATE_X_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_WHERE_X_IS_HIGHEST_LIFE_TOTAL_REGEX =
  /^create x 1\/1 black vampire knight creature tokens with lifelink, where x is the highest life total among all players\.?$/i;

const CREATE_A_NUMBER_OF_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_EQUAL_TO_HIGHEST_LIFE_TOTAL_REGEX =
  /^create a number of 1\/1 black vampire knight creature tokens with lifelink equal to the highest life total among all players\.?$/i;

const DEALS_DAMAGE_EQUAL_TO_TWICE_THE_NUMBER_OF_WARRIORS_AND_EQUIPMENT_YOU_CONTROL_TO_TARGET_PLAYER_OR_PLANESWALKER_REGEX =
  /^[a-z0-9 ,'-]+ deals damage(?: to target (?:creature|player) or planeswalker)? equal to twice the number of warriors and equipment you control(?: to target (?:creature|player) or planeswalker)?\.?$/i;

const RETURN_ALL_NONLAND_PERMANENT_CARDS_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX =
  /^return all nonland permanent cards with mana value (\d+) or less from your graveyard to the battlefield\.?$/i;

const EXILE_TARGET_NONLAND_PERMANENT_CARD_WITH_MANA_VALUE_X_FROM_YOUR_GRAVEYARD_CREATE_TOKEN_COPY_REGEX =
  /^exile target nonland permanent card with mana value x from your graveyard\. create a token that['’]s a copy of that card\.?$/i;

const CREATE_X_2_2_WHITE_CAT_TOKENS_WHERE_X_IS_YOUR_LIFE_TOTAL_REGEX =
  /^create x 2\/2 white cat creature tokens, where x is your life total\.?$/i;

const DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_AND_PLANESWALKER_THEY_CONTROL_REGEX =
  /^[a-z0-9 ,'-]+ deals (\d+) damage to target player and each creature and planeswalker they control\.?$/i;

const EACH_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_EACH_OPPONENT_REGEX =
  /^each creature you control deals damage equal to its power to each opponent\.?$/i;

const DEALS_N_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_N_LIFE_REGEX =
  /^([a-z0-9 ,'-]+) deals (\d+) damage to any target\. you gain \2 life\.?$/i;

const EXILE_THIS_PLANESWALKER_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL_REGEX =
  /^exile [a-z0-9 ,'-]+ and each creature your opponents control\.?$/i;

const CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_LIFELINK_UNTIL_YOUR_NEXT_TURN_REGEX =
  /^until your next turn, creatures you control get ([+-]\d+)\/([+-]\d+) and gain lifelink\.?$/i;

const YOU_GET_EMBLEM_THEN_CREATE_TOKEN_BASIC_REGEX =
  /^you get an emblem with,?\s+"([\s\S]+)"(?:\s*\([^)]*\))*\.?\s*then create (a|an|one|two|three|four|five|\d+) (tapped )?(\d+)\/(\d+) ([^\.]+?) tokens?(?: with ([\s\S]+?))?\.?$/i;

const CREATE_INSECT_TOKEN_THEN_MILL_REPEAT_IF_INSECT_MILLED_REGEX =
  /^create a 1\/1 black and green insect creature token, then mill a card\. if an insect card was milled this way, put a loyalty counter on [a-z0-9 ,'-]+ and repeat this process\.?$/i;

const EXILE_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_RETURN_AT_BEGINNING_OF_THAT_PLAYERS_NEXT_END_STEP_REGEX =
  /^exile up to one target artifact or creature\. return that card to the battlefield under its owner's control at the beginning of that player's next end step\.?$/i;

const EXILE_TARGET_CREATURE_YOU_CONTROL_FOR_EACH_OTHER_PLAYER_EXILE_UP_TO_ONE_TARGET_CREATURE_THAT_PLAYER_CONTROLS_REGEX =
  /^exile target creature you control\. for each other player, exile up to one target creature that player controls\.?$/i;

const EXILE_ANOTHER_TARGET_PERMANENT_YOU_OWN_THEN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_REGEX =
  /^exile another target permanent you own, then return it to the battlefield under your control\.?$/i;

const EXILE_TARGET_PERMANENT_YOU_OWN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP_REGEX =
  /^exile target permanent you own\. return it to the battlefield under your control at the beginning of the next end step\.?$/i;

const EXILE_ALL_OTHER_PERMANENTS_REGEX =
  /^exile all other permanents\.?$/i;

const TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_N_N_REGEX =
  /^target artifact becomes an artifact creature with base power and toughness (\d+)\/(\d+)\.?$/i;

const TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_IF_IT_ISNT_A_VEHICLE_IT_HAS_BASE_POWER_AND_TOUGHNESS_N_N_REGEX =
  /^target artifact becomes an artifact creature\.\s*if it isn't a vehicle, it has base power and toughness (\d+)\/(\d+)\.?$/i;

const TARGET_CREATURE_WITHOUT_FIRST_STRIKE_DOUBLE_STRIKE_OR_VIGILANCE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN_REGEX =
  /^target creature without first strike, double strike, or vigilance (?:can't|cannot) attack or block until your next turn\.?$/i;

const UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS2_MINUS0_AND_LOSES_FLYING_REGEX =
  /^until your next turn, up to one target creature gets -2\/-0 and loses flying\.?$/i;

const UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS3_MINUS0_AND_ITS_ACTIVATED_ABILITIES_CANT_BE_ACTIVATED_REGEX =
  /^until your next turn, up to one target creature gets -3\/-0 and its activated abilities can't be activated\.?$/i;

const WHENEVER_A_CREATURE_ATTACKS_THIS_TURN_PUT_A_P1P1_COUNTER_ON_IT_REGEX =
  /^whenever a creature attacks this turn, put a \+1\/\+1 counter on it\.?$/i;

const UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_DEALS_COMBAT_DAMAGE_TO_VRASKA_DESTROY_THAT_CREATURE_REGEX =
  /^until your next turn, whenever a creature deals combat damage to vraska, destroy that creature\.?$/i;

const RESTART_THE_GAME_LEAVING_IN_EXILE_ALL_NON_AURA_PERMANENT_CARDS_EXILED_WITH_SOURCE_THEN_PUT_THOSE_CARDS_ONTO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_REGEX =
  /^restart the game, leaving in exile all non-aura permanent cards exiled with [a-z0-9 ,'-]+\. then put those cards onto the battlefield under your control\.?$/i;

const TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1_REGEX =
  /^target creature you control gains deathtouch and lifelink until end of turn\.\s*if it's a vampire, put a \+1\/\+1 counter on it\.?$/i;

const REVEAL_CARDS_UNTIL_CREATURE_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^reveal cards from the top of your library until you reveal a creature card\.\s*put that card into your hand and the rest on the bottom of your library in a random order\.?$/i;

const DRAW_AND_LOSE_LIFE_SELF_REGEX =
  /^you draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) card and (?:you )?lose (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.(?:\s*proliferate\.)?$/i;

const LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_BOTTOM_REGEX =
  /^look at the top two cards of your library\. put one of them into your hand and the other on the bottom of your library\.?$/i;

const LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_INTO_GRAVEYARD_REGEX =
  /^look at the top two cards of your library\. put one of them into your hand and the other into your graveyard\.?$/i;

const LOOK_AT_TOP_N_PUT_ONE_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put one of them into your hand and the rest on the bottom of your library in any order\.?$/i;

const LOOK_AT_TOP_N_PUT_K_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put (one|two|three|four|five|six|seven|eight|nine|ten|\d+) of them into your hand and the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_NONCREATURE_NONLAND_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal a noncreature, nonland card from among them and put it into your hand\.\s*put the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ENCHANTMENT_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may reveal an? enchantment card from among them and put (?:it|that card) into your hand\.\s*put the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REST_BOTTOM_RANDOM_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.\s*you may put any number of creature and\/or land cards from among them onto the battlefield\.\s*put the rest on the bottom of your library in a random order\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ARTIFACT_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? artifact card from among them and put it into your hand\. put the rest on the bottom of your library in any order\.?$/i;

const LOOK_AT_TOP_TWO_EXILE_ONE_PUT_OTHER_INTO_HAND_REGEX =
  /^look at the top two cards of your library\. exile one of them and put the other into your hand\.?$/i;

const LOOK_AT_TOP_N_EXILE_ONE_FACE_DOWN_REST_BOTTOM_ANY_ORDER_YOU_MAY_CAST_IT_IF_CREATURE_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. exile one face down and put the rest on the bottom of your library in any order\. for as long as it remains exiled, you may cast it if it(?:'|’)s a creature spell\.?$/i;

const LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_AURA_CREATURE_OR_PLANESWALKER_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX =
  /^look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal an? aura, creature, or planeswalker card from among them and put it into your hand\. put the rest on the bottom of your library in any order\.?$/i;

const LOOK_AT_TOP_TWO_PUT_ONE_INTO_GRAVEYARD_REGEX =
  /^look at the top two cards of your library\. put one of them into your graveyard\.?$/i;

const REVEAL_TOP_N_PUT_ALL_CREATURE_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX =
  /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put all creature cards revealed this way into your hand and the rest on the bottom of your library in any order\.?$/i;

const REVEAL_TOP_N_PUT_ALL_NONLAND_PERMANENT_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX =
  /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. put all nonland permanent cards revealed this way into your hand and the rest on the bottom of your library in any order\.?$/i;

const REVEAL_TOP_THREE_OPPONENT_SEPARATES_INTO_TWO_PILES_PUT_ONE_INTO_HAND_OTHER_BOTTOM_ANY_ORDER_REGEX =
  /^reveal the top three cards of your library\.\s*an opponent separates those cards into two piles\.\s*put one pile into your hand and the other on the bottom of your library in any order\.?$/i;

const SEPARATE_ALL_PERMANENTS_TARGET_PLAYER_CONTROLS_INTO_TWO_PILES_THAT_PLAYER_SACRIFICES_PILE_OF_THEIR_CHOICE_REGEX =
  /^separate all permanents target player controls into two piles\.\s*that player sacrifices all permanents in the pile of their choice\.?$/i;

const YOU_MAY_DISCARD_A_CARD_IF_YOU_DO_DRAW_A_CARD_REGEX =
  /^you may discard a card\. if you do, draw a card\.?$/i;

const DRAW_A_CARD_THEN_DISCARD_A_CARD_REGEX = /^draw a card, then discard a card\.?$/i;
const DRAW_TWO_CARDS_THEN_DISCARD_A_CARD_REGEX = /^draw two cards, then discard a card\.?$/i;

const DRAW_A_CARD_YOU_MAY_PLAY_AN_ADDITIONAL_LAND_THIS_TURN_REGEX =
  /^draw a card\. you may play an additional land this turn\.?$/i;

const TARGET_PLAYER_DISCARDS_A_CARD_REGEX =
  /^target player discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i;

const TARGET_PLAYER_DRAWS_N_CARDS_REGEX =
  /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i;

export {
  DRAW_SELF_REGEXES,
  DRAW_N_CARDS_YOU_GET_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX,
  RETURN_TARGET_CREATURE_TO_OWNERS_HAND_REGEX,
  RETURN_UP_TO_ONE_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_TO_OWNERS_HAND_DRAW_A_CARD_REGEX,
  EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_PLAY_IT_THIS_TURN_REGEX,
  EXILE_TOP_CARD_OF_YOUR_LIBRARY_IF_ITS_RED_YOU_MAY_CAST_IT_THIS_TURN_REGEX,
  EXILE_TOP_N_CARDS_OF_YOUR_LIBRARY_YOU_MAY_PLAY_THEM_THIS_TURN_REGEX,
  EXILE_TOP_TWO_CARDS_OF_YOUR_LIBRARY_CHOOSE_ONE_YOU_MAY_PLAY_IT_THIS_TURN_REGEX,
  EXILE_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REGEX,
  EXILE_TOP_N_PUT_ALL_ARTIFACT_CARDS_ONTO_BATTLEFIELD_REGEX,
  EXILE_TOP_N_CREATURE_CARDS_GAIN_CAST_FROM_EXILE_WHILE_YOU_CONTROL_A_LUKKA_PLANESWALKER_REGEX,
  EXILE_TARGET_CREATURE_YOU_CONTROL_REVEAL_UNTIL_CREATURE_GREATER_MV_PUT_BATTLEFIELD_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_SEVEN_MAY_PUT_PERMANENT_MV3_OR_LESS_ONTO_BATTLEFIELD_WITH_SHIELD_COUNTER_REST_BOTTOM_RANDOM_REGEX,
  DRAW_TWO_CARDS_THEN_DISCARD_TWO_UNLESS_DISCARD_AN_ARTIFACT_CARD_REGEX,
  EACH_PLAYER_SACRIFICES_TWO_CREATURES_REGEX,
  DRAW_A_CARD_THEN_ADD_ONE_MANA_OF_ANY_COLOR_REGEX,
  DRAW_A_CARD_THEN_SCRY_N_REGEX,
  DRAW_A_CARD_THEN_DISCARD_A_CARD_AT_RANDOM_REGEX,
  DRAW_A_CARD_TARGET_PLAYER_MILLS_A_CARD_REGEX,
  DRAW_A_CARD_EACH_PLAYER_MILLS_TWO_CARDS_REGEX,
  DRAW_N_CARDS_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_THE_BOTTOM_OF_YOUR_LIBRARY_REGEX,
  DRAW_A_CARD_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_TOP_OF_YOUR_LIBRARY_REGEX,
  DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX,
  DISCARD_YOUR_HAND_THEN_DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX,
  DISCARD_YOUR_HAND_THEN_EXILE_TOP_THREE_CARDS_OF_YOUR_LIBRARY_UNTIL_END_OF_TURN_YOU_MAY_PLAY_CARDS_EXILED_THIS_WAY_REGEX,
  YOU_GAIN_LIFE_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX,
  EACH_PLAYER_DISCARDS_THEIR_HAND_THEN_DRAWS_THREE_CARDS_REGEX,
  EACH_PLAYER_DRAWS_A_CARD_REGEX,
  REVEAL_CARDS_UNTIL_ARTIFACT_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  EACH_PLAYER_SHUFFLES_HAND_AND_GRAVEYARD_INTO_LIBRARY_YOU_DRAW_SEVEN_REGEX,
  RETURN_UP_TO_TWO_TARGET_LAND_CARDS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX,
  DISCARD_A_CARD_THEN_DRAW_A_CARD_IF_LAND_DISCARDED_DRAW_AN_ADDITIONAL_CARD_REGEX,
  DISCARD_A_CARD_THEN_DRAW_A_CARD_REGEX,
  ATTACH_THIS_EQUIPMENT_TO_UP_TO_ONE_TARGET_CREATURE_YOU_CONTROL_REGEX,
  IF_TARGET_PLAYER_HAS_FEWER_THAN_NINE_POISON_COUNTERS_THEY_GET_DIFFERENCE_REGEX,
  CREATE_X_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_WHERE_X_IS_HIGHEST_LIFE_TOTAL_REGEX,
  CREATE_A_NUMBER_OF_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_EQUAL_TO_HIGHEST_LIFE_TOTAL_REGEX,
  DEALS_DAMAGE_EQUAL_TO_TWICE_THE_NUMBER_OF_WARRIORS_AND_EQUIPMENT_YOU_CONTROL_TO_TARGET_PLAYER_OR_PLANESWALKER_REGEX,
  RETURN_ALL_NONLAND_PERMANENT_CARDS_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX,
  EXILE_TARGET_NONLAND_PERMANENT_CARD_WITH_MANA_VALUE_X_FROM_YOUR_GRAVEYARD_CREATE_TOKEN_COPY_REGEX,
  CREATE_X_2_2_WHITE_CAT_TOKENS_WHERE_X_IS_YOUR_LIFE_TOTAL_REGEX,
  DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_AND_PLANESWALKER_THEY_CONTROL_REGEX,
  EACH_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_EACH_OPPONENT_REGEX,
  DEALS_N_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_N_LIFE_REGEX,
  EXILE_THIS_PLANESWALKER_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL_REGEX,
  CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_LIFELINK_UNTIL_YOUR_NEXT_TURN_REGEX,
  YOU_GET_EMBLEM_THEN_CREATE_TOKEN_BASIC_REGEX,
  CREATE_INSECT_TOKEN_THEN_MILL_REPEAT_IF_INSECT_MILLED_REGEX,
  EXILE_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_RETURN_AT_BEGINNING_OF_THAT_PLAYERS_NEXT_END_STEP_REGEX,
  EXILE_TARGET_CREATURE_YOU_CONTROL_FOR_EACH_OTHER_PLAYER_EXILE_UP_TO_ONE_TARGET_CREATURE_THAT_PLAYER_CONTROLS_REGEX,
  EXILE_ANOTHER_TARGET_PERMANENT_YOU_OWN_THEN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_REGEX,
  EXILE_TARGET_PERMANENT_YOU_OWN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP_REGEX,
  EXILE_ALL_OTHER_PERMANENTS_REGEX,
  TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_N_N_REGEX,
  TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_IF_IT_ISNT_A_VEHICLE_IT_HAS_BASE_POWER_AND_TOUGHNESS_N_N_REGEX,
  TARGET_CREATURE_WITHOUT_FIRST_STRIKE_DOUBLE_STRIKE_OR_VIGILANCE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN_REGEX,
  UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS2_MINUS0_AND_LOSES_FLYING_REGEX,
  UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS3_MINUS0_AND_ITS_ACTIVATED_ABILITIES_CANT_BE_ACTIVATED_REGEX,
  WHENEVER_A_CREATURE_ATTACKS_THIS_TURN_PUT_A_P1P1_COUNTER_ON_IT_REGEX,
  UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_DEALS_COMBAT_DAMAGE_TO_VRASKA_DESTROY_THAT_CREATURE_REGEX,
  RESTART_THE_GAME_LEAVING_IN_EXILE_ALL_NON_AURA_PERMANENT_CARDS_EXILED_WITH_SOURCE_THEN_PUT_THOSE_CARDS_ONTO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_REGEX,
  TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1_REGEX,
  REVEAL_CARDS_UNTIL_CREATURE_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  DRAW_AND_LOSE_LIFE_SELF_REGEX,
  LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_BOTTOM_REGEX,
  LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_INTO_GRAVEYARD_REGEX,
  LOOK_AT_TOP_N_PUT_ONE_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX,
  LOOK_AT_TOP_N_PUT_K_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_NONCREATURE_NONLAND_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ENCHANTMENT_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REST_BOTTOM_RANDOM_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ARTIFACT_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX,
  LOOK_AT_TOP_TWO_EXILE_ONE_PUT_OTHER_INTO_HAND_REGEX,
  LOOK_AT_TOP_N_EXILE_ONE_FACE_DOWN_REST_BOTTOM_ANY_ORDER_YOU_MAY_CAST_IT_IF_CREATURE_REGEX,
  LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_AURA_CREATURE_OR_PLANESWALKER_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX,
  LOOK_AT_TOP_TWO_PUT_ONE_INTO_GRAVEYARD_REGEX,
  REVEAL_TOP_N_PUT_ALL_CREATURE_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX,
  REVEAL_TOP_N_PUT_ALL_NONLAND_PERMANENT_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX,
  REVEAL_TOP_THREE_OPPONENT_SEPARATES_INTO_TWO_PILES_PUT_ONE_INTO_HAND_OTHER_BOTTOM_ANY_ORDER_REGEX,
  SEPARATE_ALL_PERMANENTS_TARGET_PLAYER_CONTROLS_INTO_TWO_PILES_THAT_PLAYER_SACRIFICES_PILE_OF_THEIR_CHOICE_REGEX,
  YOU_MAY_DISCARD_A_CARD_IF_YOU_DO_DRAW_A_CARD_REGEX,
  DRAW_A_CARD_THEN_DISCARD_A_CARD_REGEX,
  DRAW_TWO_CARDS_THEN_DISCARD_A_CARD_REGEX,
  DRAW_A_CARD_YOU_MAY_PLAY_AN_ADDITIONAL_LAND_THIS_TURN_REGEX,
  TARGET_PLAYER_DISCARDS_A_CARD_REGEX,
  TARGET_PLAYER_DRAWS_N_CARDS_REGEX,
};
