import type { OracleEffectStep } from './oracleIR';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'’-]*?(?:'s|’s)? (?:controller|owner))\\s+)?";

const COUNTER_AMOUNT_PATTERN = '(?:a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const REFERENCEABLE_COUNTER_AMOUNT_PATTERN = '(?:that many|that much|a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

function parseManaChoiceList(raw: string): string[] {
  const matches = String(raw || '').match(/\{[^}]+\}/g);
  return Array.isArray(matches) ? matches.map(symbol => String(symbol || '').trim()).filter(Boolean) : [];
}

function parseSmallNumber(raw: string): number | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);

  switch (normalized) {
    case 'a':
    case 'an':
    case 'one':
      return 1;
    case 'two':
      return 2;
    case 'three':
      return 3;
    case 'four':
      return 4;
    case 'five':
      return 5;
    case 'six':
      return 6;
    case 'seven':
      return 7;
    case 'eight':
      return 8;
    case 'nine':
      return 9;
    case 'ten':
      return 10;
    case 'eleven':
      return 11;
    case 'twelve':
      return 12;
    default:
      return null;
  }
}

function buildRepeatedMana(symbol: string, count: number): string {
  const n = Math.max(0, Number(count) || 0);
  return Array.from({ length: n }, () => symbol).join('');
}

function countEnergySymbols(raw: string): number {
  const matches = String(raw || '').match(/\{E\}/gi);
  return Array.isArray(matches) ? matches.length : 0;
}

function countTicketSymbols(raw: string): number {
  const matches = String(raw || '').match(/\{TK\}/gi);
  return Array.isArray(matches) ? matches.length : 0;
}

