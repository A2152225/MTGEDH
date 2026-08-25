// server/src/state/planeswalker/templates/registry-handlers/planeswalkerTemplatePumpHandCounterManaRegexes.ts
// Origin parent: server/src/state/planeswalker/templates/registry.ts
// Cluster moved: creature-pump / put-from-hand / counters / mana loyalty regex tables
// Public entry symbols: UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_REGEX, plus 83 sibling regex tables

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

export {
  UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_AND_GAIN_FLYING_REGEX,
  CREATURES_YOU_CONTROL_GET_PT_EOT_REGEX,
  CREATURES_YOU_CONTROL_WITH_FLYING_GET_PT_EOT_REGEX,
  UNTIL_END_OF_TURN_CREATURES_YOU_CONTROL_GET_PT_REGEX,
  SUBTYPE_YOU_CONTROL_GET_PT_EOT_REGEX,
  UNTAP_UP_TO_N_TARGET_PERMANENTS_REGEX,
  UNTAP_TWO_TARGET_LANDS_REGEX,
  UP_TO_ONE_TARGET_CREATURE_CANT_ATTACK_OR_BLOCK_UNTIL_YOUR_NEXT_TURN_REGEX,
  EACH_OPPONENT_DISCARDS_N_AND_LOSES_M_LIFE_REGEX,
  PUT_P1P1_ON_UP_TO_ONE_TARGET_SUBTYPE_YOU_CONTROL_REGEX,
  TAP_UP_TO_ONE_TARGET_ARTIFACT_OR_CREATURE_FREEZE_REGEX,
  TAP_TARGET_CREATURE_OR_PERMANENT_FREEZE_REGEX,
  TAP_UP_TO_TWO_TARGET_NONLAND_PERMANENTS_FREEZE_REGEX,
  TAP_TARGET_CREATURE_PUT_TWO_STUN_COUNTERS_REGEX,
  TAP_TARGET_PERMANENT_THEN_UNTAP_ANOTHER_TARGET_PERMANENT_REGEX,
  CREATE_GREEN_TREEFOLK_TOKEN_REACH_PT_EQUALS_LANDS_YOU_CONTROL_REGEX,
  CREATE_BLUE_DOG_ILLUSION_TOKEN_PT_EQUALS_TWICE_CARDS_IN_HAND_REGEX,
  CREATE_WHITE_AVATAR_TOKEN_PT_EQUALS_YOUR_LIFE_TOTAL_REGEX,
  CREATE_MASK_AURA_TOKEN_ATTACHED_TO_TARGET_PERMANENT_REGEX,
  CREATE_STONEFORGED_BLADE_EQUIPMENT_TOKEN_REGEX,
  CREATE_TWO_NONLEGENDARY_TOKEN_COPIES_OF_SOURCE_PLANESWALKER_REGEX,
  CREATE_TOKEN_BASIC_REGEX,
  CREATE_2_2_BLACK_ZOMBIE_TOKEN_MILL_TWO_REGEX,
  CREATE_2_2_BLUE_WIZARD_TOKEN_DRAW_THEN_DISCARD_REGEX,
  CREATE_1_1_HUMAN_WIZARD_TOKEN_ALL_COLORS_REGEX,
  CREATE_1_1_WHITE_KOR_SOLDIER_TOKEN_MAY_ATTACH_EQUIPMENT_REGEX,
  CREATE_X_1_1_RED_DEVIL_TOKENS_WHEN_DIES_DEAL_1_DAMAGE_REGEX,
  CREATE_X_X_GREEN_PHYREXIAN_HORROR_TOKEN_WHERE_X_IS_SOURCE_LOYALTY_REGEX,
  CREATE_TOKEN_COPY_TARGET_CREATURE_EXCEPT_HASTE_SAC_AT_END_STEP_REGEX,
  HEAD_TO_ASKURZA_COM_AND_CLICK_N_REGEX,
  ACCEPT_ONE_OF_DAVRIELS_OFFERS_THEN_ACCEPT_ONE_OF_DAVRIELS_CONDITIONS_REGEX,
  CHOOSE_LEFT_OR_RIGHT_UNTIL_YOUR_NEXT_TURN_ATTACK_NEAREST_OPPONENT_REGEX,
  CHOOSE_LEFT_OR_RIGHT_EACH_PLAYER_GAINS_CONTROL_NONLAND_PERMANENTS_REGEX,
  TARGET_CREATURE_AN_OPPONENT_CONTROLS_PERPETUALLY_GETS_MINUS3_MINUS3_REGEX,
  UNTAP_UP_TO_ONE_TARGET_ELF_THAT_ELF_AND_RANDOM_ELF_IN_HAND_PERPETUALLY_GET_P1P1_REGEX,
  SEEK_AN_ELF_CARD_REGEX,
  CONJURE_A_CARD_NAMED_ONTO_THE_BATTLEFIELD_REGEX,
  CONJURE_A_CARD_NAMED_INTO_YOUR_HAND_REGEX,
  DRAFT_A_CARD_FROM_SPELLBOOK_AND_PUT_IT_ONTO_THE_BATTLEFIELD_REGEX,
  ADD_RR_DRAFT_A_CARD_FROM_SPELLBOOK_THEN_EXILE_YOU_MAY_CAST_IT_THIS_TURN_REGEX,
  ROLL_A_D20_SKIP_NEXT_TURN_OR_DRAW_A_CARD_REGEX,
  OPEN_SEALED_KAMIGAWA_BOOSTER_PACK_AND_DRAFT_TWO_REGEX,
  CHOOSE_CREATURE_CARD_IN_HAND_PERPETUALLY_GETS_P1P1_AND_COSTS_1_LESS_REGEX,
  DRAGON_CARDS_IN_HAND_PERPETUALLY_GAIN_COST_REDUCTION_AND_PAY_X_REGEX,
  UP_TO_ONE_TARGET_CREATURE_BASE_POWER_PERPETUALLY_BECOMES_TOUGHNESS_AND_GAINS_ATTACK_NO_DEFENDER_REGEX,
  CREATE_3_3_GREEN_BEAST_TOKEN_THEN_IF_OPPONENT_CONTROLS_MORE_CREATURES_PUT_LOYALTY_COUNTER_ON_SOURCE_REGEX,
  CREATE_3_3_GREEN_BEAST_TOKEN_CHOOSE_VIGILANCE_REACH_TRAMPLE_COUNTER_REGEX,
  CREATE_NAMED_TOKEN_WITH_ABILITIES_REGEX,
  REVEAL_TOP_TWO_OPPONENT_CHOSES_ONE_HAND_EXILE_SILVER_REGEX,
  PUT_A_CARD_YOU_OWN_WITH_A_SILVER_COUNTER_ON_IT_FROM_EXILE_INTO_YOUR_HAND_REGEX,
  YOU_MAY_PUT_A_SUBTYPE_CREATURE_CARD_WITH_MANA_VALUE_N_OR_LESS_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD_REGEX,
  YOU_MAY_PUT_A_COLOR_OR_SUBTYPE_CREATURE_CARD_FROM_YOUR_HAND_ONTO_THE_BATTLEFIELD_REGEX,
  YOU_MAY_PUT_AN_ARTIFACT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_REGEX,
  YOU_MAY_PUT_AN_EQUIPMENT_CARD_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_REGEX,
  YOU_MAY_PUT_A_CREATURE_CARD_WITH_MANA_VALUE_LESS_THAN_OR_EQUAL_TO_LANDS_YOU_CONTROL_FROM_YOUR_HAND_OR_GRAVEYARD_ONTO_THE_BATTLEFIELD_WITH_TWO_P1P1_COUNTERS_REGEX,
  YOU_GAIN_N_LIFE_FOR_EACH_SUBTYPE_YOU_CONTROL_REGEX,
  YOU_MAY_SACRIFICE_ANOTHER_PERMANENT_IF_YOU_DO_GAIN_LIFE_AND_DRAW_A_CARD_REGEX,
  YOU_GAIN_LIFE_THEN_PUT_P1P1_COUNTERS_ON_UP_TO_ONE_TARGET_CREATURE_REGEX,
  EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_REGEX,
  EXILE_TARGET_CREATURE_ITS_CONTROLLER_GAINS_LIFE_EQUAL_TO_ITS_POWER_REGEX,
  DESTROY_TARGET_CREATURE_ITS_CONTROLLER_DRAWS_N_CARDS_REGEX,
  CREATURES_YOU_CONTROL_GAIN_FLYING_AND_DOUBLE_STRIKE_EOT_REGEX,
  UNTIL_YOUR_NEXT_TURN_UP_TO_ONE_TARGET_CREATURE_GAINS_VIGILANCE_AND_REACH_REGEX,
  PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_SUBTYPE_UNTAP_IT_IT_GAINS_DEATHTOUCH_EOT_REGEX,
  PUT_P1P1_COUNTERS_ON_TARGET_CREATURE_IT_BECOMES_AN_ANGEL_IN_ADDITION_TO_ITS_OTHER_TYPES_AND_GAINS_FLYING_REGEX,
  PUT_P1P1_COUNTER_ON_EACH_CREATURE_YOU_CONTROL_REGEX,
  PUT_MINUS1_MINUS1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_REGEX,
  PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_MENACE_EOT_REGEX,
  PUT_P1P1_COUNTER_ON_UP_TO_ONE_TARGET_CREATURE_IT_GAINS_INDESTRUCTIBLE_EOT_REGEX,
  PUT_A_LOYALTY_COUNTER_ON_EACH_COLOR_PLANESWALKER_YOU_CONTROL_REGEX,
  PUT_N_P1P1_COUNTERS_ON_EACH_CREATURE_YOU_CONTROL_AND_N_LOYALTY_COUNTERS_ON_EACH_OTHER_PLANESWALKER_YOU_CONTROL_REGEX,
  PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_YOU_CONTROL_REGEX,
  PUT_LOYALTY_COUNTERS_ON_SOURCE_FOR_EACH_CREATURE_TARGET_OPPONENT_CONTROLS_REGEX,
  EACH_OPPONENT_LOSES_LIFE_EQUAL_TO_NUMBER_OF_CREATURE_CARDS_IN_YOUR_GRAVEYARD_REGEX,
  EXILE_TOP_CARD_OF_YOUR_LIBRARY_YOU_MAY_CAST_THAT_CARD_IF_YOU_DONT_DEALS_DAMAGE_TO_EACH_OPPONENT_REGEX,
  ADD_RESTRICTED_MANA_SPEND_ONLY_REGEX,
  ADD_TWO_MANA_ANY_COMBINATION_SPEND_ONLY_DRAGONS_REGEX,
  ADD_TWO_MANA_ANY_COMBINATION_REGEX,
  ADD_TEN_MANA_ANY_ONE_COLOR_REGEX,
  ADD_MANA_SYMBOL_FOR_EACH_PLANESWALKER_YOU_CONTROL_REGEX,
  ADD_MANA_SYMBOL_FOR_EACH_BASIC_LAND_TYPE_YOU_CONTROL_REGEX,
  PAY_ANY_AMOUNT_LOOK_AT_THAT_MANY_PUT_ONE_HAND_REST_BOTTOM_RANDOM_REGEX,
  CAST_SORCERY_SPELLS_AS_THOUGH_THEY_HAD_FLASH_UNTIL_YOUR_NEXT_TURN_REGEX,
  PREVENT_ALL_DAMAGE_TO_AND_DEALT_BY_TARGET_OPPONENT_PERMANENT_UNTIL_YOUR_NEXT_TURN_REGEX,
};
