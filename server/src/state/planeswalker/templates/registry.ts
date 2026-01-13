import type { PlaneswalkerTemplateMatch } from "./types.js";
import { normalizeOracleEffectText } from "./utils.js";

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

const UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_REGEX =
  /^until end of turn, creatures you control get ([+-]\d+)\/([+-]\d+) and gain flying\.?$/i;

const CREATURES_YOU_CONTROL_GET_PT_EOT_REGEX =
  /^creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i;

const CREATURES_YOU_CONTROL_WITH_FLYING_GET_PT_EOT_REGEX =
  /^creatures you control with flying get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i;

const UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_REGEX =
  /^until end of turn, creatures you control get ([+-]\d+)\/([+-]\d+)\.?$/i;

const SUBTYPE_YOU_CONTROL_GET_PT_EOT_REGEX =
  /^([a-z]+)s you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i;

const UNTAP_UP_TO_N_TARGET_PERMANENTS_REGEX =
  /^untap up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) target permanents?\.?$/i;

const UNTAP_TWO_TARGET_LANDS_REGEX = /^untap two target lands\.?$/i;

const UP_TO_ONE_TARGET_CREATURE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN_REGEX =
  /^up to one target creature (?:can't|cannot) attack or block until your next turn\.?$/i;

const EACH_OPPONENT_DISCARDS_N_AND_LOSES_M_LIFE_REGEX =
  /^each opponent discards (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? and loses (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i;

const PUT_P1P1_ON_UP_TO_ONE_TARGET_SUBTYPE_YOU_CONTROL_REGEX =
  /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on up to one target ([a-z]+) you control\.?$/i;

const TAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_FREEZE_REGEX =
  /^tap up to one target artifact or creature\. it doesn't untap during its controller's next untap step\.?$/i;

const TAP_TARGET_CREATURE_OR_PERMANENT_FREEZE_REGEX =
  /^tap target (?:creature|permanent)\. it doesn't untap during its controller's next untap step\.?$/i;

const TAP_UP_TO_TWO_TARGET_NONLAND_PERMANENTS_FREEZE_REGEX =
  /^tap up to two target nonland permanents?\. they don't untap during their controller's next untap step\.?$/i;

const TAP_TARGET_CREATURE_PUT_TWO_STUN_COUNTERS_REGEX = /^tap target creature\. put two stun counters on it\.?$/i;

const TAP_TARGET_PERMANENT_THEN_UNTAP_ANOTHER_TARGET_PERMANENT_REGEX =
  /^tap target permanent, then untap another target permanent\.?$/i;

// Unmatched create-token loyalty lines (special-case templates)
const CREATE_GREEN_TREEFOLK_TOKEN_REACH_PT_EQUALS_LANDS_YOU_CONTROL_REGEX =
  /^create a green treefolk creature token with reach and "this token(?:'|’)s power and toughness are each equal to the number of lands you control\."\.?$/i;

const CREATE_BLUE_DOG_ILLUSION_TOKEN_PT_EQUALS_TWICE_CARDS_IN_HAND_REGEX =
  /^create a blue dog illusion creature token with "this token(?:'|’)s power and toughness are each equal to twice the number of cards in your hand\."\.?$/i;

const CREATE_WHITE_AVATAR_TOKEN_PT_EQUALS_YOUR_LIFE_TOTAL_REGEX =
  /^create a white avatar creature token\. it has "this token(?:'|’)s power and toughness are each equal to your life total\."\.?$/i;

const CREATE_MASK_AURA_TOKEN_ATTACHED_TO_TARGET_PERMANENT_REGEX =
  /^create a white aura enchantment token named mask attached to another target permanent\. the token has enchant permanent and umbra armor\.?$/i;

const CREATE_STONEFORGED_BLADE_EQUIPMENT_TOKEN_REGEX =
  /^create a colorless equipment artifact token named stoneforged blade\. it has indestructible, "equipped creature gets \+5\/\+5 and has double strike," and equip \{0\}\.?$/i;

const CREATE_TWO_NONLEGENDARY_TOKEN_COPIES_OF_SOURCE_PLANESWALKER_REGEX =
  /^create two tokens that are copies of jace, except they(?:'|’)re not legendary\.?$/i;

// Covers common "create/put N P/T <descriptor> (creature) token(s) (with ...) (onto the battlefield)" patterns.
// Note: more specific token templates should be checked before this one.
const CREATE_TOKEN_BASIC_REGEX =
  /^(?:create|put) (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (?:tapped )?(\d+)\/(\d+) ([^\.]+?) (?:creature\s+)?tokens?(?: with[\s\S]+?)?(?:\s+onto the battlefield)?\.?$/i;

const CREATE_2_2_BLACK_ZOMBIE_TOKEN_MILL_TWO_REGEX =
  /^create a 2\/2 black zombie creature token\.\s*mill two cards\.?$/i;

const CREATE_2_2_BLUE_WIZARD_TOKEN_DRAW_THEN_DISCARD_REGEX =
  /^create a 2\/2 blue wizard creature token\.\s*draw a card, then discard a card\.?$/i;

const CREATE_1_1_HUMAN_WIZARD_TOKEN_ALL_COLORS_REGEX =
  /^create a 1\/1 human wizard creature token that(?:'|’)s all colors\.?$/i;

const CREATE_1_1_WHITE_KOR_SOLDIER_TOKEN_MAY_ATTACH_EQUIPMENT_REGEX =
  /^create a 1\/1 white kor soldier creature token\.\s*you may attach an equipment you control to it\.?$/i;

const CREATE_X_1_1_RED_DEVIL_TOKENS_WHEN_DIES_DEAL_1_DAMAGE_REGEX =
  /^create x 1\/1 red devil creature tokens? with\s+"when this creature dies, it deals 1 damage to any target\."\.?$/i;

const CREATE_X_X_GREEN_PHYREXIAN_HORROR_TOKEN_WHERE_X_IS_SOURCE_LOYALTY_REGEX =
  /^create an x\/x green phyrexian horror creature token, where x is [a-z0-9 ,'-]+(?:'|’)s loyalty\.?$/i;

const CREATE_TOKEN_COPY_TARGET_CREATURE_EXCEPT_HASTE_SAC_AT_END_STEP_REGEX =
  /^create a token that['’]s a copy of target creature you control, except it has haste and\s+"at the beginning of the end step, sacrifice this token\."\.?$/i;

const HEAD_TO_ASKURZA_COM_AND_CLICK_N_REGEX = /^head to askurza\.com and click ([+-]\d+)\.?$/i;

const ACCEPT_ONE_OF_DAVRIELS_OFFERS_THEN_ACCEPT_ONE_OF_DAVRIELS_CONDITIONS_REGEX =
  /^accept one of davriel's offers, then accept one of davriel's conditions\.?$/i;

const CHOOSE_LEFT_OR_RIGHT_UNTIL_YOUR_NEXT_TURN_ATTACK_NEAREST_OPPONENT_REGEX =
  /^choose left or right\. until your next turn, each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent\.?$/i;

const CHOOSE_LEFT_OR_RIGHT_EACH_PLAYER_GAINS_CONTROL_NONLAND_PERMANENTS_REGEX =
  /^choose left or right\. each player gains control of all nonland permanents other than [a-z0-9 ,'-]+ controlled by the next player in the chosen direction\.?$/i;

const TARGET_CREATURE_AN_OPPONENT_CONTROLS_PERPETUALLY_GETS_MINUS3_MINUS3_REGEX =
  /^target creature an opponent controls perpetually gets -3\/-3\.?$/i;

const UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1_REGEX =
  /^untap up to one target elf\. that elf and a random elf creature card in your hand perpetually get \+1\/\+1\.?$/i;

const SEEK_AN_ELF_CARD_REGEX = /^seek an elf card\.?$/i;

const CONJURE_A_CARD_NAMED_ONTO_THE_BATTLEFIELD_REGEX =
  /^conjure a card named ([^\.]+?) onto the battlefield\.?$/i;

const CONJURE_A_CARD_NAMED_INTO_YOUR_HAND_REGEX =
  /^conjure a card named ([^\.]+?) into your hand\.?$/i;

const DRAFT_A_CARD_FROM_SPELLBOOK_AND_PUT_IT_ONTO_THE_BATTLEFIELD_REGEX =
  /^draft a card from [a-z0-9 ,'-]+(?:'|’)s spellbook and put it onto the battlefield\.?$/i;

const ADD_RR_DRAFT_A_CARD_FROM_SPELLBOOK_THEN_EXILE_YOU_MAY_CAST_IT_THIS_TURN_REGEX =
  /^add \{r\}\{r\}\. draft a card from [a-z0-9 ,'-]+(?:'|’)s spellbook, then exile it\. until end of turn, you may cast that card\.?$/i;

const ROLL_A_D20_SKIP_NEXT_TURN_OR_DRAW_A_CARD_REGEX =
  /^roll a d20\. if you roll a 1, skip your next turn\. if you roll a 12 or higher, draw a card\.?$/i;

const OPEN_SEALED_KAMIGAWA_BOOSTER_PACK_AND_DRAFT_TWO_REGEX =
  /^open up to one sealed kamigawa booster pack and shuffle those cards into your booster pile\. look at the top four cards of your booster pile\. put two of those cards into your hand and the rest into your graveyard\.?$/i;

const CHOOSE_CREATURE_CARD_IN_HAND_PERPETUALLY_GETS_P1P1_AND_COSTS_1_LESS_REGEX =
  /^choose a creature card in your hand\. it perpetually gets \+1\/\+1 and perpetually gains "this spell costs \{1\} less to cast\."\.?$/i;

const DRAGON_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X_REGEX =
  /^dragon cards in your hand perpetually gain "this spell costs \{1\} less to cast," and "you may pay \{x\} rather than pay this spell(?:'|’)s mana cost, where x is its mana value\."\.?$/i;

const UP_TO_ONE_TARGET_CREATURE_BASE_POWER_PERPETUALLY_BECOMES_TOUGHNESS_AND_GAINS_ATTACK_NO_DEFENDER_REGEX =
  /^up to one target creature(?:'|’)s base power perpetually becomes equal to its toughness\. it perpetually gains "this creature can attack as though it didn(?:'|’)t have defender\."\.?$/i;

const CREATE_3_3_GREEN_BEAST_TOKEN_THEN_IF_OPPONENT_CONTROLS_MORE_CREATURES_PUT_LOYALTY_COUNTER_ON_SOURCE_REGEX =
  /^create a 3\/3 green beast creature token\.\s*then if an opponent controls more creatures than you, put a loyalty counter on [a-z0-9 ,'-]+\.?$/i;

const CREATE_3_3_GREEN_BEAST_TOKEN_CHOOSE_VIGILANCE_REACH_TRAMPLE_COUNTER_REGEX =
  /^create a 3\/3 green beast creature token\.\s*put your choice of a vigilance counter, a reach counter, or a trample counter on it\.?$/i;

const CREATE_NAMED_TOKEN_WITH_ABILITIES_REGEX =
  /^(?:create\s+(?:a|an|one|two|three|four|five|\d+)?\s*(?:tapped\s+)?([^,]+),\s*a\s+(.+?)\s+token(?:\s+with\s+"[\s\S]+")?\.?|create\s+(?:a|an|one|two|three|four|five|\d+)?\s*(?:tapped\s+)?(?:colorless\s+)?(.+?)\s+token\s+named\s+([^\.]+?)(?:\s+with\s+"[\s\S]+")?\.?)$/i;

const REVEAL_TOP_TWO_OPPONENT_CHOSES_ONE_HAND_EXILE_SILVER_REGEX =
  /^reveal the top two cards of your library\. an opponent chooses one of them\. put that card into your hand and exile the other with a silver counter on it\.?$/i;

const PUT_A_CARD_YOU_OWN_WITH_A_SILVER_COUNTER_ON_IT_FROM_EXILE_INTO_YOUR_HAND_REGEX =
  /^put a card you own with a silver counter on it from exile into your hand\.?$/i;

const YOU_MAY_PUT_A_SUBTYPE_CREATURE_CARD_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD_REGEX =
  /^you may put a ([a-z][a-z-]*) creature card with mana value (\d+) or less from your hand onto the battlefield\.?$/i;

const YOU_MAY_PUT_A_COLOR_OR_SUBTYPE_CREATURE_CARD_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD_REGEX =
  /^you may put a ([a-z][a-z-]*) creature card from your hand onto the battlefield\.?$/i;

const YOU_MAY_PUT_AN_ARTIFACT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_REGEX =
  /^you may put an artifact card from your hand or graveyard onto the battlefield\.?$/i;

const YOU_MAY_PUT_AN_EQUIPMENT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_REGEX =
  /^you may put an equipment card from your hand or graveyard onto the battlefield\.?$/i;

const YOU_MAY_PUT_A_CREATURE_CARD_WITH_MANA_VALUE_LESS_THAN_OR_EQUAL_TO_LANDS_YOU_CONTROL_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_WITH_TWO_P1P1_COUNTERS_REGEX =
  /^you may put a creature card with mana value less than or equal to the number of lands you control onto the battlefield from your hand or graveyard with two \+1\/\+1 counters on it\.?$/i;

const YOU_GAIN_N_LIFE_FOR_EACH_SUBTYPE_YOU_CONTROL_REGEX =
  /^you gain (\d+) life for each ([a-z][a-z-]*) you control\.?$/i;

const YOU_MAY_SACRIFICE_ANOTHER_PERMANENT_IF_YOU_DO_GAIN_LIFE_AND_DRAW_A_CARD_REGEX =
  /^you may sacrifice another permanent\. if you do, you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life and draw a card\.?$/i;

const YOU_GAIN_LIFE_THEN_PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_CREATURE_REGEX =
  /^you gain (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.\s*put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on up to one target creature\.?$/i;

const EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_REGEX =
  /^exile target creature\. its controller gains (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i;

const EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_EQUAL_TO_ITS_POWER_REGEX =
  /^exile target creature\. its controller gains life equal to its power\.?$/i;

const DESTROY_TARGET_CREATURE_ITS_CONTROLLER_DRAWS_N_CARDS_REGEX =
  /^destroy target creature\. its controller draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+) cards?\.?$/i;

const CREATURES_YOU_CONTROL_GAIN_FLYING_AND_DOUBLE_STRIKE_EOT_REGEX =
  /^creatures you control gain flying and double strike until end of turn\.?$/i;

const UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GAINS_VIGILANCE_AND_REACH_REGEX =
  /^until your next turn, up to one target creature gains vigilance and reach\.?$/i;

const PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_SUBTYPE_UNTAP_IT_IT_GAINS_DEATHTOUCH_EOT_REGEX =
  /^put a \+1\/\+1 counter on up to one target ([a-z][a-z-]*)\. untap it\. it gains deathtouch until end of turn\.?$/i;

const PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING_REGEX =
  /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on target creature\. it becomes an angel in addition to its other types and gains flying\.?$/i;

const PUT_P1P1_COUNTER_ON_EACH_CREATURE_YOU_CONTROL_REGEX =
  /^put a \+1\/\+1 counter on each creature you control(?:\. those creatures gain vigilance until end of turn)?\.?$/i;

const PUT_MINUS1_MINUS1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_REGEX = /^put a -1\/-1 counter on up to one target creature\.?$/i;

const PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_MENACE_EOT_REGEX =
  /^put a \+1\/\+1 counter on up to one target creature\. that creature gains menace until end of turn\.?$/i;

const PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_INDESTRUCTIBLE_EOT_REGEX =
  /^put a \+1\/\+1 counter on up to one target creature\. it gains indestructible until end of turn\.?$/i;

const PUT_A_LOYALTY_COUNTER_ON_EACH_COLOR_PLANESWALKER_YOU_CONTROL_REGEX =
  /^put a loyalty counter on each (white|blue|black|red|green) planeswalker you control\.?$/i;

const PUT_N_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_AND_N_LOYALTY_COUNTERS_ON_EACH_OTHER_PLANESWALKER_YOU_CONTROL_REGEX =
  /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on each creature you control and (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) loyalty counters? on each other planeswalker you control\.?$/i;

const PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_YOU_CONTROL_REGEX =
  /^put a loyalty counter on [a-z0-9 ,'-]+ for each creature you control\.?$/i;

const PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_TARGET_OPPONENT_CONTROLS_REGEX =
  /^put a loyalty counter on [a-z0-9 ,'-]+ for each creature target opponent controls\.?$/i;

const EACH_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_CREATURE_CARDS_IN_YOUR_GRAVEYARD_REGEX =
  /^each opponent loses life equal to the number of creature cards in your graveyard\.?$/i;

const EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_CAST_THAT_CARD_IF_YOU_DONT_DEALS_DAMAGE_TO_EACH_OPPONENT_REGEX =
  /^exile the top card of your library\. you may cast that card\. if you don't, ([a-z0-9 ,'-]+) deals (\d+) damage to each opponent\.?$/i;

const ADD_RESTRICTED_MANA_SPEND_ONLY_REGEX =
  /^add (\{[WUBRGC]\}(?:\{[WUBRGC]\})*)\.\s*spend this mana only to (?:cast )?([^\.]+?)\.?$/i;

const ADD_TWO_MANA_ANY_COMBINATION_SPEND_ONLY_DRAGONS_REGEX =
  /^add two mana in any combination of colors\.?\s*spend this mana only to cast dragon spells\.?$/i;

const ADD_TWO_MANA_ANY_COMBINATION_REGEX = /^add two mana in any combination of colors\.?$/i;

const ADD_TEN_MANA_ANY_ONE_COLOR_REGEX = /^add ten mana of any one color\.?$/i;

const ADD_MANA_SYMBOL_FOR_EACH_PLANESWALKER_YOU_CONTROL_REGEX =
  /^add (\{[WUBRGC]\}) for each planeswalker you control\.?$/i;

const ADD_MANA_SYMBOL_FOR_EACH_BASIC_LAND_TYPE_YOU_CONTROL_REGEX =
  /^add (\{[WUBRGC]\}) for each (plains|island|swamp|mountain|forest) you control\.?$/i;

const PAY_ANY_AMOUNT_LOOK_AT_THAT_MANY_PUT_ONE_HAND_REST_BOTTOM_RANDOM_REGEX =
  /^pay any amount of mana\.\s*look at that many cards from the top of your library,?\s*(?:then\s+)?put one of (?:those cards|them) into your hand and the rest on the bottom of your library in a random order\.?$/i;

const CAST_SORCERY_SPELLS_AS_THOUGH_THEY_HAD_FLASH_UNTIL_YOUR_NEXT_TURN_REGEX =
  /^until your next turn, you may cast sorcery spells as though they had flash\.?$/i;

const PREVENT_ALL_DAMAGE_TO_AND_DEALT_BY_TARGET_OPPONENT_PERMANENT_UNTIL_YOUR_NEXT_TURN_REGEX =
  /^until your next turn, prevent all damage that would be dealt to and dealt by target permanent an opponent controls\.?$/i;

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

export function getPlaneswalkerTemplateMatch(
  effectText: string,
  options?: {
    /**
     * When true, return a catch-all match for any remaining loyalty line.
     * Keep this disabled for gameplay to avoid shadowing legacy handlers.
     */
    allowFallback?: boolean;
  }
): PlaneswalkerTemplateMatch | null {
  const text = normalizeOracleEffectText(effectText);

  // Must be checked before DRAW_SELF_REGEXES, since this effect begins with "Draw N cards.".
  if (DRAW_N_CARDS_YOU_GET_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX.test(text)) {
    return { id: "DRAW_N_CARDS_YOU_GET_AN_EMBLEM_WITH_QUOTED_TEXT", matchedText: text };
  }

  for (const rx of DRAW_SELF_REGEXES) {
    if (rx.test(text)) return { id: "DRAW_CARDS_SELF", matchedText: text };
  }

  if (RETURN_UP_TO_ONE_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_TO_OWNERS_HAND_DRAW_A_CARD_REGEX.test(text)) {
    return {
      id: "RETURN_UP_TO_ONE_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_TO_OWNERS_HAND_DRAW_A_CARD",
      matchedText: text,
    };
  }

  if (RETURN_TARGET_CREATURE_TO_OWNERS_HAND_REGEX.test(text)) {
    return { id: "RETURN_TARGET_CREATURE_TO_OWNERS_HAND", matchedText: text };
  }

  if (EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_PLAY_IT_THIS_TURN_REGEX.test(text)) {
    return { id: "EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_PLAY_IT_THIS_TURN", matchedText: text };
  }

  if (EXILE_TOP_CARD_OF_YOUR_LIBRARY_IF_ITS_RED_YOU_MAY_CAST_IT_THIS_TURN_REGEX.test(text)) {
    return { id: "EXILE_TOP_CARD_OF_YOUR_LIBRARY_IF_ITS_RED_YOU_MAY_CAST_IT_THIS_TURN", matchedText: text };
  }

  if (EXILE_TOP_N_CARDS_OF_YOUR_LIBRARY_YOU_MAY_PLAY_THEM_THIS_TURN_REGEX.test(text)) {
    return { id: "EXILE_TOP_N_CARDS_OF_YOUR_LIBRARY_YOU_MAY_PLAY_THEM_THIS_TURN", matchedText: text };
  }

  if (EXILE_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REGEX.test(text)) {
    return { id: "EXILE_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD", matchedText: text };
  }

  if (EXILE_TOP_N_PUT_ALL_ARTIFACT_CARDS_ONTO_BATTLEFIELD_REGEX.test(text)) {
    return { id: "EXILE_TOP_N_PUT_ALL_ARTIFACT_CARDS_ONTO_BATTLEFIELD", matchedText: text };
  }

  if (EXILE_TOP_N_CREATURE_CARDS_GAIN_CAST_FROM_EXILE_WHILE_YOU_CONTROL_A_LUKKA_PLANESWALKER_REGEX.test(text)) {
    return { id: "EXILE_TOP_N_CREATURE_CARDS_GAIN_CAST_FROM_EXILE_WHILE_YOU_CONTROL_A_LUKKA_PLANESWALKER", matchedText: text };
  }

  if (EXILE_TOP_TWO_CARDS_OF_YOUR_LIBRARY_CHOOSE_ONE_YOU_MAY_PLAY_IT_THIS_TURN_REGEX.test(text)) {
    return { id: "EXILE_TOP_TWO_CARDS_OF_YOUR_LIBRARY_CHOOSE_ONE_YOU_MAY_PLAY_IT_THIS_TURN", matchedText: text };
  }

  if (EXILE_TARGET_CREATURE_YOU_CONTROL_REVEAL_UNTIL_CREATURE_GREATER_MV_PUT_BATTLEFIELD_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return {
      id: "EXILE_TARGET_CREATURE_YOU_CONTROL_REVEAL_UNTIL_CREATURE_GREATER_MV_PUT_BATTLEFIELD_REST_BOTTOM_RANDOM",
      matchedText: text,
    };
  }

  if (LOOK_AT_TOP_SEVEN_MAY_PUT_PERMANENT_MV3_OR_LESS_ONTO_BATTLEFIELD_WITH_SHIELD_COUNTER_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return {
      id: "LOOK_AT_TOP_SEVEN_MAY_PUT_PERMANENT_MV3_OR_LESS_ONTO_BATTLEFIELD_WITH_SHIELD_COUNTER_REST_BOTTOM_RANDOM",
      matchedText: text,
    };
  }

  if (DRAW_TWO_CARDS_THEN_DISCARD_TWO_UNLESS_DISCARD_AN_ARTIFACT_CARD_REGEX.test(text)) {
    return { id: "DRAW_TWO_CARDS_THEN_DISCARD_TWO_UNLESS_DISCARD_AN_ARTIFACT_CARD", matchedText: text };
  }

  if (EACH_PLAYER_SACRIFICES_TWO_CREATURES_REGEX.test(text)) {
    return { id: "EACH_PLAYER_SACRIFICES_TWO_CREATURES", matchedText: text };
  }

  if (DRAW_A_CARD_THEN_ADD_ONE_MANA_OF_ANY_COLOR_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_THEN_ADD_ONE_MANA_OF_ANY_COLOR", matchedText: text };
  }

  if (DRAW_A_CARD_THEN_SCRY_N_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_THEN_SCRY_N", matchedText: text };
  }

  if (DRAW_A_CARD_THEN_DISCARD_A_CARD_AT_RANDOM_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_THEN_DISCARD_A_CARD_AT_RANDOM", matchedText: text };
  }

  if (DRAW_A_CARD_TARGET_PLAYER_MILLS_A_CARD_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_TARGET_PLAYER_MILLS_A_CARD", matchedText: text };
  }

  if (DRAW_A_CARD_EACH_PLAYER_MILLS_TWO_CARDS_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_EACH_PLAYER_MILLS_TWO_CARDS", matchedText: text };
  }

  if (DRAW_N_CARDS_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_THE_BOTTOM_OF_YOUR_LIBRARY_REGEX.test(text)) {
    return { id: "DRAW_N_CARDS_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_THE_BOTTOM_OF_YOUR_LIBRARY", matchedText: text };
  }

  if (DRAW_A_CARD_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_TOP_OF_YOUR_LIBRARY_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_THEN_PUT_A_CARD_FROM_YOUR_HAND_ON_TOP_OF_YOUR_LIBRARY", matchedText: text };
  }

  if (DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX.test(text)) {
    return { id: "DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL", matchedText: text };
  }

  if (DISCARD_YOUR_HAND_THEN_DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX.test(text)) {
    return {
      id: "DISCARD_YOUR_HAND_THEN_DRAW_CARDS_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL",
      matchedText: text,
    };
  }

  if (DISCARD_YOUR_HAND_THEN_EXILE_TOP_THREE_CARDS_OF_YOUR_LIBRARY_UNTIL_END_OF_TURN_YOU_MAY_PLAY_CARDS_EXILED_THIS_WAY_REGEX.test(text)) {
    return {
      id: "DISCARD_YOUR_HAND_THEN_EXILE_TOP_THREE_CARDS_OF_YOUR_LIBRARY_UNTIL_END_OF_TURN_YOU_MAY_PLAY_CARDS_EXILED_THIS_WAY",
      matchedText: text,
    };
  }

  if (YOU_GAIN_LIFE_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL_REGEX.test(text)) {
    return { id: "YOU_GAIN_LIFE_EQUAL_TO_GREATEST_POWER_AMONG_CREATURES_YOU_CONTROL", matchedText: text };
  }

  if (EACH_PLAYER_DISCARDS_THEIR_HAND_THEN_DRAWS_THREE_CARDS_REGEX.test(text)) {
    return { id: "EACH_PLAYER_DISCARDS_THEIR_HAND_THEN_DRAWS_THREE_CARDS", matchedText: text };
  }

  if (EACH_PLAYER_DRAWS_A_CARD_REGEX.test(text)) {
    return { id: "EACH_PLAYER_DRAWS_A_CARD", matchedText: text };
  }

  if (IF_TARGET_PLAYER_HAS_FEWER_THAN_NINE_POISON_COUNTERS_THEY_GET_DIFFERENCE_REGEX.test(text)) {
    return { id: "IF_TARGET_PLAYER_HAS_FEWER_THAN_NINE_POISON_COUNTERS_THEY_GET_DIFFERENCE", matchedText: text };
  }

  if (CREATE_X_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_WHERE_X_IS_HIGHEST_LIFE_TOTAL_REGEX.test(text)) {
    return {
      id: "CREATE_X_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_WHERE_X_IS_HIGHEST_LIFE_TOTAL",
      matchedText: text,
    };
  }

  if (CREATE_A_NUMBER_OF_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_EQUAL_TO_HIGHEST_LIFE_TOTAL_REGEX.test(text)) {
    return {
      id: "CREATE_A_NUMBER_OF_1_1_BLACK_VAMPIRE_KNIGHT_TOKENS_WITH_LIFELINK_EQUAL_TO_HIGHEST_LIFE_TOTAL",
      matchedText: text,
    };
  }

  if (DEALS_DAMAGE_EQUAL_TO_TWICE_THE_NUMBER_OF_WARRIORS_AND_EQUIPMENT_YOU_CONTROL_TO_TARGET_PLAYER_OR_PLANESWALKER_REGEX.test(text)) {
    return {
      id: "DEALS_DAMAGE_EQUAL_TO_TWICE_THE_NUMBER_OF_WARRIORS_AND_EQUIPMENT_YOU_CONTROL_TO_TARGET_PLAYER_OR_PLANESWALKER",
      matchedText: text,
    };
  }

  if (RETURN_ALL_NONLAND_PERMANENT_CARDS_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX.test(text)) {
    return {
      id: "RETURN_ALL_NONLAND_PERMANENT_CARDS_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD",
      matchedText: text,
    };
  }

  if (EXILE_TARGET_NONLAND_PERMANENT_CARD_WITH_MANA_VALUE_X_FROM_YOUR_GRAVEYARD_CREATE_TOKEN_COPY_REGEX.test(text)) {
    return {
      id: "EXILE_TARGET_NONLAND_PERMANENT_CARD_WITH_MANA_VALUE_X_FROM_YOUR_GRAVEYARD_CREATE_TOKEN_COPY",
      matchedText: text,
    };
  }

  if (CREATE_X_2_2_WHITE_CAT_TOKENS_WHERE_X_IS_YOUR_LIFE_TOTAL_REGEX.test(text)) {
    return { id: "CREATE_X_2_2_WHITE_CAT_TOKENS_WHERE_X_IS_YOUR_LIFE_TOTAL", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_AND_PLANESWALKER_THEY_CONTROL_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_AND_PLANESWALKER_THEY_CONTROL", matchedText: text };
  }

  if (EACH_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_EACH_OPPONENT_REGEX.test(text)) {
    return { id: "EACH_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_EACH_OPPONENT", matchedText: text };
  }

  if (EXILE_THIS_PLANESWALKER_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL_REGEX.test(text)) {
    return { id: "EXILE_THIS_PLANESWALKER_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_LIFELINK_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_LIFELINK_UNTIL_YOUR_NEXT_TURN", matchedText: text };
  }

  if (YOU_GET_EMBLEM_THEN_CREATE_TOKEN_BASIC_REGEX.test(text)) {
    return { id: "YOU_GET_EMBLEM_THEN_CREATE_TOKEN_BASIC", matchedText: text };
  }

  if (CREATE_INSECT_TOKEN_THEN_MILL_REPEAT_IF_INSECT_MILLED_REGEX.test(text)) {
    return { id: "CREATE_INSECT_TOKEN_THEN_MILL_REPEAT_IF_INSECT_MILLED", matchedText: text };
  }

  if (EXILE_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_RETURN_AT_BEGINNING_OF_THAT_PLAYERS_NEXT_END_STEP_REGEX.test(text)) {
    return {
      id: "EXILE_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_RETURN_AT_BEGINNING_OF_THAT_PLAYERS_NEXT_END_STEP",
      matchedText: text,
    };
  }

  if (EXILE_TARGET_CREATURE_YOU_CONTROL_FOR_EACH_OTHER_PLAYER_EXILE_UP_TO_ONE_TARGET_CREATURE_THAT_PLAYER_CONTROLS_REGEX.test(text)) {
    return {
      id: "EXILE_TARGET_CREATURE_YOU_CONTROL_FOR_EACH_OTHER_PLAYER_EXILE_UP_TO_ONE_TARGET_CREATURE_THAT_PLAYER_CONTROLS",
      matchedText: text,
    };
  }

  if (EXILE_ANOTHER_TARGET_PERMANENT_YOU_OWN_THEN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_REGEX.test(text)) {
    return {
      id: "EXILE_ANOTHER_TARGET_PERMANENT_YOU_OWN_THEN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL",
      matchedText: text,
    };
  }

  if (EXILE_TARGET_PERMANENT_YOU_OWN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP_REGEX.test(text)) {
    return {
      id: "EXILE_TARGET_PERMANENT_YOU_OWN_RETURN_IT_TO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP",
      matchedText: text,
    };
  }

  if (EXILE_ALL_OTHER_PERMANENTS_REGEX.test(text)) {
    return {
      id: "EXILE_ALL_OTHER_PERMANENTS",
      matchedText: text,
    };
  }

  if (TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_IF_IT_ISNT_A_VEHICLE_IT_HAS_BASE_POWER_AND_TOUGHNESS_N_N_REGEX.test(text)) {
    return {
      id: "TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_IF_IT_ISNT_A_VEHICLE_IT_HAS_BASE_POWER_AND_TOUGHNESS_N_N",
      matchedText: text,
    };
  }

  if (TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_N_N_REGEX.test(text)) {
    return {
      id: "TARGET_ARTIFACT_BECOMES_ARTIFACT_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_N_N",
      matchedText: text,
    };
  }

  if (TARGET_CREATURE_WITHOUT_FIRST_STRIKE_DOUBLE_STRIKE_OR_VIGILANCE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) {
    return {
      id: "TARGET_CREATURE_WITHOUT_FIRST_STRIKE_DOUBLE_STRIKE_OR_VIGILANCE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN",
      matchedText: text,
    };
  }

  if (UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS2_MINUS0_AND_LOSES_FLYING_REGEX.test(text)) {
    return {
      id: "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS2_MINUS0_AND_LOSES_FLYING",
      matchedText: text,
    };
  }

  if (RESTART_THE_GAME_LEAVING_IN_EXILE_ALL_NON_AURA_PERMANENT_CARDS_EXILED_WITH_SOURCE_THEN_PUT_THOSE_CARDS_ONTO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL_REGEX.test(text)) {
    return {
      id: "RESTART_THE_GAME_LEAVING_IN_EXILE_ALL_NON_AURA_PERMANENT_CARDS_EXILED_WITH_SOURCE_THEN_PUT_THOSE_CARDS_ONTO_THE_BATTLEFIELD_UNDER_YOUR_CONTROL",
      matchedText: text,
    };
  }

  if (
    /^until your next turn, whenever a creature an opponent controls attacks, it gets -1\/-0 until end of turn\.?$/i.test(text)
  ) {
    return {
      id: "UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_AN_OPPONENT_CONTROLS_ATTACKS_IT_GETS_MINUS1_MINUS0_UNTIL_END_OF_TURN",
      matchedText: text,
    };
  }

  if (
    /^the next spell you cast this turn has affinity for artifacts\.(?: \(it costs \{1\} less to cast for each artifact you control as you cast it\.\))?$/i.test(
      text
    )
  ) {
    return {
      id: "THE_NEXT_SPELL_YOU_CAST_THIS_TURN_HAS_AFFINITY_FOR_ARTIFACTS",
      matchedText: text,
    };
  }

  const rxDestroyTargetCreatureOrPlaneswalker = /^destroy target creature or planeswalker\.?$/i;
  if (rxDestroyTargetCreatureOrPlaneswalker.test(text)) {
    return { id: "DESTROY_TARGET_CREATURE_OR_PLANESWALKER", matchedText: text };
  }

  if (DESTROY_TARGET_TAPPED_CREATURE_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_TAPPED_CREATURE", matchedText: text };
  }

  const rxDealsNDamageToTargetPlayerOrPlaneswalker = /^[a-z0-9 ,'-]+ deals (\d+) damage to target player or planeswalker\.?$/i;
  if (rxDealsNDamageToTargetPlayerOrPlaneswalker.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER", matchedText: text };
  }

  if (ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_TARGET_PLAYER_REGEX.test(text)) {
    return { id: "ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_TARGET_PLAYER", matchedText: text };
  }

  if (ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_UP_TO_ONE_TARGET_PLAYER_OR_PLANESWALKER_REGEX.test(text)) {
    return { id: "ADD_MANA_SYMBOLS_THEN_DEALS_N_DAMAGE_TO_UP_TO_ONE_TARGET_PLAYER_OR_PLANESWALKER", matchedText: text };
  }

  if (UNTAP_TARGET_PERMANENT_REGEX.test(text)) {
    return { id: "UNTAP_TARGET_PERMANENT", matchedText: text };
  }

  const mUntapAllCreaturesBuff = text.match(UNTAP_ALL_CREATURES_YOU_CONTROL_THEY_GET_PT_EOT_REGEX);
  if (mUntapAllCreaturesBuff) {
    return {
      id: "UNTAP_ALL_CREATURES_YOU_CONTROL_THEY_GET_PT_EOT",
      matchedText: text,
    };
  }

  if (UNTAP_TARGET_LAND_YOU_CONTROL_MAY_BECOME_3_3_ELEMENTAL_HASTE_MENACE_EOT_REGEX.test(text)) {
    return { id: "UNTAP_TARGET_LAND_YOU_CONTROL_MAY_BECOME_3_3_ELEMENTAL_HASTE_MENACE_EOT", matchedText: text };
  }

  if (UNTAP_TARGET_MOUNTAIN_BECOMES_4_4_RED_ELEMENTAL_EOT_REGEX.test(text)) {
    return { id: "UNTAP_TARGET_MOUNTAIN_BECOMES_4_4_RED_ELEMENTAL_EOT", matchedText: text };
  }

  if (TARGET_LAND_YOU_CONTROL_BECOMES_4_4_ELEMENTAL_TRAMPLE_REGEX.test(text)) {
    return { id: "TARGET_LAND_YOU_CONTROL_BECOMES_4_4_ELEMENTAL_TRAMPLE", matchedText: text };
  }

  if (UNTIL_END_OF_TURN_SOURCE_PLANESWALKER_BECOMES_N_N_CREATURE_PREVENT_ALL_DAMAGE_TO_IT_REGEX.test(text)) {
    return { id: "UNTIL_END_OF_TURN_SOURCE_PLANESWALKER_BECOMES_N_N_CREATURE_PREVENT_ALL_DAMAGE_TO_IT", matchedText: text };
  }

  if (UNTAP_UP_TO_N_TARGET_ARTIFACTS_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_N_TARGET_ARTIFACTS", matchedText: text };
  }

  if (UNTAP_UP_TO_N_TARGET_CREATURES_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_N_TARGET_CREATURES", matchedText: text };
  }

  if (UNTAP_UP_TO_N_TARGET_LANDS_WITH_SUBTYPE_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_N_TARGET_LANDS_WITH_SUBTYPE", matchedText: text };
  }

  if (TARGET_CREATURE_CANT_BE_BLOCKED_THIS_TURN_REGEX.test(text)) {
    return { id: "TARGET_CREATURE_CANT_BE_BLOCKED_THIS_TURN", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_CANT_BE_BLOCKED_THIS_TURN_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_CANT_BE_BLOCKED_THIS_TURN", matchedText: text };
  }

  if (CREATURES_CANT_BE_BLOCKED_THIS_TURN_REGEX.test(text)) {
    return { id: "CREATURES_CANT_BE_BLOCKED_THIS_TURN", matchedText: text };
  }

  if (TARGET_CREATURE_GAINS_FLYING_AND_DOUBLE_STRIKE_EOT_REGEX.test(text)) {
    return { id: "TARGET_CREATURE_GAINS_FLYING_AND_DOUBLE_STRIKE_EOT", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_UP_TO_M_CREATURE_CARDS_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_UP_TO_M_CREATURE_CARDS_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_CARD_AND_OR_A_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_CARD_AND_OR_A_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_OR_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_TYPE1_OR_TYPE2_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  const rxRevealTopNPutCreatureAndOrLandIntoHandRestGY =
    /^reveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\.? you may put a creature card and\/or a land card from among them into your hand\.? put the rest into your graveyard\.?$/i;
  if (rxRevealTopNPutCreatureAndOrLandIntoHandRestGY.test(text)) {
    return {
      id: "REVEAL_TOP_N_YOU_MAY_PUT_A_CREATURE_CARD_AND_OR_A_LAND_CARD_INTO_YOUR_HAND_REST_INTO_GRAVEYARD",
      matchedText: text,
    };
  }

  const rxMaySacCreatureWhenDoDestroy =
    /^you may sacrifice a creature\.? when you do, destroy target creature or planeswalker\.?$/i;
  if (rxMaySacCreatureWhenDoDestroy.test(text)) {
    return {
      id: "YOU_MAY_SACRIFICE_A_CREATURE_WHEN_YOU_DO_DESTROY_TARGET_CREATURE_OR_PLANESWALKER",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_WITH_MANA_VALUE_N_OR_LESS_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_WITH_MANA_VALUE_N_OR_LESS_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_ANY_NUMBER_OF_SUBTYPE_CREATURE_CARDS_PUT_THEM_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_ANY_NUMBER_OF_SUBTYPE_CREATURE_CARDS_PUT_THEM_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_A_BASIC_LAND_CARD_PUT_IT_ONTO_THE_BATTLEFIELD_OPTIONALLY_TAPPED_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_A_BASIC_LAND_CARD_PUT_IT_ONTO_THE_BATTLEFIELD_OPTIONALLY_TAPPED_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_A_CARD_THEN_SHUFFLE_PUT_ON_TOP_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_A_CARD_THEN_SHUFFLE_PUT_ON_TOP",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_AN_ARTIFACT_CARD_WITH_MANA_VALUE_X_OR_LESS_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_AN_ARTIFACT_CARD_WITH_MANA_VALUE_X_OR_LESS_PUT_IT_ONTO_THE_BATTLEFIELD_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_A_SUBTYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_A_SUBTYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_UP_TO_ONE_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_UP_TO_ONE_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_A_TYPE_CARD_REVEAL_PUT_INTO_HAND_THEN_SHUFFLE",
      matchedText: text,
    };
  }

  if (
    SEARCH_YOUR_LIBRARY_FOR_AN_INSTANT_OR_SORCERY_CARD_THAT_SHARES_A_COLOR_WITH_THIS_PLANESWALKER_EXILE_THEN_SHUFFLE_YOU_MAY_CAST_THAT_CARD_WITHOUT_PAYING_ITS_MANA_COST_REGEX.test(
      text
    )
  ) {
    return {
      id: "SEARCH_YOUR_LIBRARY_FOR_AN_INSTANT_OR_SORCERY_CARD_THAT_SHARES_A_COLOR_WITH_THIS_PLANESWALKER_EXILE_THEN_SHUFFLE_YOU_MAY_CAST_THAT_CARD_WITHOUT_PAYING_ITS_MANA_COST",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_SHUFFLE_IF_LIBRARY_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_PUT_IT_ONTO_THE_BATTLEFIELD_SHUFFLE_IF_LIBRARY",
      matchedText: text,
    };
  }

  if (SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_REVEAL_PUT_IT_INTO_YOUR_HAND_SHUFFLE_IF_LIBRARY_REGEX.test(text)) {
    return {
      id: "SEARCH_YOUR_LIBRARY_AND_OR_GRAVEYARD_FOR_A_CARD_NAMED_REVEAL_PUT_IT_INTO_YOUR_HAND_SHUFFLE_IF_LIBRARY",
      matchedText: text,
    };
  }

  if (TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1_REGEX.test(text)) {
    return {
      id: "TARGET_CREATURE_YOU_CONTROL_GAINS_DEATHTOUCH_AND_LIFELINK_EOT_IF_VAMPIRE_P1P1",
      matchedText: text,
    };
  }

  if (REVEAL_CARDS_UNTIL_CREATURE_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "REVEAL_CARDS_UNTIL_CREATURE_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_BOTTOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_BOTTOM", matchedText: text };
  }

  if (LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_INTO_GRAVEYARD_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_TWO_PUT_ONE_INTO_HAND_OTHER_INTO_GRAVEYARD", matchedText: text };
  }

  if (LOOK_AT_TOP_N_PUT_ONE_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_PUT_ONE_INTO_HAND_REST_BOTTOM_ANY_ORDER", matchedText: text };
  }

  if (LOOK_AT_TOP_N_PUT_K_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_PUT_K_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_NONCREATURE_NONLAND_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_A_NONCREATURE_NONLAND_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ENCHANTMENT_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ENCHANTMENT_CARD_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_PUT_ANY_NUMBER_OF_CREATURE_AND_OR_LAND_CARDS_ONTO_BATTLEFIELD_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ARTIFACT_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_ARTIFACT_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER", matchedText: text };
  }

  if (LOOK_AT_TOP_TWO_EXILE_ONE_PUT_OTHER_INTO_HAND_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_TWO_EXILE_ONE_PUT_OTHER_INTO_HAND", matchedText: text };
  }

  if (LOOK_AT_TOP_N_EXILE_ONE_FACE_DOWN_REST_BOTTOM_ANY_ORDER_YOU_MAY_CAST_IT_IF_CREATURE_REGEX.test(text)) {
    return {
      id: "LOOK_AT_TOP_N_EXILE_ONE_FACE_DOWN_REST_BOTTOM_ANY_ORDER_YOU_MAY_CAST_IT_IF_CREATURE",
      matchedText: text,
    };
  }

  if (LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_AURA_CREATURE_OR_PLANESWALKER_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX.test(text)) {
    return {
      id: "LOOK_AT_TOP_N_YOU_MAY_REVEAL_AN_AURA_CREATURE_OR_PLANESWALKER_CARD_PUT_INTO_HAND_REST_BOTTOM_ANY_ORDER",
      matchedText: text,
    };
  }

  if (LOOK_AT_TOP_TWO_PUT_ONE_INTO_GRAVEYARD_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_TWO_PUT_ONE_INTO_GRAVEYARD", matchedText: text };
  }

  if (REVEAL_TOP_N_PUT_ALL_CREATURE_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX.test(text)) {
    return { id: "REVEAL_TOP_N_PUT_ALL_CREATURE_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER", matchedText: text };
  }

  if (REVEAL_TOP_N_PUT_ALL_NONLAND_PERMANENT_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER_REGEX.test(text)) {
    return {
      id: "REVEAL_TOP_N_PUT_ALL_NONLAND_PERMANENT_CARDS_INTO_HAND_REST_BOTTOM_ANY_ORDER",
      matchedText: text,
    };
  }

  if (REVEAL_TOP_THREE_OPPONENT_SEPARATES_INTO_TWO_PILES_PUT_ONE_INTO_HAND_OTHER_BOTTOM_ANY_ORDER_REGEX.test(text)) {
    return {
      id: "REVEAL_TOP_THREE_OPPONENT_SEPARATES_INTO_TWO_PILES_PUT_ONE_INTO_HAND_OTHER_BOTTOM_ANY_ORDER",
      matchedText: text,
    };
  }

  if (SEPARATE_ALL_PERMANENTS_TARGET_PLAYER_CONTROLS_INTO_TWO_PILES_THAT_PLAYER_SACRIFICES_PILE_OF_THEIR_CHOICE_REGEX.test(text)) {
    return {
      id: "SEPARATE_ALL_PERMANENTS_TARGET_PLAYER_CONTROLS_INTO_TWO_PILES_THAT_PLAYER_SACRIFICES_PILE_OF_THEIR_CHOICE",
      matchedText: text,
    };
  }

  if (YOU_MAY_DISCARD_A_CARD_IF_YOU_DO_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "YOU_MAY_DISCARD_A_CARD_IF_YOU_DO_DRAW_A_CARD", matchedText: text };
  }

  if (DISCARD_A_CARD_THEN_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "DISCARD_A_CARD_THEN_DRAW_A_CARD", matchedText: text };
  }

  if (DRAW_A_CARD_THEN_DISCARD_A_CARD_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_THEN_DISCARD_A_CARD", matchedText: text };
  }

  if (DRAW_TWO_CARDS_THEN_DISCARD_A_CARD_REGEX.test(text)) {
    return { id: "DRAW_TWO_CARDS_THEN_DISCARD_A_CARD", matchedText: text };
  }

  if (DRAW_A_CARD_YOU_MAY_PLAY_AN_ADDITIONAL_LAND_THIS_TURN_REGEX.test(text)) {
    return { id: "DRAW_A_CARD_YOU_MAY_PLAY_AN_ADDITIONAL_LAND_THIS_TURN", matchedText: text };
  }

  if (TARGET_PLAYER_DISCARDS_A_CARD_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_DISCARDS_A_CARD", matchedText: text };
  }

  if (TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_DRAWS_N_CARDS_AND_LOSES_N_LIFE", matchedText: text };
  }

  if (TARGET_PLAYER_DRAWS_N_CARDS_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_DRAWS_N_CARDS", matchedText: text };
  }

  if (TARGET_PLAYER_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_GETS_AN_EMBLEM_WITH_QUOTED_TEXT", matchedText: text };
  }

  if (TARGET_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX.test(text)) {
    return { id: "TARGET_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT", matchedText: text };
  }

  if (EACH_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT_REGEX.test(text)) {
    return { id: "EACH_OPPONENT_GETS_AN_EMBLEM_WITH_QUOTED_TEXT", matchedText: text };
  }

  if (TARGET_PLAYER_DRAWS_N_CARDS_THEN_DISCARDS_M_CARDS_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_DRAWS_N_CARDS_THEN_DISCARDS_M_CARDS", matchedText: text };
  }

  if (ANY_NUMBER_OF_TARGET_PLAYERS_EACH_DRAW_N_CARDS_REGEX.test(text)) {
    return { id: "ANY_NUMBER_OF_TARGET_PLAYERS_EACH_DRAW_N_CARDS", matchedText: text };
  }

  if (DESTROY_TARGET_CREATURE_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_CREATURE_DRAW_A_CARD", matchedText: text };
  }

  if (DESTROY_TARGET_CREATURE_PUT_LOYALTY_COUNTERS_ON_SOURCE_EQUAL_TO_THAT_CREATURES_TOUGHNESS_REGEX.test(text)) {
    return {
      id: "DESTROY_TARGET_CREATURE_PUT_LOYALTY_COUNTERS_ON_SOURCE_EQUAL_TO_THAT_CREATURES_TOUGHNESS",
      matchedText: text,
    };
  }

  if (DESTROY_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_CREATE_A_TREASURE_TOKEN_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_ARTIFACT_CREATURE_OR_ENCHANTMENT_CREATE_A_TREASURE_TOKEN", matchedText: text };
  }

  if (DESTROY_TARGET_CREATURE_ITS_CONTROLLER_LOSES_2_LIFE_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_CREATURE_ITS_CONTROLLER_LOSES_2_LIFE", matchedText: text };
  }

  if (DESTROY_TARGET_CREATURE_WITH_A_MINUS1_MINUS1_COUNTER_ON_IT_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_CREATURE_WITH_A_MINUS1_MINUS1_COUNTER_ON_IT", matchedText: text };
  }

  if (DESTROY_TARGET_CREATURE_YOU_GAIN_LIFE_EQUAL_TO_ITS_TOUGHNESS_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_CREATURE_YOU_GAIN_LIFE_EQUAL_TO_ITS_TOUGHNESS", matchedText: text };
  }

  if (YOU_GAIN_LIFE_AND_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "YOU_GAIN_LIFE_AND_DRAW_A_CARD", matchedText: text };
  }

  if (YOU_GAIN_N_LIFE_AND_DRAW_M_CARDS_REGEX.test(text)) {
    return { id: "YOU_GAIN_N_LIFE_AND_DRAW_M_CARDS", matchedText: text };
  }

  if (TARGET_PLAYERS_LIFE_TOTAL_BECOMES_1_REGEX.test(text)) {
    return { id: "TARGET_PLAYERS_LIFE_TOTAL_BECOMES_1", matchedText: text };
  }

  if (TARGET_PLAYERS_LIFE_TOTAL_BECOMES_N_REGEX.test(text)) {
    return { id: "TARGET_PLAYERS_LIFE_TOTAL_BECOMES_N", matchedText: text };
  }

  if (YOU_GAIN_LIFE_FOR_EACH_CREATURE_YOU_CONTROL_REGEX.test(text)) {
    return { id: "YOU_GAIN_LIFE_FOR_EACH_CREATURE_YOU_CONTROL", matchedText: text };
  }

  if (ADD_MANA_SYMBOLS_REGEX.test(text)) {
    return { id: "ADD_MANA_SYMBOLS", matchedText: text };
  }

  if (DEALS_DAMAGE_TO_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "DEALS_DAMAGE_TO_TARGET_CREATURE", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_TARGET_CREATURE_AND_M_DAMAGE_TO_THAT_CREATURES_CONTROLLER_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_TARGET_CREATURE_AND_M_DAMAGE_TO_THAT_CREATURES_CONTROLLER", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_THAT_PLAYER_CONTROLS_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_TARGET_PLAYER_AND_EACH_CREATURE_THAT_PLAYER_CONTROLS", matchedText: text };
  }

  if (DEALS_X_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS_REGEX.test(text)) {
    return { id: "DEALS_X_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_EACH_OF_UP_TO_N_TARGETS", matchedText: text };
  }

  if (YOU_DEAL_X_DAMAGE_TO_ANY_TARGET_REGEX.test(text)) {
    return { id: "YOU_DEAL_X_DAMAGE_TO_ANY_TARGET", matchedText: text };
  }

  if (TARGET_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_OR_PLANESWALKER_REGEX.test(text)) {
    return { id: "TARGET_CREATURE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_OR_PLANESWALKER", matchedText: text };
  }

  if (EXILE_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "EXILE_TARGET_CREATURE", matchedText: text };
  }

  const mExileByPowerThreshold = text.match(EXILE_TARGET_CREATURE_WITH_POWER_N_OR_GREATER_REGEX);
  if (mExileByPowerThreshold) {
    return {
      id: "EXILE_TARGET_CREATURE_WITH_POWER_N_OR_GREATER",
      matchedText: text,
    };
  }

  if (DESTROY_TARGET_ARTIFACT_OR_ENCHANTMENT_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_ARTIFACT_OR_ENCHANTMENT", matchedText: text };
  }

  if (DESTROY_TARGET_ARTIFACT_ENCHANTMENT_OR_CREATURE_WITH_FLYING_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_ARTIFACT_ENCHANTMENT_OR_CREATURE_WITH_FLYING", matchedText: text };
  }

  if (CREATE_3_3_GREEN_BEAST_TOKEN_THEN_IF_OPPONENT_CONTROLS_MORE_CREATURES_PUT_LOYALTY_COUNTER_ON_SOURCE_REGEX.test(text)) {
    return { id: "CREATE_3_3_GREEN_BEAST_TOKEN_THEN_IF_OPPONENT_CONTROLS_MORE_CREATURES_PUT_LOYALTY_COUNTER_ON_SOURCE", matchedText: text };
  }

  if (CREATE_3_3_GREEN_BEAST_TOKEN_CHOOSE_VIGILANCE_REACH_TRAMPLE_COUNTER_REGEX.test(text)) {
    return { id: "CREATE_3_3_GREEN_BEAST_TOKEN_CHOOSE_VIGILANCE_REACH_TRAMPLE_COUNTER", matchedText: text };
  }

  if (CREATE_NAMED_TOKEN_WITH_ABILITIES_REGEX.test(text)) {
    return { id: "CREATE_NAMED_TOKEN_WITH_ABILITIES", matchedText: text };
  }

  if (CREATE_2_2_BLACK_ZOMBIE_TOKEN_MILL_TWO_REGEX.test(text)) {
    return { id: "CREATE_2_2_BLACK_ZOMBIE_TOKEN_MILL_TWO", matchedText: text };
  }

  if (CREATE_2_2_BLUE_WIZARD_TOKEN_DRAW_THEN_DISCARD_REGEX.test(text)) {
    return { id: "CREATE_2_2_BLUE_WIZARD_TOKEN_DRAW_THEN_DISCARD", matchedText: text };
  }

  if (CREATE_1_1_HUMAN_WIZARD_TOKEN_ALL_COLORS_REGEX.test(text)) {
    return { id: "CREATE_1_1_HUMAN_WIZARD_TOKEN_ALL_COLORS", matchedText: text };
  }

  if (CREATE_1_1_WHITE_KOR_SOLDIER_TOKEN_MAY_ATTACH_EQUIPMENT_REGEX.test(text)) {
    return { id: "CREATE_1_1_WHITE_KOR_SOLDIER_TOKEN_MAY_ATTACH_EQUIPMENT", matchedText: text };
  }

  if (CREATE_X_1_1_RED_DEVIL_TOKENS_WHEN_DIES_DEAL_1_DAMAGE_REGEX.test(text)) {
    return { id: "CREATE_X_1_1_RED_DEVIL_TOKENS_WHEN_DIES_DEAL_1_DAMAGE", matchedText: text };
  }

  if (CREATE_X_X_GREEN_PHYREXIAN_HORROR_TOKEN_WHERE_X_IS_SOURCE_LOYALTY_REGEX.test(text)) {
    return { id: "CREATE_X_X_GREEN_PHYREXIAN_HORROR_TOKEN_WHERE_X_IS_SOURCE_LOYALTY", matchedText: text };
  }

  if (CREATE_TOKEN_COPY_TARGET_CREATURE_EXCEPT_HASTE_SAC_AT_END_STEP_REGEX.test(text)) {
    return { id: "CREATE_TOKEN_COPY_TARGET_CREATURE_EXCEPT_HASTE_SAC_AT_END_STEP", matchedText: text };
  }

  if (HEAD_TO_ASKURZA_COM_AND_CLICK_N_REGEX.test(text)) {
    return { id: "HEAD_TO_ASKURZA_COM_AND_CLICK_N", matchedText: text };
  }

  if (ACCEPT_ONE_OF_DAVRIELS_OFFERS_THEN_ACCEPT_ONE_OF_DAVRIELS_CONDITIONS_REGEX.test(text)) {
    return { id: "ACCEPT_ONE_OF_DAVRIELS_OFFERS_THEN_ACCEPT_ONE_OF_DAVRIELS_CONDITIONS", matchedText: text };
  }

  if (CHOOSE_LEFT_OR_RIGHT_UNTIL_YOUR_NEXT_TURN_ATTACK_NEAREST_OPPONENT_REGEX.test(text)) {
    return { id: "CHOOSE_LEFT_OR_RIGHT_UNTIL_YOUR_NEXT_TURN_ATTACK_NEAREST_OPPONENT", matchedText: text };
  }

  if (CHOOSE_LEFT_OR_RIGHT_EACH_PLAYER_GAINS_CONTROL_NONLAND_PERMANENTS_REGEX.test(text)) {
    return { id: "CHOOSE_LEFT_OR_RIGHT_EACH_PLAYER_GAINS_CONTROL_NONLAND_PERMANENTS", matchedText: text };
  }

  if (TARGET_CREATURE_AN_OPPONENT_CONTROLS_PERPETUALLY_GETS_MINUS3_MINUS3_REGEX.test(text)) {
    return { id: "TARGET_CREATURE_AN_OPPONENT_CONTROLS_PERPETUALLY_GETS_MINUS3_MINUS3", matchedText: text };
  }

  if (UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1", matchedText: text };
  }

  if (SEEK_AN_ELF_CARD_REGEX.test(text)) {
    return { id: "SEEK_AN_ELF_CARD", matchedText: text };
  }

  if (CONJURE_A_CARD_NAMED_ONTO_THE_BATTLEFIELD_REGEX.test(text)) {
    return { id: "CONJURE_A_CARD_NAMED_ONTO_THE_BATTLEFIELD", matchedText: text };
  }

  if (CONJURE_A_CARD_NAMED_INTO_YOUR_HAND_REGEX.test(text)) {
    return { id: "CONJURE_A_CARD_NAMED_INTO_YOUR_HAND", matchedText: text };
  }

  if (DRAFT_A_CARD_FROM_SPELLBOOK_AND_PUT_IT_ONTO_THE_BATTLEFIELD_REGEX.test(text)) {
    return { id: "DRAFT_A_CARD_FROM_SPELLBOOK_AND_PUT_IT_ONTO_THE_BATTLEFIELD", matchedText: text };
  }

  if (ADD_RR_DRAFT_A_CARD_FROM_SPELLBOOK_THEN_EXILE_YOU_MAY_CAST_IT_THIS_TURN_REGEX.test(text)) {
    return { id: "ADD_RR_DRAFT_A_CARD_FROM_SPELLBOOK_THEN_EXILE_YOU_MAY_CAST_IT_THIS_TURN", matchedText: text };
  }

  if (ROLL_A_D20_SKIP_NEXT_TURN_OR_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "ROLL_A_D20_SKIP_NEXT_TURN_OR_DRAW_A_CARD", matchedText: text };
  }

  if (OPEN_SEALED_KAMIGAWA_BOOSTER_PACK_AND_DRAFT_TWO_REGEX.test(text)) {
    return { id: "OPEN_SEALED_KAMIGAWA_BOOSTER_PACK_AND_DRAFT_TWO", matchedText: text };
  }

  if (CHOOSE_CREATURE_CARD_IN_HAND_PERPETUALLY_GETS_P1P1_AND_COSTS_1_LESS_REGEX.test(text)) {
    return { id: "CHOOSE_CREATURE_CARD_IN_HAND_PERPETUALLY_GETS_P1P1_AND_COSTS_1_LESS", matchedText: text };
  }

  if (DRAGON_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X_REGEX.test(text)) {
    return { id: "DRAGON_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X", matchedText: text };
  }

  if (UP_TO_ONE_TARGET_CREATURE_BASE_POWER_PERPETUALLY_BECOMES_TOUGHNESS_AND_GAINS_ATTACK_NO_DEFENDER_REGEX.test(text)) {
    return { id: "UP_TO_ONE_TARGET_CREATURE_BASE_POWER_PERPETUALLY_BECOMES_TOUGHNESS_AND_GAINS_ATTACK_NO_DEFENDER", matchedText: text };
  }

  if (CREATE_GREEN_TREEFOLK_TOKEN_REACH_PT_EQUALS_LANDS_YOU_CONTROL_REGEX.test(text)) {
    return { id: "CREATE_GREEN_TREEFOLK_TOKEN_REACH_PT_EQUALS_LANDS_YOU_CONTROL", matchedText: text };
  }

  if (CREATE_BLUE_DOG_ILLUSION_TOKEN_PT_EQUALS_TWICE_CARDS_IN_HAND_REGEX.test(text)) {
    return { id: "CREATE_BLUE_DOG_ILLUSION_TOKEN_PT_EQUALS_TWICE_CARDS_IN_HAND", matchedText: text };
  }

  if (CREATE_WHITE_AVATAR_TOKEN_PT_EQUALS_YOUR_LIFE_TOTAL_REGEX.test(text)) {
    return { id: "CREATE_WHITE_AVATAR_TOKEN_PT_EQUALS_YOUR_LIFE_TOTAL", matchedText: text };
  }

  if (CREATE_MASK_AURA_TOKEN_ATTACHED_TO_TARGET_PERMANENT_REGEX.test(text)) {
    return { id: "CREATE_MASK_AURA_TOKEN_ATTACHED_TO_TARGET_PERMANENT", matchedText: text };
  }

  if (CREATE_STONEFORGED_BLADE_EQUIPMENT_TOKEN_REGEX.test(text)) {
    return { id: "CREATE_STONEFORGED_BLADE_EQUIPMENT_TOKEN", matchedText: text };
  }

  if (CREATE_TWO_NONLEGENDARY_TOKEN_COPIES_OF_SOURCE_PLANESWALKER_REGEX.test(text)) {
    return { id: "CREATE_TWO_NONLEGENDARY_TOKEN_COPIES_OF_SOURCE_PLANESWALKER", matchedText: text };
  }

  if (CREATE_TOKEN_BASIC_REGEX.test(text)) {
    return { id: "CREATE_TOKEN_BASIC", matchedText: text };
  }

  if (CREATE_N_1_1_COLOR_ELEMENTAL_CREATURE_TOKENS_THEY_GAIN_HASTE_SACRIFICE_NEXT_END_STEP_REGEX.test(text)) {
    return { id: "CREATE_N_1_1_COLOR_ELEMENTAL_CREATURE_TOKENS_THEY_GAIN_HASTE_SACRIFICE_NEXT_END_STEP", matchedText: text };
  }

  if (FOR_EACH_ARTIFACT_YOU_CONTROL_CREATE_TOKEN_THATS_A_COPY_TOKENS_GAIN_HASTE_EXILE_NEXT_END_STEP_REGEX.test(text)) {
    return { id: "FOR_EACH_ARTIFACT_YOU_CONTROL_CREATE_TOKEN_THATS_A_COPY_TOKENS_GAIN_HASTE_EXILE_NEXT_END_STEP", matchedText: text };
  }

  if (CREATE_TOKEN_THATS_A_COPY_OF_TARGET_ARTIFACT_OR_CREATURE_YOU_CONTROL_IT_GAINS_HASTE_EXILE_NEXT_END_STEP_REGEX.test(text)) {
    return { id: "CREATE_TOKEN_THATS_A_COPY_OF_TARGET_ARTIFACT_OR_CREATURE_YOU_CONTROL_IT_GAINS_HASTE_EXILE_NEXT_END_STEP", matchedText: text };
  }

  if (CREATE_N_N_COLOR_SUBTYPE_CREATURE_TOKEN_FOR_EACH_LAND_YOU_CONTROL_REGEX.test(text)) {
    return { id: "CREATE_N_N_COLOR_SUBTYPE_CREATURE_TOKEN_FOR_EACH_LAND_YOU_CONTROL", matchedText: text };
  }

  if (CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS_REGEX.test(text)) {
    return { id: "CREATE_TAPPED_PREDEFINED_ARTIFACT_TOKENS", matchedText: text };
  }

  if (CREATE_PREDEFINED_ARTIFACT_TOKENS_REGEX.test(text)) {
    return { id: "CREATE_PREDEFINED_ARTIFACT_TOKENS", matchedText: text };
  }

  if (REVEAL_TOP_TWO_OPPONENT_CHOSES_ONE_HAND_EXILE_SILVER_REGEX.test(text)) {
    return { id: "REVEAL_TOP_TWO_OPPONENT_CHOSES_ONE_HAND_EXILE_SILVER", matchedText: text };
  }

  if (PUT_A_CARD_YOU_OWN_WITH_A_SILVER_COUNTER_ON_IT_FROM_EXILE_INTO_YOUR_HAND_REGEX.test(text)) {
    return { id: "PUT_A_CARD_YOU_OWN_WITH_A_SILVER_COUNTER_ON_IT_FROM_EXILE_INTO_YOUR_HAND", matchedText: text };
  }

  if (YOU_MAY_PUT_A_SUBTYPE_CREATURE_CARD_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD_REGEX.test(text)) {
    return {
      id: "YOU_MAY_PUT_A_SUBTYPE_CREATURE_CARD_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD",
      matchedText: text,
    };
  }

  if (YOU_MAY_PUT_A_COLOR_OR_SUBTYPE_CREATURE_CARD_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD_REGEX.test(text)) {
    return { id: "YOU_MAY_PUT_A_COLOR_OR_SUBTYPE_CREATURE_CARD_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD", matchedText: text };
  }

  if (YOU_MAY_PUT_AN_ARTIFACT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_REGEX.test(text)) {
    return { id: "YOU_MAY_PUT_AN_ARTIFACT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD", matchedText: text };
  }

  if (YOU_MAY_PUT_AN_EQUIPMENT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_REGEX.test(text)) {
    return { id: "YOU_MAY_PUT_AN_EQUIPMENT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD", matchedText: text };
  }

  if (YOU_MAY_PUT_A_CREATURE_CARD_WITH_MANA_VALUE_LESS_THAN_OR_EQUAL_TO_LANDS_YOU_CONTROL_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_WITH_TWO_P1P1_COUNTERS_REGEX.test(text)) {
    return {
      id: "YOU_MAY_PUT_A_CREATURE_CARD_WITH_MANA_VALUE_LESS_THAN_OR_EQUAL_TO_LANDS_YOU_CONTROL_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_WITH_TWO_P1P1_COUNTERS",
      matchedText: text,
    };
  }

  if (YOU_GAIN_N_LIFE_FOR_EACH_SUBTYPE_YOU_CONTROL_REGEX.test(text)) {
    return { id: "YOU_GAIN_N_LIFE_FOR_EACH_SUBTYPE_YOU_CONTROL", matchedText: text };
  }

  if (ADD_RESTRICTED_MANA_SPEND_ONLY_REGEX.test(text)) {
    return { id: "ADD_RESTRICTED_MANA_SPEND_ONLY", matchedText: text };
  }

  if (ADD_TWO_MANA_ANY_COMBINATION_SPEND_ONLY_DRAGONS_REGEX.test(text)) {
    return { id: "ADD_TWO_MANA_ANY_COMBINATION_SPEND_ONLY_DRAGONS", matchedText: text };
  }

  if (ADD_TWO_MANA_ANY_COMBINATION_REGEX.test(text)) {
    return { id: "ADD_TWO_MANA_ANY_COMBINATION", matchedText: text };
  }

  if (ADD_TEN_MANA_ANY_ONE_COLOR_REGEX.test(text)) {
    return { id: "ADD_TEN_MANA_ANY_ONE_COLOR", matchedText: text };
  }

  if (ADD_MANA_SYMBOL_FOR_EACH_PLANESWALKER_YOU_CONTROL_REGEX.test(text)) {
    return { id: "ADD_MANA_SYMBOL_FOR_EACH_PLANESWALKER_YOU_CONTROL", matchedText: text };
  }

  if (ADD_MANA_SYMBOL_FOR_EACH_BASIC_LAND_TYPE_YOU_CONTROL_REGEX.test(text)) {
    return { id: "ADD_MANA_SYMBOL_FOR_EACH_BASIC_LAND_TYPE_YOU_CONTROL", matchedText: text };
  }

  if (PAY_ANY_AMOUNT_LOOK_AT_THAT_MANY_PUT_ONE_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "PAY_ANY_AMOUNT_LOOK_AT_THAT_MANY_PUT_ONE_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (CAST_SORCERY_SPELLS_AS_THOUGH_THEY_HAD_FLASH_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) {
    return { id: "CAST_SORCERY_SPELLS_AS_THOUGH_THEY_HAD_FLASH_UNTIL_YOUR_NEXT_TURN", matchedText: text };
  }

  if (PREVENT_ALL_DAMAGE_TO_AND_DEALT_BY_TARGET_OPPONENT_PERMANENT_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) {
    return {
      id: "PREVENT_ALL_DAMAGE_TO_AND_DEALT_BY_TARGET_OPPONENT_PERMANENT_UNTIL_YOUR_NEXT_TURN",
      matchedText: text,
    };
  }
  if (DRAW_AND_LOSE_LIFE_SELF_REGEX.test(text)) {
    return { id: "DRAW_CARD_AND_LOSE_LIFE_SELF", matchedText: text };
  }

  if (TARGET_PLAYER_MILLS_N_THEN_DRAW_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_MILLS_N_THEN_DRAW", matchedText: text };
  }

  if (TARGET_PLAYER_MILLS_THREE_TIMES_X_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_MILLS_THREE_TIMES_X", matchedText: text };
  }

  if (TARGET_PLAYER_MILLS_N_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_MILLS_N", matchedText: text };
  }

  if (PUT_P1P1_ON_TARGETS_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTERS_ON_TARGETS", matchedText: text };
  }

  if (PUT_X_P1P1_COUNTERS_ON_TARGET_CREATURE_WHERE_X_IS_YOUR_LIFE_TOTAL_REGEX.test(text)) {
    return { id: "PUT_X_P1P1_COUNTERS_ON_TARGET_CREATURE_WHERE_X_IS_YOUR_LIFE_TOTAL", matchedText: text };
  }

  if (PUT_N_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_AND_N_LOYALTY_COUNTERS_ON_EACH_OTHER_PLANESWALKER_YOU_CONTROL_REGEX.test(text)) {
    return {
      id: "PUT_N_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_AND_N_LOYALTY_COUNTERS_ON_EACH_OTHER_PLANESWALKER_YOU_CONTROL",
      matchedText: text,
    };
  }

  if (PUT_P1P1_COUNTER_ON_EACH_CREATURE_YOU_CONTROL_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTER_ON_EACH_CREATURE_YOU_CONTROL", matchedText: text };
  }

  if (PUT_A_LOYALTY_COUNTER_ON_EACH_COLOR_PLANESWALKER_YOU_CONTROL_REGEX.test(text)) {
    return { id: "PUT_A_LOYALTY_COUNTER_ON_EACH_COLOR_PLANESWALKER_YOU_CONTROL", matchedText: text };
  }

  if (PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_YOU_CONTROL_REGEX.test(text)) {
    return { id: "PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_YOU_CONTROL", matchedText: text };
  }

  if (PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_TARGET_OPPONENT_CONTROLS_REGEX.test(text)) {
    return { id: "PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_TARGET_OPPONENT_CONTROLS", matchedText: text };
  }

  if (PUT_MINUS1_MINUS1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "PUT_MINUS1_MINUS1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE", matchedText: text };
  }

  if (PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_MENACE_EOT_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_MENACE_EOT", matchedText: text };
  }

  if (PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_INDESTRUCTIBLE_EOT_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_INDESTRUCTIBLE_EOT", matchedText: text };
  }

  if (TARGET_CREATURE_GETS_PT_EOT_REGEX.test(text)) {
    return { id: "TARGET_CREATURE_GETS_PT_EOT", matchedText: text };
  }

  if (TARGET_CREATURE_GETS_PLUSX_PLUSX_EOT_WHERE_X_IS_NUMBER_OF_CREATURES_YOU_CONTROL_REGEX.test(text)) {
    return {
      id: "TARGET_CREATURE_GETS_PLUSX_PLUSX_EOT_WHERE_X_IS_NUMBER_OF_CREATURES_YOU_CONTROL",
      matchedText: text,
    };
  }

  if (TARGET_CREATURE_GETS_PLUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ARTIFACTS_YOU_CONTROL_REGEX.test(text)) {
    return {
      id: "TARGET_CREATURE_GETS_PLUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ARTIFACTS_YOU_CONTROL",
      matchedText: text,
    };
  }

  if (TARGET_CREATURE_GETS_MINUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ZOMBIES_YOU_CONTROL_REGEX.test(text)) {
    return {
      id: "TARGET_CREATURE_GETS_MINUSX_MINUSX_EOT_WHERE_X_IS_NUMBER_OF_ZOMBIES_YOU_CONTROL",
      matchedText: text,
    };
  }

  if (DESTROY_TARGET_NONCREATURE_PERMANENT_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_NONCREATURE_PERMANENT", matchedText: text };
  }

  if (DESTROY_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_CREATURE", matchedText: text };
  }

  if (DESTROY_ALL_CREATURES_POWER_GE_N_REGEX.test(text)) {
    return { id: "DESTROY_ALL_CREATURES_POWER_GE_N", matchedText: text };
  }

  if (DESTROY_ALL_NON_DRAGON_CREATURES_REGEX.test(text)) {
    return { id: "DESTROY_ALL_NON_DRAGON_CREATURES", matchedText: text };
  }

  if (DESTROY_ALL_CREATURES_YOU_DONT_CONTROL_REGEX.test(text)) {
    return { id: "DESTROY_ALL_CREATURES_YOU_DONT_CONTROL", matchedText: text };
  }

  if (DESTROY_ALL_OTHER_PERMANENTS_EXCEPT_LANDS_AND_TOKENS_REGEX.test(text)) {
    return { id: "DESTROY_ALL_OTHER_PERMANENTS_EXCEPT_LANDS_AND_TOKENS", matchedText: text };
  }

  if (DESTROY_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_THEN_DEALS_DAMAGE_EQUAL_TO_THEIR_TOTAL_POWER_REGEX.test(text)) {
    return { id: "DESTROY_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_THEN_DEALS_DAMAGE_EQUAL_TO_THEIR_TOTAL_POWER", matchedText: text };
  }

  if (EXILE_TARGET_NONLAND_PERMANENT_REGEX.test(text)) {
    return { id: "EXILE_TARGET_NONLAND_PERMANENT", matchedText: text };
  }

  if (REVEAL_TOP_CARD_IF_CREATURE_OR_PLANESWALKER_PUT_INTO_HAND_OTHERWISE_MAY_PUT_ON_BOTTOM_REGEX.test(text)) {
    return {
      id: "REVEAL_TOP_CARD_IF_CREATURE_OR_PLANESWALKER_PUT_INTO_HAND_OTHERWISE_MAY_PUT_ON_BOTTOM",
      matchedText: text,
    };
  }

  if (REVEAL_TOP_CARD_IF_ITS_A_CREATURE_CARD_PUT_INTO_HAND_OTHERWISE_PUT_ON_BOTTOM_REGEX.test(text)) {
    return {
      id: "REVEAL_TOP_CARD_IF_ITS_A_CREATURE_CARD_PUT_INTO_HAND_OTHERWISE_PUT_ON_BOTTOM",
      matchedText: text,
    };
  }

  if (REVEAL_TOP_TWO_PUT_LANDS_ONTO_BATTLEFIELD_REST_INTO_HAND_REGEX.test(text)) {
    return { id: "REVEAL_TOP_TWO_PUT_LANDS_ONTO_BATTLEFIELD_REST_INTO_HAND", matchedText: text };
  }

  if (REVEAL_TOP_FOUR_PUT_LANDS_INTO_HAND_REST_INTO_GRAVEYARD_REGEX.test(text)) {
    return { id: "REVEAL_TOP_FOUR_PUT_LANDS_INTO_HAND_REST_INTO_GRAVEYARD", matchedText: text };
  }

  if (RETURN_TARGET_ARTIFACT_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX.test(text)) {
    return { id: "RETURN_TARGET_ARTIFACT_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_TARGET_OPPONENT_OR_PLANESWALKER_AND_EACH_CREATURE_THEY_CONTROL_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_TARGET_OPPONENT_OR_PLANESWALKER_AND_EACH_CREATURE_THEY_CONTROL", matchedText: text };
  }

  if (DEALS_DAMAGE_TO_ANY_TARGET_REGEX.test(text)) {
    return { id: "DEALS_DAMAGE_TO_ANY_TARGET", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_N_LIFE_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_N_LIFE", matchedText: text };
  }

  if (SCRY_N_REGEX.test(text)) {
    return { id: "SCRY_N", matchedText: text };
  }

  if (SCRY_N_THEN_DEALS_M_DAMAGE_TO_EACH_OPPONENT_REGEX.test(text)) {
    return { id: "SCRY_N_THEN_DEALS_M_DAMAGE_TO_EACH_OPPONENT", matchedText: text };
  }

  if (SCRY_N_THEN_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "SCRY_N_THEN_DRAW_A_CARD", matchedText: text };
  }

  if (SCRY_N_IF_YOU_CONTROL_AN_ARTIFACT_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "SCRY_N_IF_YOU_CONTROL_AN_ARTIFACT_DRAW_A_CARD", matchedText: text };
  }

  if (UNTAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE", matchedText: text };
  }

  if (TARGET_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_ARTIFACTS_YOU_CONTROL_REGEX.test(text)) {
    return { id: "TARGET_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_ARTIFACTS_YOU_CONTROL", matchedText: text };
  }

  if (YOU_GET_EMBLEM_REGEX.test(text)) {
    return { id: "YOU_GET_EMBLEM", matchedText: text };
  }

  if (CONTAINS_YOU_GET_EMBLEM_WITH_QUOTED_TEXT_REGEX.test(text)) {
    return { id: "CONTAINS_YOU_GET_EMBLEM_WITH_QUOTED_TEXT_MANUAL", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT", matchedText: text };
  }

  if (UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_AND_HASTE_EOT", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_EOT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_EOT", matchedText: text };
  }

  if (UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_TRAMPLE_EOT", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_EOT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_EOT", matchedText: text };
  }

  if (UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_EOT", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_GET_PT_EOT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_EOT", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_WITH_FLYING_GET_PT_EOT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_WITH_FLYING_GET_PT_EOT", matchedText: text };
  }

  if (UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_EOT", matchedText: text };
  }

  if (
    TAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_FREEZE_REGEX.test(text) ||
    TAP_TARGET_CREATURE_OR_PERMANENT_FREEZE_REGEX.test(text) ||
    TAP_UP_TO_TWO_TARGET_NONLAND_PERMANENTS_FREEZE_REGEX.test(text)
  ) {
    return { id: "TAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_FREEZE", matchedText: text };
  }

  if (TAP_TARGET_CREATURE_PUT_TWO_STUN_COUNTERS_REGEX.test(text)) {
    return { id: "TAP_TARGET_CREATURE_PUT_TWO_STUN_COUNTERS", matchedText: text };
  }

  if (TAP_TARGET_PERMANENT_THEN_UNTAP_ANOTHER_TARGET_PERMANENT_REGEX.test(text)) {
    return { id: "TAP_TARGET_PERMANENT_THEN_UNTAP_ANOTHER_TARGET_PERMANENT", matchedText: text };
  }

  if (UNTAP_UP_TO_N_TARGET_PERMANENTS_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_N_TARGET_PERMANENTS", matchedText: text };
  }

  if (UNTAP_TWO_TARGET_LANDS_REGEX.test(text)) {
    return { id: "UNTAP_TWO_TARGET_LANDS", matchedText: text };
  }

  if (UP_TO_ONE_TARGET_CREATURE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) {
    return { id: "UP_TO_ONE_TARGET_CREATURE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN", matchedText: text };
  }

  if (EACH_OPPONENT_DISCARDS_N_AND_LOSES_M_LIFE_REGEX.test(text)) {
    return { id: "EACH_OPPONENT_DISCARDS_N_AND_LOSES_M_LIFE", matchedText: text };
  }

  if (EACH_OPPONENT_DISCARDS_A_CARD_AND_YOU_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "EACH_OPPONENT_DISCARDS_A_CARD_AND_YOU_DRAW_A_CARD", matchedText: text };
  }

  if (EACH_OPPONENT_LOSES_N_LIFE_AND_YOU_GAIN_N_LIFE_REGEX.test(text)) {
    return { id: "EACH_OPPONENT_LOSES_N_LIFE_AND_YOU_GAIN_N_LIFE", matchedText: text };
  }

  if (PUT_P1P1_ON_UP_TO_ONE_TARGET_SUBTYPE_YOU_CONTROL_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_SUBTYPE_YOU_CONTROL", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_GET_PT_EOT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GET_PT_EOT", matchedText: text };
  }

  if (SUBTYPE_YOU_CONTROL_GET_PT_EOT_REGEX.test(text)) {
    return { id: "SUBTYPE_YOU_CONTROL_GET_PT_EOT", matchedText: text };
  }

  if (GAIN_LIFE_SELF_REGEX.test(text)) {
    return { id: "GAIN_LIFE_SELF", matchedText: text };
  }

  if (LOSE_LIFE_SELF_REGEX.test(text)) {
    return { id: "LOSE_LIFE_SELF", matchedText: text };
  }

  if (UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT_REGEX.test(text)) {
    return { id: "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_PT", matchedText: text };
  }

  if (UP_TO_ONE_TARGET_CREATURE_GETS_PT_UNTIL_YOUR_NEXT_TURN_REGEX.test(text)) {
    return { id: "UP_TO_ONE_TARGET_CREATURE_GETS_PT_UNTIL_YOUR_NEXT_TURN", matchedText: text };
  }

  if (UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS3_MINUS0_AND_ITS_ACTIVATED_ABILITIES_CANT_BE_ACTIVATED_REGEX.test(text)) {
    return {
      id: "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GETS_MINUS3_MINUS0_AND_ITS_ACTIVATED_ABILITIES_CANT_BE_ACTIVATED",
      matchedText: text,
    };
  }

  if (UNTIL_YOUR_NEXT_TURN_UP_TO_TWO_TARGET_CREATURES_HAVE_BASE_POWER_AND_TOUGHNESS_0_3_AND_LOSE_ALL_ABILITIES_REGEX.test(text)) {
    return {
      id: "UNTIL_YOUR_NEXT_TURN_UP_TO_TWO_TARGET_CREATURES_HAVE_BASE_POWER_AND_TOUGHNESS_0_3_AND_LOSE_ALL_ABILITIES",
      matchedText: text,
    };
  }

  if (TARGET_CREATURE_BECOMES_A_TREASURE_ARTIFACT_WITH_TREASURE_ABILITY_AND_LOSES_ALL_OTHER_CARD_TYPES_AND_ABILITIES_REGEX.test(text)) {
    return {
      id: "TARGET_CREATURE_BECOMES_A_TREASURE_ARTIFACT_WITH_TREASURE_ABILITY_AND_LOSES_ALL_OTHER_CARD_TYPES_AND_ABILITIES",
      matchedText: text,
    };
  }

  if (TARGET_ARTIFACT_OR_CREATURE_LOSES_ALL_ABILITIES_AND_BECOMES_A_GREEN_ELK_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_3_3_REGEX.test(text)) {
    return {
      id: "TARGET_ARTIFACT_OR_CREATURE_LOSES_ALL_ABILITIES_AND_BECOMES_A_GREEN_ELK_CREATURE_WITH_BASE_POWER_AND_TOUGHNESS_3_3",
      matchedText: text,
    };
  }

  if (WHENEVER_A_CREATURE_ATTACKS_THIS_TURN_PUT_A_P1P1_COUNTER_ON_IT_REGEX.test(text)) {
    return { id: "WHENEVER_A_CREATURE_ATTACKS_THIS_TURN_PUT_A_P1P1_COUNTER_ON_IT", matchedText: text };
  }

  if (UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_DEALS_COMBAT_DAMAGE_TO_VRASKA_DESTROY_THAT_CREATURE_REGEX.test(text)) {
    return {
      id: "UNTIL_YOUR_NEXT_TURN_WHENEVER_A_CREATURE_DEALS_COMBAT_DAMAGE_TO_VRASKA_DESTROY_THAT_CREATURE",
      matchedText: text,
    };
  }

  if (GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_EOT_UNTAP_HASTE_SAC_NEXT_END_STEP_IF_MV_LE_3_REGEX.test(text)) {
    return {
      id: "GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_END_OF_TURN_UNTAP_IT_IT_GAINS_HASTE_UNTIL_END_OF_TURN_SACRIFICE_IT_AT_THE_BEGINNING_OF_THE_NEXT_END_STEP_IF_ITS_MANA_VALUE_IS_3_OR_LESS",
      matchedText: text,
    };
  }

  if (GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_EOT_UNTAP_HASTE_REGEX.test(text)) {
    return {
      id: "GAIN_CONTROL_OF_TARGET_CREATURE_UNTIL_END_OF_TURN_UNTAP_IT_IT_GAINS_HASTE_UNTIL_END_OF_TURN",
      matchedText: text,
    };
  }

  if (GAIN_CONTROL_OF_ALL_CREATURES_TARGET_OPPONENT_CONTROLS_REGEX.test(text)) {
    return { id: "GAIN_CONTROL_OF_ALL_CREATURES_TARGET_OPPONENT_CONTROLS", matchedText: text };
  }

  if (EXILE_EACH_NONLAND_PERMANENT_YOUR_OPPONENTS_CONTROL_REGEX.test(text)) {
    return { id: "EXILE_EACH_NONLAND_PERMANENT_YOUR_OPPONENTS_CONTROL", matchedText: text };
  }

  if (GAIN_CONTROL_OF_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "GAIN_CONTROL_OF_TARGET_CREATURE", matchedText: text };
  }

  if (GAIN_CONTROL_OF_TARGET_ARTIFACT_REGEX.test(text)) {
    return { id: "GAIN_CONTROL_OF_TARGET_ARTIFACT", matchedText: text };
  }

  if (EACH_PLAYER_DISCARDS_A_CARD_REGEX.test(text)) {
    return { id: "EACH_PLAYER_DISCARDS_A_CARD", matchedText: text };
  }

  if (REVEAL_TOP_CARD_PUT_INTO_HAND_EACH_OPPONENT_LOSES_LIFE_EQUAL_MV_REGEX.test(text)) {
    return { id: "REVEAL_TOP_CARD_PUT_INTO_HAND_EACH_OPPONENT_LOSES_LIFE_EQUAL_MV", matchedText: text };
  }

  if (DISCARD_ALL_CARDS_THEN_DRAW_THAT_MANY_PLUS_ONE_REGEX.test(text)) {
    return { id: "DISCARD_ALL_CARDS_THEN_DRAW_THAT_MANY_PLUS_ONE", matchedText: text };
  }

  if (EACH_OPPONENT_LOSES_LIFE_EQUAL_CARDS_IN_GRAVEYARD_REGEX.test(text)) {
    return { id: "EACH_OPPONENT_LOSES_LIFE_EQUAL_CARDS_IN_GRAVEYARD", matchedText: text };
  }

  if (TARGET_PLAYER_MILLS_THREE_THEN_DRAW_DEPENDING_GRAVEYARD_20_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_MILLS_THREE_THEN_DRAW_DEPENDING_GRAVEYARD_20", matchedText: text };
  }

  if (DEAL_X_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_AND_GAIN_X_LIFE_REGEX.test(text)) {
    return { id: "DEAL_X_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_AND_GAIN_X_LIFE", matchedText: text };
  }

  if (UNTAP_UP_TO_ONE_TARGET_CREATURE_AND_UP_TO_ONE_TARGET_LAND_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_ONE_TARGET_CREATURE_AND_UP_TO_ONE_TARGET_LAND", matchedText: text };
  }

  if (UNTAP_UP_TO_TWO_TARGET_CREATURES_AND_UP_TO_TWO_TARGET_LANDS_REGEX.test(text)) {
    return { id: "UNTAP_UP_TO_TWO_TARGET_CREATURES_AND_UP_TO_TWO_TARGET_LANDS", matchedText: text };
  }

  if (EXILE_TARGET_TAPPED_CREATURE_YOU_GAIN_2_LIFE_REGEX.test(text)) {
    return { id: "EXILE_TARGET_TAPPED_CREATURE_YOU_GAIN_2_LIFE", matchedText: text };
  }

  if (PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_FIRST_STRIKE_EOT_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_FIRST_STRIKE_EOT", matchedText: text };
  }

  if (PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_VIGILANCE_EOT_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_VIGILANCE_EOT", matchedText: text };
  }

  if (TARGET_CREATURE_YOU_CONTROL_FIGHTS_ANOTHER_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "TARGET_CREATURE_YOU_CONTROL_FIGHTS_ANOTHER_TARGET_CREATURE", matchedText: text };
  }

  if (TARGET_CREATURE_YOU_CONTROL_FIGHTS_TARGET_CREATURE_YOU_DONT_CONTROL_REGEX.test(text)) {
    return { id: "TARGET_CREATURE_YOU_CONTROL_FIGHTS_TARGET_CREATURE_YOU_DONT_CONTROL", matchedText: text };
  }

  if (TARGET_SUBTYPE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_YOU_DONT_CONTROL_REGEX.test(text)) {
    return {
      id: "TARGET_SUBTYPE_YOU_CONTROL_DEALS_DAMAGE_EQUAL_TO_ITS_POWER_TO_TARGET_CREATURE_YOU_DONT_CONTROL",
      matchedText: text,
    };
  }

  if (DEALS_X_DAMAGE_TO_EACH_CREATURE_REGEX.test(text)) {
    return { id: "DEALS_X_DAMAGE_TO_EACH_CREATURE", matchedText: text };
  }

  if (EXILE_TARGET_PERMANENT_REGEX.test(text)) {
    return { id: "EXILE_TARGET_PERMANENT", matchedText: text };
  }

  if (EXILE_TARGET_ENCHANTMENT_TAPPED_ARTIFACT_OR_TAPPED_CREATURE_REGEX.test(text)) {
    return { id: "EXILE_TARGET_ENCHANTMENT_TAPPED_ARTIFACT_OR_TAPPED_CREATURE", matchedText: text };
  }

  if (DESTROY_TARGET_NONLAND_PERMANENT_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_NONLAND_PERMANENT", matchedText: text };
  }

  if (DESTROY_TARGET_PERMANENT_THATS_ONE_OR_MORE_COLORS_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_PERMANENT_THATS_ONE_OR_MORE_COLORS", matchedText: text };
  }

  if (YOU_AND_TARGET_OPPONENT_EACH_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "YOU_AND_TARGET_OPPONENT_EACH_DRAW_A_CARD", matchedText: text };
  }

  if (TARGET_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND", matchedText: text };
  }

  if (TARGET_PLAYER_SACRIFICES_A_CREATURE_REGEX.test(text)) {
    return { id: "TARGET_PLAYER_SACRIFICES_A_CREATURE", matchedText: text };
  }

  if (RETURN_UP_TO_TWO_TARGET_CREATURES_TO_THEIR_OWNERS_HANDS_REGEX.test(text)) {
    return { id: "RETURN_UP_TO_TWO_TARGET_CREATURES_TO_THEIR_OWNERS_HANDS", matchedText: text };
  }

  if (PUT_TARGET_CREATURE_ON_TOP_OF_ITS_OWNERS_LIBRARY_REGEX.test(text)) {
    return { id: "PUT_TARGET_CREATURE_ON_TOP_OF_ITS_OWNERS_LIBRARY", matchedText: text };
  }

  if (TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE_REGEX.test(text)) {
    return { id: "TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE", matchedText: text };
  }

  if (TAP_ALL_CREATURES_YOUR_OPPONENTS_CONTROL_TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE_REGEX.test(text)) {
    return { id: "TAP_ALL_CREATURES_YOUR_OPPONENTS_CONTROL_TAKE_AN_EXTRA_TURN_AFTER_THIS_ONE", matchedText: text };
  }

  if (DEALS_N_DAMAGE_TO_EACH_OPPONENT_REGEX.test(text)) {
    return { id: "DEALS_N_DAMAGE_TO_EACH_OPPONENT", matchedText: text };
  }

  if (RETURN_UP_TO_ONE_TARGET_LAND_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX.test(text)) {
    return { id: "RETURN_UP_TO_ONE_TARGET_LAND_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND", matchedText: text };
  }

  if (RETURN_TARGET_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX.test(text)) {
    return { id: "RETURN_TARGET_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND", matchedText: text };
  }

  if (RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_THEN_THAT_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND_REGEX.test(text)) {
    return {
      id: "RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_THEN_THAT_PLAYER_EXILES_A_CARD_FROM_THEIR_HAND",
      matchedText: text,
    };
  }

  if (RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND_REGEX.test(text)) {
    return { id: "RETURN_TARGET_NONLAND_PERMANENT_TO_OWNERS_HAND", matchedText: text };
  }

  const mReturnCreatureFromGYToBattlefield = text.match(RETURN_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX);
  if (mReturnCreatureFromGYToBattlefield) {
    return {
      id: "RETURN_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD",
      matchedText: text,
    };
  }

  const mReturnSubtypeFromGYToBattlefield = text.match(RETURN_TARGET_SUBTYPE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX);
  if (mReturnSubtypeFromGYToBattlefield) {
    return {
      id: "RETURN_TARGET_SUBTYPE_CARD_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD",
      matchedText: text,
    };
  }

  if (LOOK_AT_TOP_CARD_IF_ITS_A_CREATURE_CARD_YOU_MAY_REVEAL_PUT_INTO_HAND_REGEX.test(text)) {
    return { id: "LOOK_AT_TOP_CARD_IF_ITS_A_CREATURE_CARD_YOU_MAY_REVEAL_PUT_INTO_HAND", matchedText: text };
  }

  if (CREATE_FRACTAL_0_0_PUT_X_P1P1_COUNTERS_ON_IT_REGEX.test(text)) {
    return { id: "CREATE_FRACTAL_0_0_PUT_X_P1P1_COUNTERS_ON_IT", matchedText: text };
  }

  if (SURVEIL_N_REGEX.test(text)) {
    return { id: "SURVEIL_N", matchedText: text };
  }

  if (REVEAL_CARDS_UNTIL_ARTIFACT_PUT_INTO_HAND_REST_BOTTOM_RANDOM_REGEX.test(text)) {
    return { id: "REVEAL_CARDS_UNTIL_ARTIFACT_PUT_INTO_HAND_REST_BOTTOM_RANDOM", matchedText: text };
  }

  if (EACH_PLAYER_SHUFFLES_HAND_AND_GRAVEYARD_INTO_LIBRARY_YOU_DRAW_SEVEN_REGEX.test(text)) {
    return { id: "EACH_PLAYER_SHUFFLES_HAND_AND_GRAVEYARD_INTO_LIBRARY_YOU_DRAW_SEVEN", matchedText: text };
  }

  if (RETURN_UP_TO_TWO_TARGET_LAND_CARDS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD_REGEX.test(text)) {
    return { id: "RETURN_UP_TO_TWO_TARGET_LAND_CARDS_FROM_YOUR_GRAVEYARD_TO_THE_BATTLEFIELD", matchedText: text };
  }

  if (DISCARD_A_CARD_THEN_DRAW_A_CARD_IF_LAND_DISCARDED_DRAW_AN_ADDITIONAL_CARD_REGEX.test(text)) {
    return { id: "DISCARD_A_CARD_THEN_DRAW_A_CARD_IF_LAND_DISCARDED_DRAW_AN_ADDITIONAL_CARD", matchedText: text };
  }

  if (ATTACH_THIS_EQUIPMENT_TO_UP_TO_ONE_TARGET_CREATURE_YOU_CONTROL_REGEX.test(text)) {
    return { id: "ATTACH_THIS_EQUIPMENT_TO_UP_TO_ONE_TARGET_CREATURE_YOU_CONTROL", matchedText: text };
  }

  if (SURVEIL_N_THEN_EXILE_A_CARD_FROM_A_GRAVEYARD_REGEX.test(text)) {
    return { id: "SURVEIL_N_THEN_EXILE_A_CARD_FROM_A_GRAVEYARD", matchedText: text };
  }

  if (UNTAP_TARGET_ARTIFACT_OR_CREATURE_IF_ARTIFACT_CREATURE_P1P1_REGEX.test(text)) {
    return { id: "UNTAP_TARGET_ARTIFACT_OR_CREATURE_IF_ARTIFACT_CREATURE_P1P1", matchedText: text };
  }

  if (YOU_MAY_SACRIFICE_ANOTHER_PERMANENT_IF_YOU_DO_GAIN_LIFE_AND_DRAW_A_CARD_REGEX.test(text)) {
    return { id: "YOU_MAY_SACRIFICE_ANOTHER_PERMANENT_IF_YOU_DO_GAIN_LIFE_AND_DRAW_A_CARD", matchedText: text };
  }

  if (YOU_GAIN_LIFE_THEN_PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "YOU_GAIN_LIFE_THEN_PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_CREATURE", matchedText: text };
  }

  if (EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_REGEX.test(text)) {
    return { id: "EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE", matchedText: text };
  }

  if (EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_EQUAL_TO_ITS_POWER_REGEX.test(text)) {
    return { id: "EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_EQUAL_TO_ITS_POWER", matchedText: text };
  }

  if (DESTROY_TARGET_CREATURE_ITS_CONTROLLER_DRAWS_N_CARDS_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_CREATURE_ITS_CONTROLLER_DRAWS_N_CARDS", matchedText: text };
  }

  if (CREATURES_YOU_CONTROL_GAIN_FLYING_AND_DOUBLE_STRIKE_EOT_REGEX.test(text)) {
    return { id: "CREATURES_YOU_CONTROL_GAIN_FLYING_AND_DOUBLE_STRIKE_EOT", matchedText: text };
  }

  if (UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GAINS_VIGILANCE_AND_REACH_REGEX.test(text)) {
    return { id: "UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GAINS_VIGILANCE_AND_REACH", matchedText: text };
  }

  if (PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_SUBTYPE_UNTAP_IT_IT_GAINS_DEATHTOUCH_EOT_REGEX.test(text)) {
    return { id: "PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_SUBTYPE_UNTAP_IT_IT_GAINS_DEATHTOUCH_EOT", matchedText: text };
  }

  if (PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING_REGEX.test(text)) {
    return {
      id: "PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING",
      matchedText: text,
    };
  }

  if (EACH_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_CREATURE_CARDS_IN_YOUR_GRAVEYARD_REGEX.test(text)) {
    return { id: "EACH_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_CREATURE_CARDS_IN_YOUR_GRAVEYARD", matchedText: text };
  }

  if (EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_CAST_THAT_CARD_IF_YOU_DONT_DEALS_DAMAGE_TO_EACH_OPPONENT_REGEX.test(text)) {
    return {
      id: "EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_CAST_THAT_CARD_IF_YOU_DONT_DEALS_DAMAGE_TO_EACH_OPPONENT",
      matchedText: text,
    };
  }

  if (EACH_OPPONENT_LOSES_1_YOU_GAIN_LIFE_EQUAL_TO_THE_LIFE_LOST_THIS_WAY_REGEX.test(text)) {
    return { id: "EACH_OPPONENT_LOSES_1_YOU_GAIN_LIFE_EQUAL_TO_THE_LIFE_LOST_THIS_WAY", matchedText: text };
  }

  if (EXILE_TOP_N_CARDS_OF_TARGET_OPPONENTS_LIBRARY_REGEX.test(text)) {
    return { id: "EXILE_TOP_N_CARDS_OF_TARGET_OPPONENTS_LIBRARY", matchedText: text };
  }

  if (DESTROY_TARGET_PLANESWALKER_REGEX.test(text)) {
    return { id: "DESTROY_TARGET_PLANESWALKER", matchedText: text };
  }

  if (DESTROY_ALL_NON_ZOMBIE_CREATURES_REGEX.test(text)) {
    return { id: "DESTROY_ALL_NON_ZOMBIE_CREATURES", matchedText: text };
  }

  if (DESTROY_ALL_LANDS_TARGET_PLAYER_CONTROLS_REGEX.test(text)) {
    return { id: "DESTROY_ALL_LANDS_TARGET_PLAYER_CONTROLS", matchedText: text };
  }

  if (EXILE_ALL_CARDS_FROM_TARGET_PLAYERS_LIBRARY_THEN_SHUFFLE_HAND_INTO_LIBRARY_REGEX.test(text)) {
    return { id: "EXILE_ALL_CARDS_FROM_TARGET_PLAYERS_LIBRARY_THEN_SHUFFLE_HAND_INTO_LIBRARY", matchedText: text };
  }

  if (EXILE_ALL_CARDS_FROM_ALL_OPPONENTS_HANDS_AND_GRAVEYARDS_REGEX.test(text)) {
    return { id: "EXILE_ALL_CARDS_FROM_ALL_OPPONENTS_HANDS_AND_GRAVEYARDS", matchedText: text };
  }

  if (GAIN_CONTROL_OF_ALL_ARTIFACTS_AND_CREATURES_TARGET_OPPONENT_CONTROLS_REGEX.test(text)) {
    return { id: "GAIN_CONTROL_OF_ALL_ARTIFACTS_AND_CREATURES_TARGET_OPPONENT_CONTROLS", matchedText: text };
  }

  if (UNTAP_EACH_ENCHANTED_PERMANENT_YOU_CONTROL_REGEX.test(text)) {
    return { id: "UNTAP_EACH_ENCHANTED_PERMANENT_YOU_CONTROL", matchedText: text };
  }

  if (YOU_GAIN_LIFE_EQUAL_TO_CREATURES_YOU_CONTROL_PLUS_PLANESWALKERS_YOU_CONTROL_REGEX.test(text)) {
    return { id: "YOU_GAIN_LIFE_EQUAL_TO_CREATURES_YOU_CONTROL_PLUS_PLANESWALKERS_YOU_CONTROL", matchedText: text };
  }

  if (SARKHAN_DEALS_1_DAMAGE_TO_EACH_OPPONENT_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL_REGEX.test(text)) {
    return { id: "SARKHAN_DEALS_1_DAMAGE_TO_EACH_OPPONENT_AND_EACH_CREATURE_YOUR_OPPONENTS_CONTROL", matchedText: text };
  }

  if (KOTH_DEALS_DAMAGE_TO_TARGET_CREATURE_EQUAL_TO_NUMBER_OF_MOUNTAINS_YOU_CONTROL_REGEX.test(text)) {
    return { id: "KOTH_DEALS_DAMAGE_TO_TARGET_CREATURE_EQUAL_TO_NUMBER_OF_MOUNTAINS_YOU_CONTROL", matchedText: text };
  }

  if (NAHIRI_DEALS_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_EQUAL_TO_TWICE_NUMBER_OF_EQUIPMENT_YOU_CONTROL_REGEX.test(text)) {
    return { id: "NAHIRI_DEALS_DAMAGE_TO_TARGET_CREATURE_OR_PLANESWALKER_EQUAL_TO_TWICE_NUMBER_OF_EQUIPMENT_YOU_CONTROL", matchedText: text };
  }

  if (NAHIRI_DEALS_X_DAMAGE_TO_TARGET_TAPPED_CREATURE_REGEX.test(text)) {
    return { id: "NAHIRI_DEALS_X_DAMAGE_TO_TARGET_TAPPED_CREATURE", matchedText: text };
  }

  if (SORIN_MARKOV_DEALS_2_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_2_LIFE_REGEX.test(text)) {
    return { id: "SORIN_MARKOV_DEALS_2_DAMAGE_TO_ANY_TARGET_AND_YOU_GAIN_2_LIFE", matchedText: text };
  }

  if (KAYA_DEALS_DAMAGE_TO_TARGET_PLAYER_EQUAL_TO_CARDS_THE_PLAYER_OWNS_IN_EXILE_AND_YOU_GAIN_THAT_MUCH_LIFE_REGEX.test(text)) {
    return {
      id: "KAYA_DEALS_DAMAGE_TO_TARGET_PLAYER_EQUAL_TO_CARDS_THE_PLAYER_OWNS_IN_EXILE_AND_YOU_GAIN_THAT_MUCH_LIFE",
      matchedText: text,
    };
  }

  if (NICOL_BOLAS_DEALS_7_DAMAGE_TO_EACH_OPPONENT_YOU_DRAW_SEVEN_CARDS_REGEX.test(text)) {
    return { id: "NICOL_BOLAS_DEALS_7_DAMAGE_TO_EACH_OPPONENT_YOU_DRAW_SEVEN_CARDS", matchedText: text };
  }

  if (NICOL_BOLAS_DEALS_7_DAMAGE_TO_TARGET_OPPONENT_CREATURE_OR_PLANESWALKER_AN_OPPONENT_CONTROLS_REGEX.test(text)) {
    return {
      id: "NICOL_BOLAS_DEALS_7_DAMAGE_TO_TARGET_OPPONENT_CREATURE_OR_PLANESWALKER_AN_OPPONENT_CONTROLS",
      matchedText: text,
    };
  }

  if (CHANDRA_DEALS_3_DAMAGE_TO_EACH_NON_ELEMENTAL_CREATURE_REGEX.test(text)) {
    return { id: "CHANDRA_DEALS_3_DAMAGE_TO_EACH_NON_ELEMENTAL_CREATURE", matchedText: text };
  }

  const mChandraDealsN = text.match(
    CHANDRA_DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER_AND_EACH_CREATURE_THAT_PLAYER_OR_THAT_PLANESWALKERS_CONTROLLER_CONTROLS_REGEX
  );
  if (mChandraDealsN) {
    return {
      id: "CHANDRA_DEALS_N_DAMAGE_TO_TARGET_PLAYER_OR_PLANESWALKER_AND_EACH_CREATURE_THAT_PLAYER_OR_THAT_PLANESWALKERS_CONTROLLER_CONTROLS",
      matchedText: text,
    };
  }

  if (CHANDRA_NALAAR_DEALS_X_DAMAGE_TO_TARGET_CREATURE_REGEX.test(text)) {
    return { id: "CHANDRA_NALAAR_DEALS_X_DAMAGE_TO_TARGET_CREATURE", matchedText: text };
  }

  if (YOU_GET_AN_ADVENTURING_PARTY_REGEX.test(text)) {
    return { id: "YOU_GET_AN_ADVENTURING_PARTY", matchedText: text };
  }

  if (AMASS_ZOMBIES_N_REGEX.test(text)) {
    return { id: "AMASS_ZOMBIES_N", matchedText: text };
  }

  if (DESTROY_UP_TO_SIX_TARGET_NONLAND_PERMANENTS_THEN_CREATE_SIX_CAT_WARRIOR_TOKENS_WITH_FORESTWALK_REGEX.test(text)) {
    return {
      id: "DESTROY_UP_TO_SIX_TARGET_NONLAND_PERMANENTS_THEN_CREATE_SIX_CAT_WARRIOR_TOKENS_WITH_FORESTWALK",
      matchedText: text,
    };
  }

  if (PUT_THREE_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_THOSE_CREATURES_GAIN_TRAMPLE_EOT_REGEX.test(text)) {
    return {
      id: "PUT_THREE_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_THOSE_CREATURES_GAIN_TRAMPLE_EOT",
      matchedText: text,
    };
  }

  if (ROWAN_DEALS_1_DAMAGE_TO_EACH_OF_UP_TO_TWO_TARGET_CREATURES_THOSE_CREATURES_CANT_BLOCK_THIS_TURN_REGEX.test(text)) {
    return {
      id: "ROWAN_DEALS_1_DAMAGE_TO_EACH_OF_UP_TO_TWO_TARGET_CREATURES_THOSE_CREATURES_CANT_BLOCK_THIS_TURN",
      matchedText: text,
    };
  }

  if (RETURN_UP_TO_ONE_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND_REGEX.test(text)) {
    return { id: "RETURN_UP_TO_ONE_TARGET_CREATURE_CARD_FROM_YOUR_GRAVEYARD_TO_YOUR_HAND", matchedText: text };
  }

  // Fallback: only enabled explicitly (used by coverage tooling).
  if (options?.allowFallback && text.trim().length > 0) {
    return { id: "FALLBACK_MANUAL_RESOLUTION", matchedText: text };
  }

  return null;
}