function normalizePossessiveObjectReference(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (/^its$/i.test(trimmed)) return 'it';
  return trimmed.replace(/(?:'s|’s)$/i, '').trim();
}

export function tryParseSimpleActionClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const putSticker = clause.match(/^(?:you\s+may\s+)?put\s+(?:a|an)\s+((?:(?:name|art|ability|power\s+and\s+toughness|power\/toughness)\s+)?sticker)\s+on\s+(.+)$/i);
    if (putSticker) {
      return withMeta({
        kind: 'put_sticker',
        sticker: parseObjectSelector(putSticker[1]),
        target: parseObjectSelector(putSticker[2]),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    const searchBattlefieldMultiple = clause.match(
      new RegExp(
        `^search your library for up to (${COUNTER_AMOUNT_PATTERN}) (.+?) cards,\\s*(reveal them,\\s*)?put them onto the battlefield( tapped)?(?: under your control)?(?:,\\s*(?:then\\s+)?shuffle(?: your library)?)?$`,
        'i'
      )
    );
    if (searchBattlefieldMultiple) {
      const maxResults = parseSmallNumber(searchBattlefieldMultiple[1]);
      if (maxResults && maxResults > 0) {
        return withMeta({
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'raw', text: String(searchBattlefieldMultiple[2] || '').trim() },
          destination: 'battlefield',
          revealFound: Boolean(searchBattlefieldMultiple[3]),
          entersTapped: Boolean(searchBattlefieldMultiple[4]),
          shuffle: /\bshuffle\b/i.test(clause) || undefined,
          maxResults,
          raw: rawClause,
        });
      }
    }
  }

  {
    const addTicketCounters = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}get(?:s)?\\s+((?:\\{TK\\})+)\\s*$`, 'i'));
    if (addTicketCounters) {
      const ticketCount = countTicketSymbols(String(addTicketCounters[2] || ''));
      if (ticketCount > 0) {
        return withMeta({
          kind: 'add_player_counter',
          who: parsePlayerSelector(addTicketCounters[1]),
          amount: { kind: 'number', value: ticketCount },
          counter: 'ticket',
          raw: rawClause,
        });
      }
    }
  }

  {
    const becomeAura = clause.match(
      /^(.+?)\s+loses\s+this\s+ability\s+and\s+becomes\s+an?\s+aura\s+enchantment\s+with\s+enchant\s+(.+)$/i
    );
    if (becomeAura) {
      return withMeta({
        kind: 'become_aura',
        target: parseObjectSelector(becomeAura[1]),
        enchant: parseObjectSelector(becomeAura[2]),
        losesThisAbility: true,
        duration: 'until_effect_ends',
        raw: rawClause,
      });
    }
  }

  {
    const searchBattlefield = clause.match(
      /^search your library for (?:up to one |a |an )(.+?) card,\s*(reveal it,\s*)?put (?:it|that card) onto the battlefield( tapped)?(?: under your control)?(?:,\s*(?:then\s+)?shuffle(?: your library)?)?$/i
    );
    if (searchBattlefield) {
      return withMeta({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: String(searchBattlefield[1] || '').trim() },
        destination: 'battlefield',
        revealFound: Boolean(searchBattlefield[2]),
        entersTapped: Boolean(searchBattlefield[3]),
        shuffle: /\bshuffle\b/i.test(clause) || undefined,
        maxResults: 1,
        raw: rawClause,
      });
    }
  }


  {
    const flipCoin = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}flips?\\s+a\\s+coin$`, 'i'));
    if (flipCoin) {
      return withMeta({
        kind: 'flip_coin',
        who: parsePlayerSelector(flipCoin[1]),
        raw: rawClause,
        });
    }
  }

  {
    const rollDie = clause.match(/^roll\s+a\s+d(\d+)$/i);
    if (rollDie) {
      return withMeta({
        kind: 'roll_die',
        who: { kind: 'you' },
        sides: Number.parseInt(String(rollDie[1] || '0'), 10),
        raw: rawClause,
        });
    }
  }

  {
    const rollSixSidedDice = clause.match(
      /^roll\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+six-sided\s+(?:die|dice)$/i
    );
    if (rollSixSidedDice) {
      const count = parseSmallNumber(rollSixSidedDice[1]);
      if (count && count > 0) {
        return withMeta({
          kind: 'roll_die',
          who: { kind: 'you' },
          sides: 6,
          count,
          raw: rawClause,
          });
      }
    }
  }
  {
    const searchTop = clause.match(
      /^search your library for (?:up to one |a |an )(?:(.+?)\s+)?card(?:,\s*reveal it)?,\s*(?:then\s+)?shuffle(?: your library)? and put (?:it|that card) on top$/i
    );
    if (searchTop) {
      return withMeta({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: String(searchTop[1] || '').trim() },
        destination: 'top',
        ...(/reveal it/i.test(clause) ? { revealFound: true } : {}),
        shuffle: true,
        maxResults: 1,
        raw: rawClause,
        });
    }
  }

  {
    const shuffleLibrary = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}shuffle(?:s)?(?:\\s+(?:your|their|his or her)\\s+library)?$`, 'i')
    );
    if (shuffleLibrary) {
      return withMeta({
        kind: 'shuffle_library',
        who: parsePlayerSelector(shuffleLibrary[1]),
        raw: rawClause,
        });
    }
  }

  {
    const addCommanderIdentityMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+color\\s+in\\s+your\\s+commander'?s\\s+color\\s+identity\\s*$`, 'i')
    );
    if (addCommanderIdentityMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addCommanderIdentityMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        manaOptionsScope: 'commander_color_identity',
        requiresChosenMana: true,
        raw: rawClause,
        });
    }
  }

  {
    const addAnyColorMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+(?:one\\s+)?color\\s*$`, 'i'));
    if (addAnyColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAnyColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        raw: rawClause,
        });
    }
  }

  {
    const addAnyOneColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+mana\\s+of\\s+any\\s+one\\s+color\\s*$`, 'i')
    );
    if (addAnyOneColorMana) {
      const manaCount = parseSmallNumber(addAnyOneColorMana[2]);
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyOneColorMana[1]),
          mana: buildRepeatedMana('{W}', manaCount),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }
  }

  {
    const addAnyCombinationColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+colors\\s*$`, 'i')
    );
    if (addAnyCombinationColorMana) {
      const manaCount = parseSmallNumber(addAnyCombinationColorMana[2]);
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyCombinationColorMana[1]),
          mana: buildRepeatedMana('{W}', manaCount),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }
  }

  {
    const chooseColor = clause.match(/^(?:as\s+.+?\s+enters,\s+)?choose\s+a\s+color\s*$/i);
    if (chooseColor) {
      return withMeta({
        kind: 'choose_color',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        raw: rawClause,
        });
    }
  }

  {
    const chooseCreatureType = clause.match(/^(?:as\s+.+?\s+enters,\s+)?choose\s+a\s+creature\s+type\s*$/i);
    if (chooseCreatureType) {
      return withMeta({
        kind: 'choose_creature_type',
        raw: rawClause,
        });
    }
  }

  {
    const chooseBasicLandType = clause.match(/^choose\s+a\s+basic\s+land\s+type\s*$/i);
    if (chooseBasicLandType) {
      return withMeta({
        kind: 'choose_basic_land_type',
        raw: rawClause,
        });
    }
  }

  {
    const chooseCardName = clause.match(/^(?:secretly\s+)?choose\s+a\s+(?:nonland\s+)?card\s+name\s*$/i);
    if (chooseCardName) {
      return withMeta({
        kind: 'choose_card_name',
        raw: rawClause,
        });
    }
  }

  {
    const chooseTargetCreature = clause.match(
      /^choose\s+target\s+creature(?:\s+(you control|an opponent controls|your opponents control))?\s*$/i
    );
    if (chooseTargetCreature) {
      const targetText = chooseTargetCreature[1]
        ? `target creature ${chooseTargetCreature[1].toLowerCase()}`
        : 'target creature';
      return withMeta({
        kind: 'choose_target_creature',
        target: { kind: 'raw', text: targetText },
        raw: rawClause,
        });
    }
  }

  {
    const addChosenColorMana = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+(?:an\\s+additional\\s+)?one\\s+mana\\s+of\\s+(?:the\\s+chosen|that)\\s+color\\s*$`,
        'i'
      )
    );
    if (addChosenColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addChosenColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
        });
    }
  }

  {
    const drawEqualPower = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}draws?\\s+cards?\\s+equal\\s+to\\s+its\\s+power$`, 'i'));
    if (drawEqualPower) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawEqualPower[1]),
        amount: { kind: 'source_power' },
        raw: rawClause,
        });
    }

    const moreCards = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}draws?\\s+(that many|that much|[a-z0-9]+)\\s+more\\s+cards?\\b`, 'i')
    );
    if (moreCards) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(moreCards[1]),
        amount: parseQuantity(moreCards[2]),
        raw: rawClause,
        });
    }

    const draw = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}draws?\\s+(that many|that much|a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i')
    );
    if (draw) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(draw[1]),
        amount: parseQuantity(draw[2]),
        raw: rawClause,
        });
    }

    const drawDefault = clause.match(/^draw\s+(that many|that much|a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (drawDefault) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(drawDefault[1]),
        raw: rawClause,
        });
    }
  }

  {
    const skipNextDrawStep = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her)\\s+(?:next\\s+)?draw\\s+step\\b`, 'i')
    );
    if (skipNextDrawStep) {
      return withMeta({
        kind: 'skip_next_draw_step',
        who: parsePlayerSelector(skipNextDrawStep[1]),
        raw: rawClause,
        });
    }
  }

  {
    const takeExtraTurn = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:take|takes)\\s+an?\\s+extra\\s+turn\\s+after\\s+this\\s+one\\b`, 'i')
    );
    if (takeExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(takeExtraTurn[1]),
        raw: rawClause,
        });
    }
  }

  {
    const addExtraCombat = clause.match(
      /^(?:(?:after|and after)\s+this\s+(?:main\s+)?phase,?\s+there\s+is|there(?:'|’)s|there\s+is)\s+an\s+additional\s+combat\s+phase(?:\s+after\s+this\s+phase)?(?:,?\s+followed\s+by\s+an\s+additional\s+main\s+phase)?$/i
    );
    if (addExtraCombat) {
      return withMeta({
        kind: 'add_extra_combat',
        followedByAdditionalMain: /followed by an additional main phase/i.test(clause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    const gainClassLevel = clause.match(/^level\s+(\d+)\.?$/i);
    if (gainClassLevel) {
      return withMeta({
        kind: 'gain_class_level',
        level: Number.parseInt(String(gainClassLevel[1] || '0'), 10),
        raw: rawClause,
        });
    }
  }

  {
    const gainControlUntilEndOfTurn = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}gain(?:s)?\\s+control\\s+of\\s+(.+?)\\s+until\\s+end\\s+of\\s+turn\\b`, 'i')
    );
    if (gainControlUntilEndOfTurn) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(gainControlUntilEndOfTurn[2]),
        newController: parsePlayerSelector(gainControlUntilEndOfTurn[1]),
        duration: 'until_end_of_turn',
        raw: rawClause,
        });
    }
  }

  {
    const entersGreatestPowerCounters = clause.match(/^(?:.+?\s+enters\s+)?with\s+x\s+\+1\/\+1\s+counters\s+on\s+it,\s*where\s+x\s+is\s+the\s+greatest\s+power\s+among\s+other\s+creatures\s+you\s+control$/i);
    if (entersGreatestPowerCounters) {
      return withMeta({
        kind: 'add_counter',
        amount: { kind: 'greatest_power_among_other_creatures_you_control' },
        counter: '+1/+1',
        target: parseObjectSelector('this creature'),
        raw: rawClause,
        });
    }
  }

  {
    const addCounters = clause.match(new RegExp(`^put\\s+(${REFERENCEABLE_COUNTER_AMOUNT_PATTERN})\\s+(.+?)\\s+counters?\\s+on\\s+(.+)$`, 'i'));
    if (addCounters && !/\bonto\s+the\s+battlefield\b/i.test(clause)) {
      return withMeta({
        kind: 'add_counter',
        amount: parseQuantity(addCounters[1]),
        counter: normalizeCounterName(String(addCounters[2] || '')),
        target: parseObjectSelector(addCounters[3]),
        raw: rawClause,
        });
    }
  }

  {
    const addEnergyCounters = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}get(?:s)?\\s+((?:\\{E\\})+)(?:\\s*\\(([^)]*energy counters?)\\))?\\s*$`, 'i'));
    if (addEnergyCounters) {
      const energyCount = countEnergySymbols(String(addEnergyCounters[2] || addEnergyCounters[1] || ''));
      if (energyCount > 0) {
        return withMeta({
          kind: 'add_player_counter',
          who: parsePlayerSelector(addEnergyCounters[1]),
          amount: { kind: 'number', value: energyCount },
          counter: 'energy',
          raw: rawClause,
        });
      }
    }
  }

  {
    const addPlayerCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}get(?:s)?\\s+(${REFERENCEABLE_COUNTER_AMOUNT_PATTERN})\\s+(.+?)\\s+counters?$`, 'i')
    );
    if (addPlayerCounters) {
      return withMeta({
        kind: 'add_player_counter',
        who: parsePlayerSelector(addPlayerCounters[1]),
        amount: parseQuantity(addPlayerCounters[2]),
        counter: normalizeCounterName(String(addPlayerCounters[3] || '')),
        raw: rawClause,
        });
    }
  }

  {
    const removeCounters = clause.match(/^remove\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+from\s+(.+)$/i);
    if (removeCounters) {
      return withMeta({
        kind: 'remove_counter',
        amount: parseQuantity(removeCounters[1]),
        counter: normalizeCounterName(String(removeCounters[2] || '')),
        target: parseObjectSelector(removeCounters[3]),
        raw: rawClause,
        });
    }
  }

  {
    const removeImplicitTimeCounter = clause.match(/^remove\s+(a|an|one)\s+time\s+counter$/i);
    if (removeImplicitTimeCounter) {
      return withMeta({
        kind: 'remove_counter',
        amount: { kind: 'number', value: 1 },
        counter: 'time',
        target: parseObjectSelector('it'),
        raw: rawClause,
        });
    }
  }

  {
    const plainsSearch = clause.match(/^search\s+your\s+library\s+for\s+(?:an?\s+additional\s+)?a?\s*plains\s+card$/i);
    if (plainsSearch) {
      return withMeta({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'Plains card' },
        destination: 'hand',
        revealFound: true,
        shuffle: false,
        maxResults: 1,
        raw: rawClause,
        });
    }
  }

  {
    const conditionalPlainsSearch = clause.match(/^if\s+target\s+opponent\s+controls\s+more\s+lands\s+than\s+you,\s*you\s+may\s+search\s+your\s+library\s+for\s+an\s+additional\s+plains\s+card$/i);
    if (conditionalPlainsSearch) {
      return withMeta({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: 'Plains card' },
        destination: 'hand',
        revealFound: true,
        shuffle: false,
        maxResults: 1,
        optional: true,
        raw: rawClause,
        });
    }
  }

  {
    const vortexTop = clause.match(/^put\s+this\s+creature\s+and\s+each\s+creature\s+blocking\s+or\s+blocked\s+by\s+it\s+on\s+top\s+of\s+their\s+owners'?\s+libraries$/i);
    if (vortexTop) {
      return withMeta({
        kind: 'move_zone',
        what: parseObjectSelector('this creature and each creature blocking or blocked by it'),
        to: 'library',
        toRaw: "top of their owners' libraries",
        raw: rawClause,
        });
    }
  }

  {
    const thosePlayersShuffle = clause.match(/^those\s+players\s+shuffle$/i);
    if (thosePlayersShuffle) {
      return withMeta({
        kind: 'shuffle_library',
        who: { kind: 'target_player' },
        raw: rawClause,
        });
    }
  }

  {
    const revealSeparatePiles = clause.match(
      /^reveal\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+your\s+library\s+and\s+separate\s+them\s+into\s+two\s+piles$/i
    );
    if (revealSeparatePiles) {
      return withMeta({
        kind: 'choose_pile',
        chooser: { kind: 'target_opponent' },
        source: 'top_library',
        chosenDestination: 'hand',
        otherDestination: 'graveyard',
        raw: rawClause,
        });
    }
  }

  {
    const opponentChoosesPile = clause.match(/^an\s+opponent\s+chooses\s+one\s+of\s+those\s+piles$/i);
    if (opponentChoosesPile) {
      return withMeta({
        kind: 'choose_pile',
        chooser: { kind: 'target_opponent' },
        source: 'last_split_piles',
        chosenDestination: 'hand',
        otherDestination: 'graveyard',
        raw: rawClause,
        });
    }
  }

  {
    const revealThoseToHand = clause.match(/^reveal\s+those\s+cards,\s*put\s+them\s+into\s+your\s+hand$/i);
    if (revealThoseToHand) {
      return withMeta({
        kind: 'move_zone',
        what: parseObjectSelector('those cards'),
        to: 'hand',
        toRaw: 'your hand',
        raw: rawClause,
        });
    }
  }

  {
    const shuffleZones = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}shuffles?\\s+(?:your|their|his or her)\\s+hand\\s+and\\s+graveyard\\s+into\\s+(?:your|their|his or her)\\s+library$`, 'i')
    );
    if (shuffleZones) {
      return withMeta({
        kind: 'shuffle_zones_into_library',
        who: parsePlayerSelector(shuffleZones[1]),
        zones: ['hand', 'graveyard'],
        raw: rawClause,
        });
    }
  }

  {
    const discardAnyNumber = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+any\\s+number\\s+of\\s+cards$`, 'i'));
    if (discardAnyNumber) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAnyNumber[1]),
        amount: { kind: 'any_number' },
        raw: rawClause,
        });
    }
  }

  {
    const moveCounters = clause.match(/^(?:you\s+may\s+)?put\s+its\s+(?:(\+1\/\+1)\s+)?counters\s+on\s+(.+)$/i);
    if (moveCounters) {
      return withMeta({
        kind: 'move_counters',
        from: parseObjectSelector('it'),
        to: parseObjectSelector(String(moveCounters[2] || '').trim()),
        ...(moveCounters[1] ? { counter: normalizeCounterName(String(moveCounters[1] || '').trim()) } : {}),
        amount: { kind: 'all' },
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const forceBlock = clause.match(/^target\s+creature\s+blocks\s+this\s+creature\s+this\s+turn\s+if\s+able$/i);
    if (forceBlock) {
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector('target creature'),
        attacker: parseObjectSelector('this creature'),
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }
  }

  {
    const noPreventDamage = clause.match(/^damage\s+can't\s+be\s+prevented\s+this\s+turn$/i);
    if (noPreventDamage) {
      return withMeta({
        kind: 'damage_cant_be_prevented',
        duration: 'this_turn',
        raw: rawClause,
        });
    }
  }

  {
    const doubleCounters = clause.match(
      /^for each kind of counter on (.+),\s+put another of that kind of counter on (?:that|the) permanent$/i
    );
    if (doubleCounters) {
      return withMeta({
        kind: 'double_counters',
        target: parseObjectSelector(String(doubleCounters[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const doublePlayerCounters = clause.match(new RegExp(`^(?:•\\s*)?double\\s+the\\s+number\\s+of\\s+each\\s+kind\\s+of\\s+counter\\s+${PLAYER_SUBJECT_PREFIX}have$`, 'i'));
    if (doublePlayerCounters) {
      return withMeta({
        kind: 'double_player_counters',
        who: parsePlayerSelector(doublePlayerCounters[1]),
        raw: rawClause,
        });
    }
  }

  {
    const doubleEachKindCounters = clause.match(/^double the number of each kind of counter on (.+)$/i);
    if (doubleEachKindCounters) {
      return withMeta({
        kind: 'double_counters',
        target: parseObjectSelector(String(doubleEachKindCounters[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const doubleSpecificCounters = clause.match(/^double the number of (.+?) counters on (.+)$/i);
    if (doubleSpecificCounters) {
      return withMeta({
        kind: 'double_counters',
        target: parseObjectSelector(String(doubleSpecificCounters[2] || '').trim()),
        counter: normalizeCounterName(String(doubleSpecificCounters[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const addManaChoice = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}(?:\\s+or\\s+\\{[^}]+\\})+)\\s*$`, 'i')
    );
    if (addManaChoice) {
      const manaOptions = parseManaChoiceList(String(addManaChoice[2] || '').trim());
      if (manaOptions.length >= 2) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addManaChoice[1]),
          mana: manaOptions[0],
          manaOptions,
          raw: rawClause,
        });
      }
    }

    const addMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})*)\\s*$`, 'i'));
    if (addMana) {
      const mana = String(addMana[2] || '').trim();
      if (mana && !/\bor\b/i.test(clause)) {
        return withMeta({ kind: 'add_mana', who: parsePlayerSelector(addMana[1]), mana, raw: rawClause });
      }
    }
  }

  {
    const retainMana = clause.match(
      /^(?:until\s+end\s+of\s+(turn|combat),\s*)?(?:(you|that player|they)\s+)?(?:don't|do not)\s+lose\s+this\s+mana\s+as\s+steps\s+and\s+phases\s+end$/i
    );
    if (retainMana) {
      const duration = String(retainMana[1] || 'turn').toLowerCase() === 'combat'
        ? 'until_end_of_combat'
        : 'until_end_of_turn';
      return withMeta({
        kind: 'retain_mana',
        who: parsePlayerSelector(retainMana[2]),
        duration,
        raw: rawClause,
      });
    }

    const manaLasts = clause.match(/^this\s+mana\s+lasts\s+until\s+end\s+of\s+(turn|combat)$/i);
    if (manaLasts) {
      const duration = String(manaLasts[1] || 'turn').toLowerCase() === 'combat'
        ? 'until_end_of_combat'
        : 'until_end_of_turn';
      return withMeta({
        kind: 'retain_mana',
        who: { kind: 'you' },
        duration,
        raw: rawClause,
      });
    }
  }

  {
    const exertMatch = clause.match(/^exert(?:\s+(.+?))?(?:\s+as\s+it\s+attacks)?$/i);
    if (exertMatch) {
      return withMeta({
        kind: 'exert',
        target: parseObjectSelector(String(exertMatch[1] || 'this permanent').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const earthbendMatch = clause.match(/^earthbend\s+(a|an|\d+|x|[a-z]+)$/i);
    if (earthbendMatch) {
      return withMeta({
        kind: 'earthbend',
        target: parseObjectSelector('target land you control'),
        amount: parseQuantity(earthbendMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const openAttractionMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:open|opens)\\s+an\\s+attraction$`, 'i'));
    if (openAttractionMatch) {
      return withMeta({
        kind: 'open_attraction',
        who: parsePlayerSelector(openAttractionMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const rollVisitMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}roll(?:s)?\\s+to\\s+visit\\s+(?:your|their|his or her)\\s+attractions$`, 'i'));
    if (rollVisitMatch) {
      return withMeta({
        kind: 'roll_visit_attractions',
        who: parsePlayerSelector(rollVisitMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const initiativeMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}take(?:s)?\\s+the\\s+initiative$`, 'i'));
    if (initiativeMatch) {
      return withMeta({
        kind: 'take_initiative',
        who: parsePlayerSelector(initiativeMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const monarchMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}become(?:s)?\\s+the\\s+monarch$`, 'i'));
    if (monarchMatch) {
      return withMeta({
        kind: 'become_monarch',
        who: parsePlayerSelector(monarchMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const ventureMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}venture(?:s)?\\s+into\\s+the\\s+dungeon$`, 'i'));
    if (ventureMatch) {
      return withMeta({
        kind: 'venture_into_dungeon',
        who: parsePlayerSelector(ventureMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const planeswalkMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}planeswalk(?:s)?$`, 'i'));
    if (planeswalkMatch) {
      return withMeta({
        kind: 'planeswalk',
        who: parsePlayerSelector(planeswalkMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const assembleMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}assemble(?:s)?(?:\\s+a\\s+contraption)?$`, 'i'));
    if (assembleMatch) {
      return withMeta({
        kind: 'assemble',
        who: parsePlayerSelector(assembleMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const regenerateMatch = clause.match(/^regenerate\s+(.+)$/i);
    if (regenerateMatch) {
      return withMeta({
        kind: 'regenerate',
        target: parseObjectSelector(regenerateMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const abandonSchemeMatch = clause.match(/^abandon\s+(this|that)\s+scheme$/i);
    if (abandonSchemeMatch) {
      return withMeta({
        kind: 'abandon_scheme',
        target: { kind: 'raw', text: `${String(abandonSchemeMatch[1] || '').toLowerCase()} scheme` },
        raw: rawClause,
        });
    }
  }

  {
    const setInMotionMatch = clause.match(/^set\s+(this|that)\s+scheme\s+in\s+motion(?:\s+again)?$/i);
    if (setInMotionMatch) {
      return withMeta({
        kind: 'set_in_motion',
        target: { kind: 'raw', text: `${String(setInMotionMatch[1] || '').toLowerCase()} scheme` },
        raw: rawClause,
        });
    }
  }

  {
    const learnMatch = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:learn|learns)\\b$`, 'i'));
    if (learnMatch) {
      return withMeta({
        kind: 'learn',
        who: parsePlayerSelector(learnMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const clash = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:clash|clashes)\\s+with\\s+an\\s+opponent\\b`, 'i'));
    if (clash) {
      return withMeta({
        kind: 'clash',
        who: parsePlayerSelector(clash[1]),
        opponent: { kind: 'target_opponent' },
        raw: rawClause,
        });
    }
  }

  {
    const vote = clause.match(
      /^starting with\s+(.+?),\s*(each player)\s+votes?\s+for\s+(.+)$/i
    );
    if (vote) {
      const choices = String(vote[3] || '')
        .split(/\s*,\s*|\s+or\s+/i)
        .map(choice => choice.trim().replace(/^(?:an?|the)\s+/i, '').trim())
        .filter(Boolean);
      if (choices.length >= 2) {
        return withMeta({
          kind: 'vote',
          voters: parsePlayerSelector(vote[2]),
          startingWith: parsePlayerSelector(vote[1]),
          choices,
          raw: rawClause,
        });
      }
    }
  }

  {
    const investigate = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:investigate|investigates)\\b$`, 'i'));
    if (investigate) {
      return withMeta({
        kind: 'investigate',
        who: parsePlayerSelector(investigate[1]),
        amount: { kind: 'number', value: 1 },
        raw: rawClause,
        });
    }
  }

  {
    const skipNextDrawStep = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her|its)\\s+(?:next\\s+)?draw\\s+step\\b`, 'i')
    );
    if (skipNextDrawStep) {
      return withMeta({
        kind: 'skip_next_draw_step',
        who: parsePlayerSelector(skipNextDrawStep[1]),
        raw: rawClause,
        });
    }
  }

  {
    const monstrosityMatch = clause.match(/^monstrosity\s+(a|an|\d+|x|[a-z]+)$/i);
    if (monstrosityMatch) {
      return withMeta({
        kind: 'monstrosity',
        target: parseObjectSelector('this permanent'),
        amount: parseQuantity(monstrosityMatch[1]),
        raw: rawClause,
        });
    }
  }

  {
    const suspectMatch = clause.match(/^suspect\s+(.+)$/i);
    if (suspectMatch) {
      return withMeta({
        kind: 'suspect',
        target: parseObjectSelector(String(suspectMatch[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const renownedMatch = clause.match(/^(it|this creature|this permanent)\s+becomes\s+renowned$/i);
    if (renownedMatch) {
      return withMeta({
        kind: 'become_renowned',
        target: parseObjectSelector(String(renownedMatch[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const turnFaceUpMatch = clause.match(/^turn\s+(.+?)\s+face up$/i);
    if (turnFaceUpMatch) {
      return withMeta({
        kind: 'turn_face_up',
        target: parseObjectSelector(String(turnFaceUpMatch[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const turnFaceDownMatch = clause.match(/^turn\s+(.+?)\s+face down$/i);
    if (turnFaceDownMatch) {
      return withMeta({
        kind: 'turn_face_down',
        target: parseObjectSelector(String(turnFaceDownMatch[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const basicLandTypeChoice = clause.match(
      /^(.+?)\s+becomes\s+the\s+basic\s+land\s+type\s+of\s+your\s+choice(?:\s+until\s+end\s+of\s+turn)?$/i
    );
    if (basicLandTypeChoice) {
      return withMeta({
        kind: 'set_basic_land_type',
        target: parseObjectSelector(String(basicLandTypeChoice[1] || '').trim()),
        landType: 'choice',
        duration: /\buntil\s+end\s+of\s+turn\b/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
        });
    }
  }

  {
    const populate = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:populate|populates)\\b$`, 'i'));
    if (populate) {
      return withMeta({
        kind: 'populate',
        who: parsePlayerSelector(populate[1]),
        amount: { kind: 'number', value: 1 },
        raw: rawClause,
        });
    }
  }

  {
    const scry = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?(?:scry|scries)\\s+(a|an|\\d+|x|[a-z]+)\\b`, 'i'));
    if (scry) {
      return withMeta({
        kind: 'scry',
        who: parsePlayerSelector(scry[1]),
        amount: parseQuantity(scry[2]),
        raw: rawClause,
        });
    }
  }

  {
    const surveil = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:surveil|surveils)\\s+(a|an|\\d+|x|[a-z]+)\\b`, 'i')
    );
    if (surveil) {
      return withMeta({
        kind: 'surveil',
        who: parsePlayerSelector(surveil[1]),
        amount: parseQuantity(surveil[2]),
        raw: rawClause,
        });
    }
  }

  {
    const fateseal = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:fateseal|fateseals)\\s+(a|an|\\d+|x|[a-z]+)\\b`, 'i'));
    if (fateseal) {
      return withMeta({
        kind: 'fateseal',
        who: parsePlayerSelector(fateseal[1]),
        target: { kind: 'target_opponent' },
        amount: parseQuantity(fateseal[2]),
        raw: rawClause,
        });
    }
  }

  {
    const timeTravel = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:time\\s+travel)(?:\\s+(a|an|\\d+|x|[a-z]+)\\s+times?)?\\b`, 'i')
    );
    if (timeTravel) {
      return withMeta({
        kind: 'time_travel',
        who: parsePlayerSelector(timeTravel[1]),
        amount: parseQuantity(timeTravel[2] || '1'),
        raw: rawClause,
        });
    }
  }

  {
    const discardHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardHand[1]),
        amount: { kind: 'number', value: 9999 },
        raw: rawClause,
        });
    }

    const discardAllInHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+all\\s+(?:the\\s+)?cards?\\s+in\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardAllInHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAllInHand[1]),
        amount: { kind: 'number', value: 9999 },
        raw: rawClause,
        });
    }

    const discardAllInHandDefault = clause.match(/^discard\s+all\s+(?:the\s+)?cards?\s+in\s+your\s+hand\b/i);
    if (discardAllInHandDefault) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 9999 },
        raw: rawClause,
        });
    }

    const discardTargeted = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+(that\\s+card|those\\s+cards|it)\\b`, 'i')
    );
    if (discardTargeted) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardTargeted[1]),
        amount: { kind: 'number', value: 1 },
        target: parseObjectSelector(discardTargeted[2]),
        raw: rawClause,
        });
    }

    const discard = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+(a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i')
    );
    if (discard) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discard[1]),
        amount: parseQuantity(discard[2]),
        raw: rawClause,
        });
    }

    const discardTargetedDefault = clause.match(/^discard\s+(that\s+card|it)\b/i);
    if (discardTargetedDefault) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        target: parseObjectSelector(discardTargetedDefault[1]),
        raw: rawClause,
        });
    }

    const discardDefault = clause.match(/^discard\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (discardDefault) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: parseQuantity(discardDefault[1]),
        raw: rawClause,
        });
    }
  }

  {
    const lookHand = clause.match(
      /^(?:you\s+)?look\s+at\s+(target opponent|target player|that opponent|that player|each opponent|each player|an opponent|your|their|his or her)(?:'s|’s)?\s+hand\b/i
    );
    if (lookHand) {
      const rawWho = String(lookHand[1] || '').trim().toLowerCase();
      const selectorText = rawWho === 'an opponent' ? 'target opponent' : rawWho;
      return withMeta({
        kind: 'look_hand',
        who: parsePlayerSelector(selectorText),
        raw: rawClause,
        });
    }

    const revealHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}reveals?\\s+(?:your|their|his or her)\\s+hand\\b`, 'i')
    );
    if (revealHand) {
      return withMeta({
        kind: 'reveal_hand',
        who: parsePlayerSelector(revealHand[1]),
        raw: rawClause,
        });
    }
  }

  {
    const millUntilLand = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}reveals?\\s+cards?\\s+from\\s+the\\s+top\\s+of\\s+(?:their|your|his or her)\\s+library\\s+until\\s+(?:they|you)\\s+reveal\\s+a\\s+land\\s+card\\b`,
        'i'
      )
    );
    if (millUntilLand) {
      return withMeta({
        kind: 'mill',
        who: parsePlayerSelector(millUntilLand[1]),
        amount: { kind: 'reveal_until_land' },
        raw: rawClause,
        });
    }

    const mill = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}mill(?:s)?\\s+(a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i'));
    if (mill) {
      return withMeta({
        kind: 'mill',
        who: parsePlayerSelector(mill[1]),
        amount: parseQuantity(mill[2]),
        raw: rawClause,
        });
    }

    const millDefault = clause.match(/^mill\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (millDefault) {
      return withMeta({
        kind: 'mill',
        who: { kind: 'you' },
        amount: parseQuantity(millDefault[1]),
        raw: rawClause,
        });
    }
  }

  {
    const goad = clause.match(/^goad\s+(.+)$/i);
    if (goad) {
      return withMeta({
        kind: 'goad',
        target: parseObjectSelector(goad[1]),
        raw: rawClause,
        });
    }
  }

  {
    const detain = clause.match(/^detain\s+(.+)$/i);
    if (detain) {
      return withMeta({
        kind: 'detain',
        target: parseObjectSelector(detain[1]),
        raw: rawClause,
        });
    }
  }

  {
    const cantAttack = clause.match(/^(.+?)\s+can't\s+attack(?:\s+this\s+turn)?$/i);
    if (cantAttack) {
      return withMeta({
        kind: 'cant_attack',
        target: parseObjectSelector(cantAttack[1]),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
        });
    }
  }

  {
    const cantBlock = clause.match(/^(.+?)\s+can't\s+block(?:\s+this\s+turn)?$/i);
    if (cantBlock) {
      return withMeta({
        kind: 'cant_block',
        target: parseObjectSelector(cantBlock[1]),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
        });
    }
  }

  {
    const cantActivateAbilities = clause.match(/^(.+?)\s+activated abilities\s+can't\s+be\s+activated(?:\s+this\s+turn)?$/i);
    if (cantActivateAbilities) {
      return withMeta({
        kind: 'cant_activate_abilities',
        target: parseObjectSelector(normalizePossessiveObjectReference(cantActivateAbilities[1])),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
        });
    }
  }

  return null;
}


