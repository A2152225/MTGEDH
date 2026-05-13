import type { OracleEffectStep } from './oracleIR';
import { normalizeCounterName, splitSacrificeObjectAndCondition } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|each player|each other player|each opponent|each friend|each of those opponents|any number of target opponents|any number of target players other than that player|any number of target players|each of that player's opponents|target player|target opponent|that player|that opponent|that attacking player|an opponent|the opponent|the player|attacking player|defending player|the defending player|the attacking player|the controller of those creatures|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'’-]*?(?:'s|’s)? (?:controller|owner))\\s+)?";

const DRAW_AMOUNT_WORD_PATTERN = '(?:that many|that much|a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const COUNTER_AMOUNT_PATTERN = '(?:a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const REFERENCEABLE_COUNTER_AMOUNT_PATTERN = '(?:that many|that much|a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

function parseManaChoiceList(raw: string): string[] {
  const matches = String(raw || '').match(/\{[^}]+\}/g);
  return Array.isArray(matches) ? matches.map(symbol => String(symbol || '').trim()).filter(Boolean) : [];
}

function parseManaOptionGroupList(raw: string): string[] {
  return String(raw || '')
    .split(/\s*,\s*or\s+|\s+or\s+|\s*,\s*/i)
    .map(option => String(option || '').replace(/\s+/g, '').trim())
    .filter(option => /^(?:\{[^}]+\})+$/.test(option));
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

function parseCounterQuantity(raw: string | undefined): ReturnType<typeof parseQuantity> {
  const normalized = String(raw || '')
    .replace(/^up to\s+/i, '')
    .trim();
  if (!normalized) return { kind: 'unknown' };
  return parseQuantity(normalized);
}

function parseScaledCounterQuantity(amountText: string, scalingText: string): ReturnType<typeof parseQuantity> {
  const combined = `${amountText} ${scalingText}`.trim();
  const parsed = parseQuantity(combined);
  return parsed.kind === 'unknown' ? { kind: 'unknown', raw: combined } : parsed;
}

function parseAddManaAmountExpression(
  raw: string | undefined
): Extract<OracleEffectStep, { kind: 'add_mana' }>['amount'] | null {
  const normalized = normalizeOracleText(String(raw || '').replace(/^equal\s+to\s+/i, '').trim());
  if (!normalized) return null;

  switch (normalized) {
    case "this permanent's toughness":
      return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
    case 'the greatest power among creatures you control':
      return { kind: 'greatest_power_among_creatures_you_control' };
    case 'the number of art counters on this permanent plus one':
    case 'the number of time counters on this artifact':
    case 'the chosen colors':
    case 'the number of charge counters removed this way':
    case 'x plus one':
    case 'your devotion to green':
    case "that spell's mana value":
    case 'the greatest power among creatures you control that entered this turn':
    case 'the number of creatures you control of the chosen type':
      return { kind: 'reference_amount', raw: normalized };
    default: {
      const parsed = parseQuantity(normalized);
      return parsed.kind === 'unknown' ? { kind: 'reference_amount', raw: normalized } : parsed;
    }
  }
}

function parseDrawAmount(raw: string | undefined): Extract<OracleEffectStep, { kind: 'draw' }>['amount'] {
  const normalized = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (normalized === 'its power') return { kind: 'source_power' };
  if (normalized === "the sacrificed creature's power") {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'power' };
  }
  if (/^the greatest number of cards a player discarded this way$/i.test(normalized)) {
    return { kind: 'reference_amount', raw: 'greatest_number_discarded_this_way' };
  }

  const greatestPower = normalized.match(/^the greatest power among (non[- ]?([a-z][a-z-]*) )?creatures you control$/i);
  if (greatestPower) {
    const excludedSubtype = String(greatestPower[2] || '').trim().toLowerCase();
    return {
      kind: 'greatest_power_among_creatures_you_control',
      ...(excludedSubtype ? { excludeSubtype: excludedSubtype } : {}),
    };
  }

  const parsed = parseQuantity(raw);
  return parsed.kind === 'unknown' ? { kind: 'unknown', raw: String(raw || '').trim() } : parsed;
}

function normalizeDrawClauseForParse(rawClause: string): string {
  let clause = normalizeOracleText(rawClause)
    .replace(/^[\s(]+/, '')
    .replace(/[.)"\s]+$/g, '')
    .replace(/^[\u2022•]\s*/, '')
    .replace(/^then\s+/i, '')
    .replace(/^if you do,\s*/i, '')
    .replace(/^[+−-]\s*(?:\{[^}]+\}\s*)+[-—]\s*/i, '')
    .replace(/^(?:\{[^}]+\}\s*)+[-—]\s*/i, '')
    .replace(/^\d+\s*(?:[-–—]\s*\d+)?\s*\|\s*/i, '')
    .trim();

  clause = clause.replace(/^([a-z][a-z0-9 ',/-]{0,60})[-—]\s+(?=(?:you|target|each|any number|draw)\b.*\bdraws?\b|draw\b)/i, '');

  const triggerBody = clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (triggerBody && /\bdraws?\b/i.test(String(triggerBody[1] || ''))) {
    clause = String(triggerBody[1] || '').trim();
  }

  const replacementDrawBody = clause.match(/^if\b[\s\S]*?\bwould\s+draw\b[\s\S]*?,\s+(?:instead\s+)?((?:you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)|(?:(?:you|target player|target opponent|that player|that opponent|each player|each opponent|any number of target opponents|each of that player's opponents|its controller)\s+)?(?:may\s+)?draws?\b[\s\S]+)(?:\s+instead)?$/i);
  if (replacementDrawBody) {
    clause = String(replacementDrawBody[1] || '').replace(/\s+instead$/i, '').trim();
  }

  const nextTimeReplacementDrawBody = clause.match(/^the\s+next\s+time\b[\s\S]*?,\s*instead\s+((?:(?:you|target player|target opponent|that player|that opponent|each player|each opponent|any number of target opponents|any number of target players(?: other than that player)?|its controller)\s+)?(?:may\s+)?draws?\b[\s\S]+|draw\b[\s\S]+)$/i);
  if (nextTimeReplacementDrawBody) {
    clause = String(nextTimeReplacementDrawBody[1] || '').trim();
  }

  const conditionalDrawBody = clause.match(/^if\b(?!\s+[^,]*\bwould\s+draw\b).+?,\s+((?:you\s+may\s+have\s+)?(?:(?:you|target player|target opponent|that player|that opponent|defending player|the defending player|the attacking player|any number of target opponents|any number of target players(?: other than that player)?|each of that player's opponents|its controller)\s+)?draws?\b[\s\S]+|you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)$/i);
  if (conditionalDrawBody) clause = String(conditionalDrawBody[1] || '').trim();

  const trailingCommaDraw = clause.match(/,\s*((?:you\s+may\s+have\s+)?(?:(?:you|its controller|that player|that opponent|target player|target opponent|each player|each opponent|any number of target opponents|any number of target players(?: other than that player)?|each of that player's opponents|defending player|the defending player|the attacking player)\s+)?(?:may\s+)?draws?\b[\s\S]+|you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)$/i);
  if (trailingCommaDraw && !/^\s*(?:whenever|when|if)\b/i.test(String(trailingCommaDraw[1] || ''))) {
    clause = String(trailingCommaDraw[1] || '').trim();
  }

  const trailingAndDraw = clause.match(/\band\s+((?:you\s+may\s+have\s+)?(?:(?:you|its controller|that player|that opponent|target player|target opponent|each player|each opponent|any number of target opponents|any number of target players(?: other than that player)?|each of that player's opponents|defending player|the defending player|the attacking player)\s+)?(?:may\s+)?draws?\b[\s\S]+|you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)$/i);
  if (trailingAndDraw) clause = String(trailingAndDraw[1] || '').trim();

  clause = clause.replace(/^then\s+/i, '').replace(/^if you do,\s*/i, '').trim();

  return clause;
}

function sharedDrawSelector(raw: string): Extract<OracleEffectStep, { kind: 'draw' }>['who'] {
  const normalized = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .replace(/^the\s+/i, '')
    .trim()
    .toLowerCase();
  if (normalized === 'target opponent') return { kind: 'you_and_target_opponent' };
  return { kind: 'you_and_target_player' };
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
    const exiledCardPermission = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?(cast|play)s?\\s+(the\\s+exiled\\s+card|that\\s+card|this\\s+card|it)(?:\\s+from\\s+exile)?(?:\\s+without\\s+paying\\s+its\\s+mana\\s+cost)?(?:\\s+this\\s+turn)?(?:\\s+if\\s+.+)?$`, 'i')
    );
    if (exiledCardPermission) {
      return withMeta({
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(exiledCardPermission[1]),
        what: parseObjectSelector(String(exiledCardPermission[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(clause) ? 'this_turn' : 'during_resolution',
        permission: String(exiledCardPermission[2] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+its\s+mana\s+cost/i.test(clause) || undefined,
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    const selfDamageRemoveCounter = clause.match(
      /^if\s+damage\s+would\s+be\s+dealt\s+to\s+(.+?)\s+while\s+it\s+has\s+(?:a|an|one|one\s+or\s+more|\d+|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it,\s+prevent\s+that\s+damage\s+and\s+remove\s+(a|an|one|\d+|[a-z]+)\s+(.+?)\s+counters?\s+from\s+(.+)$/i
    );
    if (selfDamageRemoveCounter) {
      const recipientText = String(selfDamageRemoveCounter[1] || '').trim();
      const removeAmountText = String(selfDamageRemoveCounter[3] || '').trim();
      const removeCounterText = String(selfDamageRemoveCounter[4] || '').trim();
      const removeTargetText = String(selfDamageRemoveCounter[5] || '').trim();
      return withMeta({
        kind: 'conditional',
        condition: {
          kind: 'if',
          raw: `damage would be dealt to ${recipientText} while it has ${String(selfDamageRemoveCounter[2] || '').trim()} counters on it`,
        },
        steps: [
          {
            kind: 'prevent_damage',
            amount: 'all',
            recipientTarget: parseObjectSelector(recipientText),
            duration: 'this_turn',
            raw: 'prevent that damage',
          },
          {
            kind: 'remove_counter',
            amount: parseQuantity(removeAmountText),
            counter: normalizeCounterName(removeCounterText),
            target: parseObjectSelector(removeTargetText),
            raw: `remove ${removeAmountText} ${removeCounterText} counter from ${removeTargetText}`,
          },
        ],
        raw: rawClause,
      } as OracleEffectStep);
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
    if (/^for each opponent,\s+create\s+a\s+token\s+copy\s+that\s+attacks\s+that\s+opponent\s+this\s+turn\s+if\s+able$/i.test(clause)) {
      return withMeta({
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: 'copy',
        attacking: 'each_opponent',
        raw: rawClause,
      });
    }
  }

  {
    const sacrifice = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}sacrifices?\\s+(.+)$`, 'i'));
    if (sacrifice) {
      const parsedObject = splitSacrificeObjectAndCondition(String(sacrifice[2] || '').trim());
      return withMeta({
        kind: 'sacrifice',
        who: parsePlayerSelector(sacrifice[1] || 'you'),
        what: parseObjectSelector(parsedObject.objectText),
        ...(parsedObject.condition ? { condition: parsedObject.condition } : {}),
        raw: rawClause,
      });
    }
  }

  const addManaEqualToEnchantedPermanentManaCost = clause.match(
    new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+mana\\s+equal\\s+to\\s+enchanted\\s+permanent(?:'|â€™)?s\\s+mana\\s+cost\\s*$`, 'i')
  );
  if (addManaEqualToEnchantedPermanentManaCost) {
    return withMeta({
      kind: 'add_mana',
      who: parsePlayerSelector(addManaEqualToEnchantedPermanentManaCost[1]),
      mana: '{C}',
      amount: { kind: 'reference_amount', raw: "enchanted permanent's mana cost" },
      raw: rawClause,
    });
  }

  {
    if (/^end the turn$/i.test(clause)) {
      return withMeta({
        kind: 'end_turn',
        raw: rawClause,
      });
    }

    const addVariableColorManaWhereX = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+x\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+colors,?\\s+where\\s+x\\s+is\\s+(.+)\\s*$`, 'i')
    );
    if (addVariableColorManaWhereX) {
      const amount = parseAddManaAmountExpression(String(addVariableColorManaWhereX[2] || '').trim());
      if (amount) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addVariableColorManaWhereX[1]),
          mana: '{W}',
          amount,
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const skipNextTurn = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her)\\s+next\\s+turn$`, 'i'));
    if (skipNextTurn) {
      return withMeta({
        kind: 'skip_next_turn',
        who: parsePlayerSelector(skipNextTurn[1]),
        raw: rawClause,
      });
    }
    const skipThatTurn = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+that\\s+turn$`, 'i'));
    if (skipThatTurn) {
      return withMeta({
        kind: 'skip_next_turn',
        who: parsePlayerSelector(skipThatTurn[1]),
        raw: rawClause,
      });
    }

    const changeTarget = clause.match(/^(?:you\s+may\s+)?change\s+the\s+targets?\s+of\s+(.+?)(?:\s+to\s+(.+))?$/i);
    if (changeTarget && /\b(?:spell|ability|abilities)\b/i.test(String(changeTarget[1] || ''))) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector(String(changeTarget[1] || '').trim()),
        ...(changeTarget[2] ? { newTarget: parseObjectSelector(String(changeTarget[2] || '').trim()) } : {}),
        optional: /^you\s+may\s+/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const changeATarget = clause.match(/^(?:you\s+may\s+)?change\s+a\s+target\s+of\s+(.+?)\s+to\s+(.+?)(?:\s+if\s+able)?$/i);
    if (changeATarget && /\b(?:spell|ability|abilities)\b/i.test(String(changeATarget[1] || ''))) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector(String(changeATarget[1] || '').trim()),
        newTarget: parseObjectSelector(String(changeATarget[2] || '').trim()),
        optional: /^you\s+may\s+/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const contextualChangeTarget = clause.match(/^(?:you\s+may\s+)?change\s+the\s+target\s+to\s+(.+?)(?:\s+if\s+able)?$/i);
    if (contextualChangeTarget) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector('the spell or ability'),
        newTarget: parseObjectSelector(String(contextualChangeTarget[1] || '').trim()),
        optional: /^you\s+may\s+/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const changeText = clause.match(/^change\s+the\s+text\s+of\s+(.+?)\s+by\s+replacing\s+all\s+instances\s+of\s+one\s+color\s+word\s+with\s+another$/i);
    if (changeText) {
      return withMeta({
        kind: 'player_choice',
        choice: 'text_change',
        target: parseObjectSelector(String(changeText[1] || '').trim()),
        raw: rawClause,
      });
    }

    if (/^if\s+you\s+do,\s*proliferate$/i.test(clause)) {
      return withMeta({ kind: 'proliferate', raw: rawClause });
    }
  }

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

    const addRepeatedManaForEach = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})+)\\s+for\\s+each\\s+(.+)$`, 'i'));
    if (addRepeatedManaForEach) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addRepeatedManaForEach[1]),
        mana: String(addRepeatedManaForEach[2] || '').replace(/\s+/g, '').trim(),
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addManaChoiceForEach = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+((?:\\{[^}]+\\})+(?:(?:\\s*,\\s*|\\s+or\\s+|\\s*,\\s*or\\s*)(?:\\{[^}]+\\})+)+)\\s+for\\s+each\\s+(.+)$`,
        'i'
      )
    );
    if (addManaChoiceForEach) {
      const manaOptions = parseManaOptionGroupList(String(addManaChoiceForEach[2] || '').trim());
      if (manaOptions.length >= 2) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addManaChoiceForEach[1]),
          mana: manaOptions[0],
          manaOptions,
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
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

    const contextualBecomeAura = clause.match(/^(it|this\s+permanent|this\s+enchantment)\s+becomes\s+an?\s+aura\s+with\s+enchant\s+(.+)$/i);
    if (contextualBecomeAura) {
      return withMeta({
        kind: 'become_aura',
        target: parseObjectSelector(contextualBecomeAura[1]),
        enchant: parseObjectSelector(contextualBecomeAura[2]),
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

    const flipUntilLoss = clause.match(/^flip\s+a\s+coin\s+until\s+you\s+lose\s+a\s+flip$/i);
    if (flipUntilLoss) {
      return withMeta({
        kind: 'flip_coin',
        who: { kind: 'you' },
        repeatUntil: 'lose_flip',
        raw: rawClause,
      });
    }

  }

    const putCountersEqualToPower = clause.match(/^put\s+(?:a\s+number\s+of\s+)?(.+?)\s+counters?\s+equal\s+to\s+(?:its|this\s+permanent's)\s+power\s+on\s+(.+)$/i);
    if (putCountersEqualToPower) {
      return withMeta({
        kind: 'add_counter',
        amount: { kind: 'object_stat', subject: 'it', stat: 'power' },
        counter: normalizeCounterName(String(putCountersEqualToPower[1] || '').trim()),
        target: parseObjectSelector(String(putCountersEqualToPower[2] || '').trim()),
        raw: rawClause,
      });
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
    const opponentCausedSearchPrevention = clause.match(
      /^spells\s+and\s+abilities\s+your\s+opponents\s+control\s+can't\s+cause\s+their\s+controller\s+to\s+search\s+their\s+library$/i
    );
    if (opponentCausedSearchPrevention) {
      return withMeta({
        kind: 'prevent_library_search',
        who: { kind: 'each_opponent' },
        source: parseObjectSelector('spells and abilities your opponents control'),
        duration: 'static',
        raw: rawClause,
        });
    }

    const genericSearchPrevention = clause.match(
      /^(players|each\s+player|your\s+opponents|opponents|each\s+opponent)\s+can't\s+search\s+(?:libraries|their\s+libraries)$/i
    );
    if (genericSearchPrevention) {
      return withMeta({
        kind: 'prevent_library_search',
        who: /opponents?|each\s+opponent/i.test(String(genericSearchPrevention[1] || ''))
          ? { kind: 'each_opponent' }
          : { kind: 'each_player' },
        duration: 'static',
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
    const addAnyColorLandCouldProduceMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+(?:one\\s+)?(?:color|type)\\s+(?:that\\s+)?.+?\\s+could\\s+produce\\s*$`, 'i')
    );
    if (addAnyColorLandCouldProduceMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAnyColorLandCouldProduceMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAnyColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(?:an\\s+additional\\s+)?(?:a|an|1|one)\\s+mana\\s+of\\s+any\\s+(?:one\\s+)?color\\s*$`, 'i')
    );
    if (addAnyColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAnyColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        raw: rawClause,
        });
    }

    const addEachChosenColorMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(?:a|an|one)\\s+mana\\s+of\\s+each\\s+of\\s+the\\s+chosen\\s+colors\\s*$`, 'i'));
    if (addEachChosenColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addEachChosenColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        amount: { kind: 'reference_amount', raw: 'the chosen colors' },
        raw: rawClause,
      });
    }

    const addReferenceBoundAnyColorMana = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+(?:a\\s+color\\s+written\\s+on\\s+this\\s+permanent|any\\s+color\\s+chosen\\s+as\\s+you\\s+drafted\\s+cards\\s+named\\s+this\\s+permanent|any\\s+color\\s+that\\s+appears\\s+on\\s+.+|any\\s+color\\s+that\\s+shares\\s+a\\s+color\\s+with\\s+.+)\\s*$`,
        'i'
      )
    );
    if (addReferenceBoundAnyColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addReferenceBoundAnyColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addCircledColorsMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+either\\s+of\\s+the\\s+circled\\s+colors\\s*$`, 'i'));
    if (addCircledColorsMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addCircledColorsMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addGuildColorsMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+your\\s+guild(?:'|â€™)?s\\s+colors\\s*$`, 'i'));
    if (addGuildColorsMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addGuildColorsMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addRepeatedAnyColorForRemovedCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+color\\s+for\\s+each\\s+charge\\s+counter\\s+removed\\s+this\\s+way\\s*$`, 'i')
    );
    if (addRepeatedAnyColorForRemovedCounters) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addRepeatedAnyColorForRemovedCounters[1]),
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'the number of charge counters removed this way' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addThatColorForChargeCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+that\\s+color\\s+for\\s+each\\s+charge\\s+counter\\s+on\\s+this\\s+artifact\\s*$`, 'i')
    );
    if (addThatColorForChargeCounters) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatColorForChargeCounters[1]),
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'the number of charge counters on this artifact' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addThatColorForDifferentPowers = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+that\\s+color\\s+for\\s+each\\s+different\\s+power\\s+among\\s+creatures\\s+you\\s+control\\s*$`, 'i')
    );
    if (addThatColorForDifferentPowers) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatColorForDifferentPowers[1]),
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'the number of different powers among creatures you control' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAnyColorFromReferenceMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+(?:any\\s+of\\s+the\\s+exiled\\s+(?:card(?:'|â€™)?s|cards(?:'|â€™)?)\\s+colors|any\\s+color\\s+among\\s+.+)\\s*$`, 'i')
    );
    if (addAnyColorFromReferenceMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAnyColorFromReferenceMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }
  }

  {
    const addVariableColorMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+x\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+colors\\s*$`, 'i'));
    if (addVariableColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addVariableColorMana[1]),
        mana: '{W}',
        amount: { kind: 'x' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAmountEqualXPlusOne = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+x\\s+plus\\s+one\\s*$`, 'i'));
    if (addAmountEqualXPlusOne) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAmountEqualXPlusOne[1]),
        mana: String(addAmountEqualXPlusOne[2] || '').trim(),
        amount: { kind: 'reference_amount', raw: 'x plus one' },
        raw: rawClause,
      });
    }

    const addBasePlusArtCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}),\\s+plus\\s+an\\s+additional\\s+(\\{[^}]+\\})\\s+for\\s+each\\s+art\\s+counter\\s+on\\s+this\\s+permanent\\s*$`, 'i')
    );
    if (addBasePlusArtCounters) {
      const baseMana = String(addBasePlusArtCounters[2] || '').trim();
      const bonusMana = String(addBasePlusArtCounters[3] || '').trim();
      if (baseMana && baseMana === bonusMana) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addBasePlusArtCounters[1]),
          mana: baseMana,
          amount: { kind: 'reference_amount', raw: 'the number of art counters on this permanent plus one' },
          raw: rawClause,
        });
      }
    }

    const addAmountEqualSymbol = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+(.+)\\s*$`, 'i'));
    if (addAmountEqualSymbol) {
      const amount = parseAddManaAmountExpression(String(addAmountEqualSymbol[3] || '').trim());
      if (amount) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAmountEqualSymbol[1]),
          mana: String(addAmountEqualSymbol[2] || '').trim(),
          amount,
          raw: rawClause,
        });
      }
    }

    const addChosenColorAmount = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+mana\\s+of\\s+that\\s+color\\s+equal\\s+to\\s+(.+)\\s*$`, 'i')
    );
    if (addChosenColorAmount) {
      const amount = parseAddManaAmountExpression(String(addChosenColorAmount[2] || '').trim());
      if (amount) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addChosenColorAmount[1]),
          mana: '{W}',
          amount,
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const addAmountEqualToPower = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+(.+?)(?:'|â€™)?s\\s+power\\s*$`, 'i'));
    if (addAmountEqualToPower) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAmountEqualToPower[1]),
        mana: '{X}',
        manaOptions: [String(addAmountEqualToPower[2] || '').trim()],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addTwoDifferentColors = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+two\\s+mana\\s+of\\s+different\\s+colors\\s*$`, 'i'));
    if (addTwoDifferentColors) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addTwoDifferentColors[1]),
        mana: '{W}{U}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addTwoOfOneColorAndTwoOfAnother = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+two\\s+mana\\s+of\\s+any\\s+one\\s+color\\s+and\\s+two\\s+mana\\s+of\\s+any\\s+other\\s+color\\s*$`, 'i')
    );
    if (addTwoOfOneColorAndTwoOfAnother) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addTwoOfOneColorAndTwoOfAnother[1]),
        mana: '{W}{W}{U}{U}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAmountEqualToManaValue = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+(.+?)(?:'|â€™)?s\\s+mana\\s+value\\s*$`, 'i'));
    if (addAmountEqualToManaValue) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAmountEqualToManaValue[1]),
        mana: '{X}',
        manaOptions: [String(addAmountEqualToManaValue[2] || '').trim()],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAdditionalManaNoSubject = clause.match(/^add\s+an\s+additional\s+(\{[^}]+\})$/i);
    if (addAdditionalManaNoSubject) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: String(addAdditionalManaNoSubject[1] || '').trim(),
        raw: rawClause,
      });
    }

    const addManaForEach = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\})\\s+for\\s+each\\s+(.+)$`, 'i'));
    if (addManaForEach) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addManaForEach[1]),
        mana: String(addManaForEach[2] || '').trim(),
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addThatMuchMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+that\\s+much\\s+(\\{[^}]+\\})\\s*$`, 'i'));
    if (addThatMuchMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatMuchMana[1]),
        mana: String(addThatMuchMana[2] || '').trim(),
        amount: { kind: 'reference_amount', raw: 'that much' },
        raw: rawClause,
      });
    }

    const addTwiceThatMuchMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+twice\\s+that\\s+much\\s+(\\{[^}]+\\})\\s*$`, 'i'));
    if (addTwiceThatMuchMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addTwiceThatMuchMana[1]),
        mana: String(addTwiceThatMuchMana[2] || '').trim(),
        amount: { kind: 'reference_amount', raw: 'twice that much' },
        raw: rawClause,
      });
    }

    const addThatMuchAnyCombinationRg = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+that\\s+much\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+\\{R\\}\\s+and\\/or\\s+\\{G\\}\\s*$`, 'i')
    );
    if (addThatMuchAnyCombinationRg) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatMuchAnyCombinationRg[1]),
        mana: '{R}',
        amount: { kind: 'reference_amount', raw: 'that much' },
        manaOptions: ['{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addFixedOrChosenColor = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[WUBRGC]\\})\\s+or\\s+one\\s+mana\\s+of\\s+the\\s+chosen\\s+color$`, 'i'));
    if (addFixedOrChosenColor) {
      const fixed = String(addFixedOrChosenColor[2] || '').trim();
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addFixedOrChosenColor[1]),
        mana: fixed,
        manaOptions: [fixed, '{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addDevotionChosenColor = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+mana\\s+of\\s+that\\s+color\\s+equal\\s+to\\s+your\\s+devotion\\s+to\\s+that\\s+color$`, 'i'));
    if (addDevotionChosenColor) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addDevotionChosenColor[1]),
        mana: '{X}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addCountedSingleColor = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+(\\{[WUBRGC]\\})$`, 'i'));
    if (addCountedSingleColor) {
      const manaCount = parseSmallNumber(addCountedSingleColor[2]);
      const symbol = String(addCountedSingleColor[3] || '').trim();
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addCountedSingleColor[1]),
          mana: buildRepeatedMana(symbol, manaCount),
          raw: rawClause,
        });
      }
    }

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

    const addCountedChosenColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+mana\\s+of\\s+the\\s+chosen\\s+color\\s*$`, 'i')
    );
    if (addCountedChosenColorMana) {
      const manaCount = parseSmallNumber(addCountedChosenColorMana[2]);
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addCountedChosenColorMana[1]),
          mana: '{W}',
          ...(manaCount === 1 ? {} : { amount: { kind: 'number' as const, value: manaCount } }),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const addAnyCombinationSpecificOptions = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN}|that\\s+much)\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+(.+)\\s*$`, 'i')
    );
    if (addAnyCombinationSpecificOptions) {
      const countRaw = String(addAnyCombinationSpecificOptions[2] || '').trim().toLowerCase();
      const optionsText = String(addAnyCombinationSpecificOptions[3] || '').trim();
      const manaOptions = parseManaChoiceList(optionsText);
      const amount = countRaw === 'that much'
        ? ({ kind: 'reference_amount', raw: 'that much' } as const)
        : parseQuantity(countRaw);
      if (manaOptions.length >= 2 && amount.kind !== 'unknown') {
        const fixedCount = amount.kind === 'number' ? amount.value : null;
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyCombinationSpecificOptions[1]),
          mana: fixedCount && fixedCount > 0 ? buildRepeatedMana(manaOptions[0], fixedCount) : manaOptions[0],
          ...(fixedCount && fixedCount > 0 ? {} : { amount }),
          manaOptions,
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const addAnyCombinationGuildColors = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN}|that\\s+much)\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+your\\s+guild(?:'|â€™)?s\\s+colors\\s*$`,
        'i'
      )
    );
    if (addAnyCombinationGuildColors) {
      const countRaw = String(addAnyCombinationGuildColors[2] || '').trim().toLowerCase();
      const amount = countRaw === 'that much'
        ? ({ kind: 'reference_amount', raw: 'that much' } as const)
        : parseQuantity(countRaw);
      if (amount.kind !== 'unknown') {
        const fixedCount = amount.kind === 'number' ? amount.value : null;
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyCombinationGuildColors[1]),
          mana: fixedCount && fixedCount > 0 ? buildRepeatedMana('{W}', fixedCount) : '{W}',
          ...(fixedCount && fixedCount > 0 ? {} : { amount }),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }
  }

  {
    const addManaForEachColor = clause.match(/^for\s+each\s+color\s+among\s+.+?,\s+adds?\s+one\s+mana\s+of\s+that\s+color$/i);
    if (addManaForEachColor) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
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

    if (/^(?:then\s+)?choose\s+(?:any\s+|a\s+|an\s+)?(?:creature\s+)?card\s+name$/i.test(clause)) {
      return withMeta({
        kind: 'choose_card_name',
        raw: rawClause,
      });
    }

    const lookAtHand = clause.match(/^(?:as\s+.+?\s+enters,\s*)?look\s+at\s+(?:an\s+opponent|target\s+opponent)(?:'|’)?s\s+hand$/i);
    if (lookAtHand) {
      return withMeta({
        kind: 'look_hand',
        who: { kind: 'target_opponent' },
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
    const chooseCardName = clause.match(
      /^(?:secretly\s+)?choose\s+a\s+(?:nonland\s+)?card\s+name(?:\s+other\s+than\s+a\s+basic\s+land\s+card\s+name)?\s*$/i
    );
    if (chooseCardName) {
      return withMeta({
        kind: 'choose_card_name',
        raw: rawClause,
        });
    }
  }

  {
    const chooseTargetCreature = clause.match(
      /^choose\s+(up to one\s+)?target\s+creature(?:\s+(you control|an opponent controls|your opponents control))?\s*$/i
    );
    if (chooseTargetCreature) {
      const targetText = chooseTargetCreature[2]
        ? `target creature ${chooseTargetCreature[2].toLowerCase()}`
        : 'target creature';
      return withMeta({
        kind: 'choose_target_creature',
        target: { kind: 'raw', text: targetText },
        ...(chooseTargetCreature[1] ? { optional: true } : {}),
        raw: rawClause,
        });
    }

    const chooseTargetObject = clause.match(/^choose\s+(up to one\s+)?(target\s+.+)$/i);
    if (
      chooseTargetObject &&
      /\b(?:spell|permanent|card|artifact|enchantment|land|planeswalker|battle)\b/i.test(String(chooseTargetObject[2] || '')) &&
      !/^target\s+(?:opponent|player)\b/i.test(String(chooseTargetObject[2] || ''))
    ) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseTargetObject[2] || '').trim()),
        ...(chooseTargetObject[1] ? { optional: true } : {}),
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

    const voterExtraTurn = clause.match(/^each\s+player\s+who\s+voted\s+for\s+.+?\s+takes?\s+an?\s+extra\s+turn\s+after\s+this\s+one\b/i);
    if (voterExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: { kind: 'each_player' },
        raw: rawClause,
        });
    }
  }

  {
    const drawClause = normalizeDrawClauseForParse(clause);

    const havePlayerDraw = drawClause.match(new RegExp(`^(?:(?:target opponent|that opponent|defending player|the defending player|that player)\\s+may\\s+have\\s+|you\\s+may\\s+have\\s+)(you|target player|target opponent|that player|that opponent)\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i'));
    if (havePlayerDraw) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(havePlayerDraw[1]),
        amount: parseQuantity(havePlayerDraw[2]),
        optional: true,
        raw: rawClause,
        });
    }

    const sharedDraw = drawClause.match(new RegExp(`^you\\s+and\\s+(.+?)\\s+each\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i'));
    if (sharedDraw) {
      return withMeta({
        kind: 'draw',
        who: sharedDrawSelector(sharedDraw[1]),
        amount: parseQuantity(sharedDraw[2]),
        raw: rawClause,
        });
    }

    const targetOpponentsEachDraw = drawClause.match(
      new RegExp(`^any\\s+number\\s+of\\s+target\\s+opponents\\s+each\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i')
    );
    if (targetOpponentsEachDraw) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_opponents' },
        amount: parseQuantity(targetOpponentsEachDraw[1]),
        raw: rawClause,
        });
    }

    const targetPlayersEachDraw = drawClause.match(
      new RegExp(`^any\\s+number\\s+of\\s+target\\s+players(?:\\s+other\\s+than\\s+that\\s+player)?\\s+each\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i')
    );
    if (targetPlayersEachDraw) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_players' },
        amount: parseQuantity(targetPlayersEachDraw[1]),
        raw: rawClause,
        });
    }

    const targetPlayersEachDrawEqual = drawClause.match(
      /^any\s+number\s+of\s+target\s+players(?:\s+other\s+than\s+that\s+player)?\s+each\s+draws?\s+cards?\s+equal\s+to\s+(.+?)(?:,\s*then\b[\s\S]*)?$/i
    );
    if (targetPlayersEachDrawEqual) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_players' },
        amount: parseDrawAmount(targetPlayersEachDrawEqual[1]),
        raw: rawClause,
        });
    }

    const drawEqual = drawClause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+cards?\\s+equal\\s+to\\s+(.+?)(?:,\\s*then\\b[\\s\\S]*)?$`, 'i'));
    if (drawEqual) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawEqual[1]),
        amount: parseDrawAmount(drawEqual[2]),
        raw: rawClause,
        });
    }

    const drawEqualPower = drawClause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+cards?\\s+equal\\s+to\\s+its\\s+power$`, 'i'));
    if (drawEqualPower) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawEqualPower[1]),
        amount: { kind: 'source_power' },
        raw: rawClause,
        });
    }

    const drawForEach = drawClause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+a\\s+card\\s+for\\s+each\\s+(.+)$`, 'i'));
    if (drawForEach) {
      const forEachText = String(drawForEach[2] || '').trim();
      const amountText = `a card for each ${forEachText}`;
      const parsedAmount = parseQuantity(amountText);
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawForEach[1]),
        amount: /\b(?:land\s+)?cards?\s+discarded\s+this\s+way\b/i.test(forEachText)
          ? { kind: 'reference_amount', raw: amountText }
          : parsedAmount.kind === 'reference_amount'
            ? parsedAmount
            : { kind: 'unknown', raw: amountText },
        raw: rawClause,
        });
    }

    const moreCards = drawClause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN}|[a-z0-9]+)\\s+more\\s+cards?\\b`, 'i')
    );
    if (moreCards) {

    const targetPlayersEachDrawEqual = drawClause.match(
      /^any\s+number\s+of\s+target\s+players(?:\s+other\s+than\s+that\s+player)?\s+each\s+draws?\s+cards?\s+equal\s+to\s+(.+?)(?:,\s*then\b[\s\S]*)?$/i
    );
    if (targetPlayersEachDrawEqual) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_players' },
        amount: parseDrawAmount(targetPlayersEachDrawEqual[1]),
        raw: rawClause,
        });
    }
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(moreCards[1]),
        amount: parseQuantity(moreCards[2]),
        raw: rawClause,
        });
    }

    const draw = drawClause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i')
    );
    if (draw) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(draw[1]),
        amount: parseQuantity(draw[2]),
        raw: rawClause,
        });
    }

    const drawDefault = drawClause.match(new RegExp(`^(?:may\\s+)?draw\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i'));
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
    const normalizedAdditionalCombatClause = clause.replace(/[."]+\s*$/, '').trim();
    const addMultipleExtraCombat = normalizedAdditionalCombatClause.match(
      /^(?:after\s+this\s+main\s+phase,?\s+there\s+are|this\s+main\s+phase\s+is\s+followed\s+by)\s+(.+?)\s+additional\s+combat\s+phases$/i
    );
    if (addMultipleExtraCombat) {
      const count = parseSmallNumber(String(addMultipleExtraCombat[1] || '').trim());
      if (count && count > 0) {
        return withMeta({
          kind: 'add_extra_combat',
          ...(count > 1 ? { count } : {}),
          raw: rawClause,
        });
      }
    }

    const addExtraCombat = clause.match(
      /^(?:(?:after|and after)\s+(?:this\s+phase|this\s+main\s+phase|this\s+combat\s+phase|the\s+second\s+main\s+phase\s+this\s+turn),?\s+)?(?:there(?:'|’)s|there\s+is)\s+an\s+additional\s+combat\s+phase(?:\s+after\s+this\s+phase)?(?:,?\s+followed\s+by\s+an\s+additional\s+main\s+phase)?[."]*$/i
    );
    if (addExtraCombat) {
      return withMeta({
        kind: 'add_extra_combat',
        followedByAdditionalMain: /followed by an additional main phase/i.test(normalizedAdditionalCombatClause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    if (/^choose\s+a\s+card\s+type\s*$/i.test(clause)) {
      return withMeta({
        kind: 'player_choice',
        choice: 'card_type',
        raw: rawClause,
      });
    }

    if (/^choose\s+a\s+letter\s*$/i.test(clause)) {
      return withMeta({
        kind: 'player_choice',
        choice: 'letter',
        raw: rawClause,
      });
    }

    if (/^choose\s+odd\s+or\s+even\s*$/i.test(clause)) {
      return withMeta({
        kind: 'player_choice',
        choice: 'odd_even',
        options: ['odd', 'even'],
        raw: rawClause,
      });
    }
  }

    const chooseTwoTargetCreatures = clause.match(/^choose\s+(target\s+creature\s+you\s+control\s+and\s+target\s+creature\s+(?:an\s+opponent\s+controls|you\s+don(?:'|â€™)?t\s+control))$/i);
    if (chooseTwoTargetCreatures) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseTwoTargetCreatures[1] || '').trim()),
        raw: rawClause,
      });
    }

    const chooseActivePlayerCreature = clause.match(/^choose\s+(target\s+non-wall\s+creature\s+the\s+active\s+player\s+has\s+controlled\s+continuously\s+since\s+the\s+beginning\s+of\s+the\s+turn)$/i);
    if (chooseActivePlayerCreature) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseActivePlayerCreature[1] || '').trim()),
        raw: rawClause,
      });
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
    const exiledCardPermission = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\s+)?(cast|play)s?\s+(the exiled card|that card|this card|it)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+its\s+mana\s+cost)?(?:\s+this\s+turn)?(?:\s+if\s+.+)?$`, 'i')
    );
    if (exiledCardPermission) {
      return withMeta({
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(exiledCardPermission[1]),
        what: parseObjectSelector(String(exiledCardPermission[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(clause) ? 'this_turn' : 'during_resolution',
        permission: String(exiledCardPermission[2] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+its\s+mana\s+cost/i.test(clause) || undefined,
        optional: true,
        raw: rawClause,
      });
    }

    const castOrHandPermission = clause.match(/^(?:you\s+may\s+)?cast\s+(it|that card|the exiled card)\s+without\s+paying\s+its\s+mana\s+cost\s+or\s+put\s+it\s+into\s+your\s+hand$/i);
    if (castOrHandPermission) {
      return withMeta({
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(castOrHandPermission[1] || '').trim()),
        duration: 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        optional: true,
        raw: rawClause,
      });
    }
  }

  {
    const copyStackObject = clause.match(/^copy\s+(target\s+.+)$/i);
    if (copyStackObject && /\b(?:spell|spells|ability|abilities)\b/i.test(String(copyStackObject[1] || ''))) {
      if (/^\s*\d+\s*\|/i.test(rawClause)) return null;
      return withMeta({
        kind: 'copy_spell',
        subject: 'target_spell',
        target: parseObjectSelector(String(copyStackObject[1] || '').trim()),
        raw: rawClause,
      });
    }

    const copyThatStackObject = clause.match(/^copy\s+(that\s+(?:spell|ability))$/i);
    if (copyThatStackObject) {
      if (/^\s*\d+\s*\|/i.test(rawClause)) return null;
      return withMeta({
        kind: 'copy_spell',
        subject: 'target_spell',
        target: parseObjectSelector(String(copyThatStackObject[1] || '').trim()),
        raw: rawClause,
      });
    }
  }

  {
    const voteGainControl = clause.match(/^for\s+each\s+.+?\s+vote,\s+choose\s+(.+?)\s+and\s+gain\s+control\s+of\s+it$/i);
    if (voteGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(voteGainControl[1] || 'it').trim()),
        newController: { kind: 'you' },
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const reciprocalControl = clause.match(/^you\s+and\s+(?:that|target)\s+opponent\s+each\s+gain\s+control\s+of\s+all\s+creatures\s+the\s+other\s+controls\s+until\s+end\s+of\s+turn$/i);
    if (reciprocalControl) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector('all creatures you control'),
        second: parseObjectSelector('all creatures that opponent controls'),
        raw: rawClause,
      });
    }

    const leadingUntilGainControl = clause.match(/^until\s+end\s+of\s+turn,\s+gain\s+control\s+of\s+(.+)$/i);
    if (leadingUntilGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(leadingUntilGainControl[1] || '').trim()),
        newController: { kind: 'you' },
        duration: 'until_end_of_turn',
        raw: rawClause,
        });
    }

    const havePlayerGainControl = clause.match(/^(?:you\s+may\s+)?have\s+(.+?)\s+gain\s+control\s+of\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
    if (havePlayerGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(havePlayerGainControl[2] || '').trim()),
        newController: parsePlayerSelector(String(havePlayerGainControl[1] || '').trim()),
        duration: 'until_end_of_turn',
        optional: true,
        raw: rawClause,
        });
    }

    const untapThenGainControl = clause.match(/^(that\s+player|target\s+player|they)\s+untaps?\s+(.+?)\s+and\s+gains?\s+control\s+of\s+it$/i);
    if (untapThenGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(untapThenGainControl[2] || 'it').trim()),
        newController: parsePlayerSelector(String(untapThenGainControl[1] || '').trim()),
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const targetPlayerGainsControl = clause.match(/^(target\s+player(?:\s+other\s+than\s+.+?)?)\s+gains?\s+control\s+of\s+(.+)$/i);
    if (targetPlayerGainsControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(targetPlayerGainsControl[2] || '').trim()),
        newController: parsePlayerSelector(String(targetPlayerGainsControl[1] || '').trim()),
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const lifeTotalPlayerGainsControl = clause.match(/^(the\s+player\s+with\s+the\s+(?:lowest|most)\s+life\s+total?|the\s+player\s+with\s+the\s+most\s+life)\s+gains?\s+control\s+of\s+(.+)$/i);
    if (lifeTotalPlayerGainsControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(lifeTotalPlayerGainsControl[2] || '').trim()),
        newController: parsePlayerSelector(String(lifeTotalPlayerGainsControl[1] || '').trim()),
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const gainControl = clause.match(
      new RegExp(`^(?:for\\s+each\\s+opponent,\\s+)?${PLAYER_SUBJECT_PREFIX}gain(?:s)?\\s+control\\s+of\\s+(.+?)(?:\\s+(until\\s+end\\s+of\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura\\s+is\\s+attached\\s+to\\s+it|for\\s+as\\s+long\\s+as\\s+you\\s+control\\s+[^.]+))?$`, 'i')
    );
    if (gainControl) {
      const durationRaw = String(gainControl[3] || '').trim().toLowerCase();
      const duration = /until\s+end\s+of\s+turn/i.test(durationRaw)
        ? 'until_end_of_turn'
        : /aura\s+is\s+attached/i.test(durationRaw)
          ? 'as_long_as_attached'
          : /as\s+long\s+as\s+you\s+control/i.test(durationRaw)
            ? 'as_long_as_control_source'
            : 'indefinite';
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(gainControl[2]),
        newController: parsePlayerSelector(gainControl[1]),
        duration,
        raw: rawClause,
        });
    }
  }

  {
    const exchangeControl = clause.match(/^(?:you\s+may\s+)?exchange\s+control\s+of\s+(.+?)\s+and\s+(.+)$/i);
    if (exchangeControl) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector(String(exchangeControl[1] || '').trim()),
        second: parseObjectSelector(String(exchangeControl[2] || '').trim()),
        raw: rawClause,
      });
    }

    const exchangeTwoTargets = clause.match(/^(?:you\s+may\s+)?exchange\s+control\s+of\s+two\s+(?:other\s+)?target\s+(.+)$/i);
    if (exchangeTwoTargets) {
      const targetText = String(exchangeTwoTargets[1] || '').trim().replace(/s\b/i, '');
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector(`first target ${targetText}`),
        second: parseObjectSelector(`second target ${targetText}`),
        raw: rawClause,
      });
    }

    const exchangeThose = clause.match(/^exchange\s+control\s+of\s+those\s+permanents$/i);
    if (exchangeThose) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector('first of those permanents'),
        second: parseObjectSelector('second of those permanents'),
        raw: rawClause,
      });
    }

    const playersExchangeThose = clause.match(/^those\s+players\s+exchange\s+control\s+of\s+those\s+creatures$/i);
    if (playersExchangeThose) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector('first of those creatures'),
        second: parseObjectSelector('second of those creatures'),
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
    const withCounters = clause.match(
      /^(?:tapped(?:\s+and)?\s+)?with\s+((?:a\s+number\s+of|number\s+of|a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(?:additional\s+)?(.+?)\s+counters?\s+on\s+(?:it|him|her)(?:\s+(for\s+each|equal\s+to)\s+(.+?))?(?:,\s*where\s+.+)?$/i
    );
    if (withCounters && !/\byour choice of\b/i.test(clause)) {
      const amountText = String(withCounters[1] || 'a').trim().replace(/\s+of$/i, '');
      const scalingText = [withCounters[3], withCounters[4]].filter(Boolean).join(' ').trim();
      return withMeta({
        kind: 'add_counter',
        amount: scalingText ? parseScaledCounterQuantity(amountText, scalingText) : parseCounterQuantity(amountText),
        counter: normalizeCounterName(String(withCounters[2] || '')),
        target: parseObjectSelector('this permanent'),
        raw: rawClause,
        });
    }
  }

  {
    const entersWithCounters = clause.match(
      /^(.*?)\s+enters?(?:\s+the\s+battlefield)?(?:\s+tapped)?\s+with\s+((?:a\s+number\s+of|number\s+of|a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(?:additional\s+)?(.+?)\s+counters?\s+on\s+(?:it|them|him|her)(?:\s+(for\s+each|equal\s+to)\s+(.+?))?(?:\s+if\s+.+)?(?:\s+and\s+.+)?(?:,\s*where\s+.+)?$/i
    );
    if (entersWithCounters && !/\byour choice of\b/i.test(clause)) {
      const subjectText = String(entersWithCounters[1] || '').trim();
      if (/\(|\b(?:unleash|graft|sunburst|devour|bloodthirst|riot|modular)\b/i.test(subjectText)) return null;
      const amountText = String(entersWithCounters[2] || 'a').trim().replace(/\s+of$/i, '');
      const scalingText = [entersWithCounters[4], entersWithCounters[5]].filter(Boolean).join(' ').trim();
      const targetText = /^(?:it|he|she|this(?: creature| permanent)?)$/i.test(subjectText) ? 'this permanent' : subjectText;
      return withMeta({
        kind: 'add_counter',
        amount: scalingText ? parseScaledCounterQuantity(amountText, scalingText) : parseCounterQuantity(amountText),
        counter: normalizeCounterName(String(entersWithCounters[3] || '')),
        target: parseObjectSelector(targetText || 'it'),
        raw: rawClause,
        });
    }
  }

  {
    const forEachCounterTail = clause.match(/^for\s+each\s+[^,]+,\s+(.+)$/i);
    if (forEachCounterTail) {
      const parsed = tryParseSimpleActionClause({
        clause: normalizeOracleText(String(forEachCounterTail[1] || '').trim()),
        rawClause: rawClause,
        withMeta,
      });
      if (parsed?.kind === 'add_counter') return parsed;
    }
  }

  {
    const eachFriendCounters = clause.match(/^each\s+friend\s+puts?\s+(a|an|one|\d+|[a-z]+)\s+(.+?)\s+counters?\s+on\s+(.+)$/i);
    if (eachFriendCounters) {
      return withMeta({
        kind: 'add_counter',
        amount: parseCounterQuantity(eachFriendCounters[1]),
        counter: normalizeCounterName(String(eachFriendCounters[2] || '').trim()),
        target: parseObjectSelector(eachFriendCounters[3]),
        raw: rawClause,
        });
    }
  }

  {
    const choiceKeywordCounter = clause.match(/^put\s+your\s+choice\s+of\s+(.+?)\s+counter\s+on\s+(.+)$/i);
    if (choiceKeywordCounter) {
      return withMeta({
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: `choice: ${String(choiceKeywordCounter[1] || '').trim()}`,
        target: parseObjectSelector(choiceKeywordCounter[2]),
        raw: rawClause,
        });
    }
  }

  {
    const sameKindCounters = clause.match(/^put\s+the\s+same\s+number\s+of\s+each\s+kind\s+of\s+counter\s+on\s+(.+)$/i);
    if (sameKindCounters) {
      return withMeta({
        kind: 'add_counter',
        amount: { kind: 'unknown', raw: 'the same number' },
        counter: 'each kind',
        target: parseObjectSelector(sameKindCounters[1]),
        raw: rawClause,
        });
    }
  }

  {
    const addCounters = clause.match(new RegExp(`^(?:otherwise,?\\s*)?${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?put\\s+(${REFERENCEABLE_COUNTER_AMOUNT_PATTERN})\\s+(.+?)\\s+counters?\\s+on\\s+(.+)$`, 'i'));
    if (addCounters && !/\bonto\s+the\s+battlefield\b/i.test(clause)) {
      return withMeta({
        kind: 'add_counter',
        amount: parseCounterQuantity(addCounters[2]),
        counter: normalizeCounterName(String(addCounters[3] || '')),
        target: parseObjectSelector(addCounters[4]),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const distributeCounters = clause.match(
      new RegExp(`^(?:${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?)?distribute\\s+(up to\\s+)?(${REFERENCEABLE_COUNTER_AMOUNT_PATTERN})\\s+(.+?)\\s+counters?\\s+among\\s+(.+)$`, 'i')
    );
    if (distributeCounters) {
      return withMeta({
        kind: 'add_counter',
        amount: parseCounterQuantity(distributeCounters[3]),
        counter: normalizeCounterName(String(distributeCounters[4] || '')),
        target: parseObjectSelector(distributeCounters[5]),
        optional: Boolean(distributeCounters[2]) || /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const addNumberOfCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?put\\s+a\\s+number\\s+of\\s+(.+?)\\s+counters?\\s+(?:equal\\s+to\\s+(.+?)\\s+)?on\\s+(.+?)(?:\\s+equal\\s+to\\s+(.+))?$`, 'i')
    );
    if (addNumberOfCounters && !/\bonto\s+the\s+battlefield\b/i.test(clause)) {
      const equalText = String(addNumberOfCounters[3] || addNumberOfCounters[5] || '').trim();
      const cardStatAmount = equalText.match(/^that\s+card(?:'|’)?s\s+(power|toughness)$/i);
      const creatureStatAmount = equalText.match(/^that\s+creature(?:'|’)?s\s+(power|toughness)$/i);
      const amount = cardStatAmount
        ? { kind: 'object_stat' as const, subject: 'that_card' as const, stat: String(cardStatAmount[1] || '').toLowerCase() as 'power' | 'toughness' }
        : creatureStatAmount
          ? { kind: 'reference_amount' as const, raw: `equal to ${equalText}` }
          : equalText ? parseQuantity(`a number equal to ${equalText}`) : { kind: 'unknown' as const, raw: 'a number' };
      return withMeta({
        kind: 'add_counter',
        amount: amount.kind === 'unknown' && equalText ? { kind: 'unknown', raw: `equal to ${equalText}` } : amount,
        counter: normalizeCounterName(String(addNumberOfCounters[2] || '')),
        target: parseObjectSelector(addNumberOfCounters[4]),
        optional: /\bmay\b/i.test(clause) || undefined,
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
    const removeUpToAnyCounters = clause.match(/^remove\s+up\s+to\s+(a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+counters?\s+from\s+(.+)$/i);
    if (removeUpToAnyCounters) {
      return withMeta({
        kind: 'remove_counter',
        amount: parseQuantity(String(removeUpToAnyCounters[1] || '').trim()),
        counter: 'counter',
        target: parseObjectSelector(removeUpToAnyCounters[2]),
        optional: true,
        raw: rawClause,
        });
    }

    const removeUpToCounters = clause.match(/^remove\s+up\s+to\s+(a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+(.+?)\s+counters?\s+from\s+(.+)$/i);
    if (removeUpToCounters) {
      return withMeta({
        kind: 'remove_counter',
        amount: parseQuantity(String(removeUpToCounters[1] || '').trim()),
        counter: normalizeCounterName(String(removeUpToCounters[2] || '')),
        target: parseObjectSelector(removeUpToCounters[3]),
        optional: true,
        raw: rawClause,
        });
    }

    const removeCounters = clause.match(/^remove\s+((?:up\s+to\s+)?(?:a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+))\s+(.+?)\s+counters?\s+from\s+(.+)$/i);
    if (removeCounters) {
      const amountRaw = String(removeCounters[1] || '').replace(/^up\s+to\s+/i, '').trim();
      return withMeta({
        kind: 'remove_counter',
        amount: parseQuantity(amountRaw),
        counter: normalizeCounterName(String(removeCounters[2] || '')),
        target: parseObjectSelector(removeCounters[3]),
        optional: /^up\s+to\s+/i.test(String(removeCounters[1] || '')) || undefined,
        raw: rawClause,
        });
    }

    const removeUnnamedCounter = clause.match(/^remove\s+(a|an|one)\s+counter\s+from\s+(.+)$/i);
    if (removeUnnamedCounter) {
      return withMeta({
        kind: 'remove_counter',
        amount: parseQuantity(String(removeUnnamedCounter[1] || '').trim()),
        counter: 'counter',
        target: parseObjectSelector(removeUnnamedCounter[2]),
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
    const exileNamedCardsFromZones = clause.match(
      /^search\s+(target\s+opponent|target\s+player|that\s+player)(?:'|’)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+(any\s+number\s+of\s+|up\s+to\s+([a-z]+|\d+)\s+)?cards?\s+with\s+that\s+name\s+and\s+exile\s+them$/i
    );
    if (exileNamedCardsFromZones) {
      const limitText = String(exileNamedCardsFromZones[2] || '').trim();
      const parsedLimit = parseSmallNumber(String(exileNamedCardsFromZones[3] || limitText).trim());
      return withMeta({
        kind: 'exile_named_cards_from_zones',
        who: parsePlayerSelector(exileNamedCardsFromZones[1]),
        zones: ['graveyard', 'hand', 'library'],
        nameSource: 'chosen_card_name',
        maxResults: /^any\s+number\s+of$/i.test(limitText) ? 'any_number' : parsedLimit || undefined,
        raw: rawClause,
        });
    }

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

    const revealTopToHand = clause.match(/^reveal\s+the\s+top\s+card\s+of\s+your\s+library\s+and\s+put\s+that\s+card\s+into\s+your\s+hand$/i);
    if (revealTopToHand) {
      return withMeta({
        kind: 'move_zone',
        what: parseObjectSelector('the top card of your library'),
        to: 'hand',
        toRaw: 'your hand',
        raw: rawClause,
        });
    }

    const revealUntilTop = clause.match(/^reveal\s+cards?\s+from\s+the\s+top\s+of\s+your\s+library\s+until\s+you\s+reveal\s+(.+)$/i);
    if (revealUntilTop) {
      return withMeta({
        kind: 'reveal_top',
        who: { kind: 'you' },
        amount: { kind: 'reference_amount', raw: `until you reveal ${String(revealUntilTop[1] || '').trim()}` },
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

    const opponentSeparatesPiles = clause.match(/^an\s+opponent\s+separates\s+those\s+cards\s+into\s+two\s+piles$/i);
    if (opponentSeparatesPiles) {
      return withMeta({
        kind: 'choose_pile',
        chooser: { kind: 'target_opponent' },
        source: 'top_library',
        raw: rawClause,
        });
    }

    if (/^(?:you\s+)?choose\s+(?:a\s+|an\s+)?(?:nonland\s+)?card\s+from\s+it$/i.test(clause)) {
      return withMeta({
        kind: 'choose_card_name',
        raw: rawClause,
        });
    }

    if (/^choose\s+an\s+opponent\s+at\s+random$/i.test(clause)) {
      return withMeta({
        kind: 'choose_opponent',
        raw: rawClause,
        });
    }

    if (/^choose\s+any\s+target$/i.test(clause)) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector('any target'),
        raw: rawClause,
        });
    }

    if (/^spells\s+with\s+the\s+chosen\s+name\s+can(?:not|'t)\s+be\s+cast$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('source'),
        effectText: [rawClause],
        duration: 'static',
        raw: rawClause,
        });
    }

    if (/^(?:spells\b.+\bcost\b.+\bto\s+cast|spend\s+only\b.+|spend\s+this\s+mana\s+only\b.+|(?:you\s+may\s+)?cast\s+spells\s+as\s+though\b.+|each\s+opponent\s+can(?:not|'t)\s+draw\s+more\s+than\s+one\s+card\s+each\s+turn|activated\s+abilities\b.+|creature\s+spells\s+can(?:not|'t)\s+be\s+countered|during\s+your\s+turn,\s+your\s+opponents\s+can(?:not|'t)\s+cast\s+spells\s+or\s+activate\s+abilities\b.+|this\s+permanent\s+is\s+all\s+colors|as\s+long\s+as\b.+|enchanted\s+artifact\s+is\b.+|you\s+may\s+have\b.+\s+enter\s+as\s+a\s+copy\b.+|creatures\s+you\s+control\s+can\s+attack\s+as\s+though\b.+)$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('source'),
        effectText: [rawClause],
        duration: 'static',
        raw: rawClause,
        });
    }

    if (/^(?:then\s+)?discard\s+one\s+of\s+them$/i.test(clause)) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        target: parseObjectSelector('one of them'),
        raw: rawClause,
        });
    }

    const staticLandAnimationWithAbility = clause.match(/^(.+?)\s+becomes?\s+a\s+(\d+)\/(\d+)\s+(.+?)\s+creature(?:\s+with\s+(.+?))?(?:\s+that(?:'|â€™)?s\s+still\s+a\s+land)?$/i);
    if (staticLandAnimationWithAbility && !/^until\s+end\s+of\s+turn,/i.test(clause) && /\bland\b/i.test(String(staticLandAnimationWithAbility[1] || ''))) {
      const abilityText = String(staticLandAnimationWithAbility[5] || '').replace(/\s+that(?:'|â€™)?s\s+still\s+a\s+land$/i, '').trim().toLowerCase();
      const abilities = abilityText === 'haste' ? ['haste'] : [];
      const typeText = String(staticLandAnimationWithAbility[4] || '').trim();
      return withMeta({
        kind: 'animate_permanent',
        target: parseObjectSelector(String(staticLandAnimationWithAbility[1] || '').trim()),
        power: Number.parseInt(String(staticLandAnimationWithAbility[2] || '0'), 10),
        toughness: Number.parseInt(String(staticLandAnimationWithAbility[3] || '0'), 10),
        addTypes: typeText ? [...typeText.split(/\s+/).filter(Boolean), 'creature'] : ['creature'],
        ...(abilities.length > 0 ? { abilities } : {}),
        duration: 'static',
        raw: rawClause,
      });
    }

    const animatePermanent = clause.match(/^(.+?)\s+becomes?\s+a\s+(\d+)\/(\d+)(?:\s+(.+?))?\s+creature\s+until\s+end\s+of\s+turn$/i);
    if (animatePermanent) {
      return withMeta({
        kind: 'animate_permanent',
        target: parseObjectSelector(animatePermanent[1]),
        power: Number.parseInt(String(animatePermanent[2] || '0'), 10),
        toughness: Number.parseInt(String(animatePermanent[3] || '0'), 10),
        addTypes: ['creature'],
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const staticLandAnimation = clause.match(/^(.+?)\s+are\s+(\d+)\/(\d+)\s+creatures?\s+that\s+are\s+still\s+lands$/i);
    if (staticLandAnimation) {
      return withMeta({
        kind: 'animate_permanent',
        target: parseObjectSelector(String(staticLandAnimation[1] || '').trim()),
        power: Number.parseInt(String(staticLandAnimation[2] || '0'), 10),
        toughness: Number.parseInt(String(staticLandAnimation[3] || '0'), 10),
        addTypes: ['creature'],
        duration: 'static',
        raw: rawClause,
        });
    }

    const phaseOut = clause.match(/^(.+?)\s+phases\s+out(?:\s+until\s+.+)?$/i);
    if (phaseOut) {
      return withMeta({
        kind: 'phase_out',
        target: parseObjectSelector(phaseOut[1]),
        raw: rawClause,
        });
    }

    const phaseOutPlural = clause.match(/^(.+?)\s+phase\s+out$/i);
    if (phaseOutPlural) {
      return withMeta({
        kind: 'phase_out',
        target: parseObjectSelector(String(phaseOutPlural[1] || '').trim()),
        raw: rawClause,
        });
    }

    if (/^.+?\s+can(?:not|'t)\s+be\s+regenerated\s+this\s+turn$/i.test(clause) || /^.+?\s+loses\s+flying\s+until\s+end\s+of\s+turn$/i.test(clause)) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(clause).replace(/\s+(?:can(?:not|'t)\s+be\s+regenerated\s+this\s+turn|loses\s+flying\s+until\s+end\s+of\s+turn)$/i, '')),
        effectText: [rawClause],
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const leadingTemporaryAnimation = clause.match(/^until\s+end\s+of\s+turn,\s+(.+?)\s+becomes?\s+a\s+(\d+)\/(\d+)(?:\s+(.+?))?\s+creature$/i);
    if (leadingTemporaryAnimation) {
      const typeText = String(leadingTemporaryAnimation[4] || '').trim();
      return withMeta({
        kind: 'animate_permanent',
        target: parseObjectSelector(String(leadingTemporaryAnimation[1] || '').trim()),
        power: Number.parseInt(String(leadingTemporaryAnimation[2] || '0'), 10),
        toughness: Number.parseInt(String(leadingTemporaryAnimation[3] || '0'), 10),
        addTypes: typeText ? [...typeText.split(/\s+/).filter(Boolean), 'creature'] : ['creature'],
        duration: 'end_of_turn',
        raw: rawClause,
      });
    }

    const becomesUntilEnd = clause.match(/^(.+?)\s+becomes?\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
    if (becomesUntilEnd) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(becomesUntilEnd[1]),
        effectText: [`becomes ${String(becomesUntilEnd[2] || '').trim()}`],
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const shuffleGraveyard = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}shuffles?\\s+(?:your|their|his or her)\\s+graveyard\\s+into\\s+(?:your|their|his or her)\\s+library$`, 'i')
    );
    if (shuffleGraveyard) {
      return withMeta({
        kind: 'shuffle_zones_into_library',
        who: parsePlayerSelector(shuffleGraveyard[1]),
        zones: ['graveyard'],
        raw: rawClause,
        });
    }

    if (/^each\s+player\s+who\s+searched\s+their\s+library\s+this\s+way\s+shuffles$/i.test(clause)) {
      return withMeta({
        kind: 'shuffle_library',
        who: { kind: 'each_player' },
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
    const discardAnyNumber = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+any\\s+number\\s+of\\s+cards$`, 'i'));
    if (discardAnyNumber) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAnyNumber[1]),
        amount: { kind: 'any_number' },
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const discardOneOrMore = clause.match(/^(?:you\s+may\s+)?discard\s+one\s+or\s+more\s+(.+?\s+cards?)\b/i);
    if (discardOneOrMore) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'any_number' },
        target: parseObjectSelector(String(discardOneOrMore[1] || '').trim()),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    const moveSingleCounter = clause.match(/^(?:you\s+may\s+)?move\s+(?!(?:any)\b)(a|an|one|\d+|[a-z]+)\s+(.+?)\s+counters?\s+from\s+(.+?)\s+onto\s+(.+)$/i);
    if (moveSingleCounter) {
      return withMeta({
        kind: 'move_counters',
        from: parseObjectSelector(String(moveSingleCounter[3] || '').trim()),
        to: parseObjectSelector(String(moveSingleCounter[4] || '').trim()),
        counter: normalizeCounterName(String(moveSingleCounter[2] || '').trim()),
        amount: parseQuantity(String(moveSingleCounter[1] || '').trim()),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const moveAnyCounters = clause.match(/^move\s+any\s+number\s+of\s+(.+?)\s+counters?\s+from\s+(.+?)\s+onto\s+(.+)$/i);
    if (moveAnyCounters) {
      return withMeta({
        kind: 'move_counters',
        from: parseObjectSelector(String(moveAnyCounters[2] || '').trim()),
        to: parseObjectSelector(String(moveAnyCounters[3] || '').trim()),
        counter: normalizeCounterName(String(moveAnyCounters[1] || '').trim()),
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

    const forceBlockThisTurn = clause.match(/^((?:up\s+to\s+one\s+)?(?:another\s+)?target\s+.+?|they|it|those\s+creatures)\s+blocks?\s+this\s+(?:turn|combat)\s+if\s+able$/i);
    if (forceBlockThisTurn) {
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector(String(forceBlockThisTurn[1] || '').trim()),
        attacker: parseObjectSelector('a creature attacking its controller'),
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const contextualForceBlockThisTurn = clause.match(/^(.+?)\s+blocks?\s+(.+?)\s+this\s+(?:turn|combat)\s+if\s+able$/i);
    if (contextualForceBlockThisTurn && /^(?:(?:up\s+to\s+one\s+)?(?:another\s+)?target\s+.+|all\s+creatures\s+with\s+.+)$/i.test(String(contextualForceBlockThisTurn[1] || '').trim())) {
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector(String(contextualForceBlockThisTurn[1] || '').trim()),
        attacker: parseObjectSelector(String(contextualForceBlockThisTurn[2] || '').trim()),
        duration: 'end_of_turn',
        raw: rawClause,
        });
    }

    const mustBeBlockedThisTurn = clause.match(/^(.+?)\s+must\s+be\s+blocked\s+this\s+turn\s+if\s+able$/i);
    if (mustBeBlockedThisTurn) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(mustBeBlockedThisTurn[1] || '').trim()),
        duration: 'this_turn',
        effectText: ['must be blocked if able'],
        raw: rawClause,
      });
    }

    const attacksPlayerThisCombat = clause.match(/^(this\s+creature|that\s+creature|it)\s+attacks\s+that\s+player\s+this\s+combat\s+if\s+able$/i);
    if (attacksPlayerThisCombat) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(attacksPlayerThisCombat[1] || '').trim()),
        duration: 'this_turn',
        effectText: ['attacks that player this combat if able'],
        raw: rawClause,
      });
    }

    const attacksEachCombat = clause.match(/^(.+?)\s+attack\s+each\s+combat\s+if\s+able$/i);
    if (attacksEachCombat) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(attacksEachCombat[1] || '').trim()),
        effectText: ['attack each combat if able'],
        duration: 'static',
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
    if (/^the\s+damage\s+can't\s+be\s+prevented$/i.test(clause)) {
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
    const addVariableAnyColorMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+x\\s+mana\\s+of\\s+any\\s+one\\s+color(?:,\\s*where\\s+x\\s+is\\s+.+)?$`, 'i'));
    if (addVariableAnyColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addVariableAnyColorMana[1]),
        mana: '{X}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addProducedTypeMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+type\\s+that\\s+.+?\\s+produced$`, 'i'));
    if (addProducedTypeMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addProducedTypeMana[1]),
        mana: '{C}',
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addManaChoice = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+((?:\\{[^}]+\\})+(?:(?:\\s*,\\s*|\\s+or\\s+|\\s*,\\s*or\\s*)(?:\\{[^}]+\\})+)+)\\s*$`,
        'i'
      )
    );
    if (addManaChoice) {
      const manaOptions = parseManaOptionGroupList(String(addManaChoice[2] || '').trim());
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

    if (/^clash\s+with\s+defending\s+player\b/i.test(clause)) {
      return withMeta({
        kind: 'clash',
        who: parsePlayerSelector('you'),
        opponent: { kind: 'target_opponent' },
        raw: rawClause,
        });
    }
  }

  {
    const willVote = clause.match(/^will\s+of\s+the\s+planeswalkers\s+-\s+starting\s+with\s+(.+?),\s*(each player)\s+votes?\s+for\s+(.+)$/i);
    if (willVote) {
      const choices = String(willVote[3] || '')
        .split(/\s*,\s*|\s+or\s+/i)
        .map(choice => choice.trim().replace(/^(?:an?|the)\s+/i, '').trim())
        .filter(Boolean);
      if (choices.length >= 2) {
        return withMeta({
          kind: 'vote',
          voters: parsePlayerSelector(willVote[2]),
          startingWith: parsePlayerSelector(willVote[1]),
          choices,
          raw: rawClause,
        });
      }
    }

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
    const investigate = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:investigate|investigates)(?:\\s+(twice|that many|that much|\\d+|x|[a-z]+)(?:\\s+times)?)?\\b$`, 'i'));
    if (investigate) {
      return withMeta({
        kind: 'investigate',
        who: parsePlayerSelector(investigate[1]),
        amount: /^twice$/i.test(String(investigate[2] || '')) ? { kind: 'number', value: 2 } : parseQuantity(investigate[2] || '1'),
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
    const creatureTypeChoiceMatch = clause.match(/^(.+?)\s+becomes\s+the\s+creature\s+type\s+of\s+your\s+choice\s+until\s+end\s+of\s+turn$/i);
    if (creatureTypeChoiceMatch) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(creatureTypeChoiceMatch[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['becomes the creature type of your choice'],
        raw: rawClause,
        });
    }

    const colorChoiceMatch = clause.match(/^(.+?)\s+becomes\s+the\s+color\s+of\s+your\s+choice\s+until\s+end\s+of\s+turn$/i);
    if (colorChoiceMatch) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(colorChoiceMatch[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['becomes the color of your choice'],
        raw: rawClause,
      });
    }

    const chosenTypeAdditionMatch = clause.match(/^(this\s+creature|this\s+permanent|it|creatures\s+you\s+control)\s+(?:is|are)\s+the\s+chosen\s+type\s+in\s+addition\s+to\s+(?:its|their)\s+other\s+types$/i);
    if (chosenTypeAdditionMatch) {
      return withMeta({
        kind: 'add_types',
        target: parseObjectSelector(String(chosenTypeAdditionMatch[1] || '').trim()),
        addTypes: ['chosen type'],
        raw: rawClause,
      });
    }

    const chosenColorStaticMatch = clause.match(/^(.+?)\s+(?:is|are)\s+the\s+chosen\s+color$/i);
    if (chosenColorStaticMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(chosenColorStaticMatch[1] || '').trim()),
        effectText: ['is the chosen color'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const tokensGainHasteMatch = clause.match(/^(those\s+tokens|these\s+tokens|the\s+tokens|tokens\s+created\s+this\s+way)\s+gain\s+haste$/i);
    if (tokensGainHasteMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(tokensGainHasteMatch[1] || '').trim()),
        abilities: ['haste'],
        raw: rawClause,
      });
    }

    const partyClassAdditionMatch = clause.match(/^(this\s+permanent|this\s+creature|it)\s+is\s+also\s+a\s+Cleric,\s+Rogue,\s+Warrior,\s+and\s+Wizard$/i);
    if (partyClassAdditionMatch) {
      return withMeta({
        kind: 'add_types',
        target: parseObjectSelector(String(partyClassAdditionMatch[1] || '').trim()),
        addTypes: ['Cleric', 'Rogue', 'Warrior', 'Wizard'],
        raw: rawClause,
      });
    }

    const enchantedPermanentTypeLock = clause.match(/^(enchanted\s+permanent)\s+is\s+an\s+enchantment\s+and\s+loses\s+all\s+other\s+card\s+types$/i);
    if (enchantedPermanentTypeLock) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(enchantedPermanentTypeLock[1] || '').trim()),
        effectText: ['is an enchantment and loses all other card types'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const equippedPermanentCreatureType = clause.match(
      /^(equipped\s+permanent)\s+isn(?:'|â€™)t\s+a\s+planeswalker\s+and\s+is\s+a\s+creature\s+in\s+addition\s+to\s+its\s+other\s+types$/i
    );
    if (equippedPermanentCreatureType) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(equippedPermanentCreatureType[1] || '').trim()),
        effectText: ["isn't a planeswalker and is a creature in addition to its other types"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const globalColorlessMatch = clause.match(
      /^(all\s+cards\s+that\s+aren(?:'|â€™)?t\s+on\s+the\s+battlefield,\s+spells,\s+and\s+permanents)\s+are\s+colorless$/i
    );
    if (globalColorlessMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(globalColorlessMatch[1] || '').trim()),
        effectText: ['are colorless'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const globalChosenColorMatch = clause.match(
      /^(all\s+cards\s+that\s+aren(?:'|â€™)?t\s+on\s+the\s+battlefield,\s+spells,\s+and\s+permanents)\s+are\s+the\s+chosen\s+color\s+in\s+addition\s+to\s+their\s+other\s+colors$/i
    );
    if (globalChosenColorMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(globalChosenColorMatch[1] || '').trim()),
        effectText: ['are the chosen color in addition to their other colors'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const typeAdditionMatch = clause.match(
      /^(all\s+.+?)\s+are\s+(.+?)\s+in\s+addition\s+to\s+their\s+other\s+types$/i
    );
    if (typeAdditionMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(typeAdditionMatch[1] || '').trim()),
        effectText: [`are ${String(typeAdditionMatch[2] || '').trim()} in addition to their other types`],
        duration: 'static',
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

    const specificBasicLandType = clause.match(/^(.+?)\s+becomes\s+(?:an?\s+)?(plains|island|swamp|mountain|forest)(?:\s+(?:until\s+end\s+of\s+turn|for\s+as\s+long\s+as\s+.+|until\s+.+?\s+leaves\s+the\s+battlefield|in\s+addition\s+to\s+its\s+other\s+types))?$/i);
    if (specificBasicLandType) {
      const landType = String(specificBasicLandType[2] || '').trim().toLowerCase();
      const normalizedLandType = (landType.charAt(0).toUpperCase() + landType.slice(1)) as 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest';
      return withMeta({
        kind: 'set_basic_land_type',
        target: parseObjectSelector(String(specificBasicLandType[1] || '').trim()),
        landType: normalizedLandType,
        duration: /\buntil\s+end\s+of\s+turn\b/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
      });
    }

    const permanentCopy = clause.match(/^(.+?)\s+becomes\s+a\s+copy\s+of\s+(.+?)(?:\s+until\s+end\s+of\s+turn,\s+except\s+(.+)|,\s+except\s+(.+))?$/i);
    if (permanentCopy) {
      const targetText = String(permanentCopy[1] || '').trim();
      const sourceText = String(permanentCopy[2] || '').trim();
      const turnScopedExceptionText = String(permanentCopy[3] || '').trim();
      const staticExceptionText = String(permanentCopy[4] || '').trim();
      if (turnScopedExceptionText) {
        return withMeta({
          kind: 'grant_temporary_ability',
          target: parseObjectSelector(targetText),
          duration: 'end_of_turn',
          effectText: [`becomes a copy of ${sourceText}`, `except ${turnScopedExceptionText}`],
          raw: rawClause,
        });
      }
      return withMeta({
        kind: 'copy_permanent',
        target: parseObjectSelector(targetText),
        source: parseObjectSelector(sourceText),
        ...(staticExceptionText ? { retainAbilityText: staticExceptionText } : {}),
        raw: rawClause,
      });
    }

    const targetBecomesPtType = clause.match(/^(.+?)\s+becomes\s+(?:an?\s+)?(\d+)\s*\/\s*(\d+)\s+(.+?)(?:\s+for\s+as\s+long\s+as\s+.+)?$/i);
    if (targetBecomesPtType) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(targetBecomesPtType[1] || '').trim()),
        power: Number.parseInt(String(targetBecomesPtType[2] || '0'), 10),
        toughness: Number.parseInt(String(targetBecomesPtType[3] || '0'), 10),
        effectText: [`becomes ${String(targetBecomesPtType[4] || '').trim()}`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const artifactCreatureBecomes = clause.match(/^(.+?)\s+becomes\s+an\s+artifact\s+creature(?:\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\s*\/\s*(\d+))?(?:\s+for\s+as\s+long\s+as\s+.+)?$/i);
    if (artifactCreatureBecomes) {
      const power = artifactCreatureBecomes[2] ? Number.parseInt(String(artifactCreatureBecomes[2]), 10) : undefined;
      const toughness = artifactCreatureBecomes[3] ? Number.parseInt(String(artifactCreatureBecomes[3]), 10) : undefined;
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(artifactCreatureBecomes[1] || '').trim()),
        ...(power !== undefined ? { power } : {}),
        ...(toughness !== undefined ? { toughness } : {}),
        effectText: ['becomes an artifact creature', ...(power !== undefined && toughness !== undefined ? [`base power and toughness ${power}/${toughness}`] : [])],
        duration: 'static',
        raw: rawClause,
      });
    }

    const targetBecomesNamedState = clause.match(/^(.+?)\s+becomes\s+(prepared|unprepared|an?\s+enchantment(?:\s+and\s+loses\s+all\s+abilities\s+until\s+a\s+player\s+casts\s+a\s+creature\s+spell)?|an?\s+treasure\s+artifact\s+with\s+"[^"]+"\s+and\s+loses\s+all\s+other\s+card\s+types\s+and\s+abilities|an?\s+[a-z][a-z -]+)$/i);
    if (targetBecomesNamedState) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(targetBecomesNamedState[1] || '').trim()),
        effectText: [`becomes ${String(targetBecomesNamedState[2] || '').trim()}`],
        duration: 'static',
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
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardHand[1]),
        amount: { kind: 'number', value: 9999 },
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const discardAllInHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+all\\s+(?:the\\s+)?cards?\\s+in\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardAllInHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAllInHand[1]),
        amount: { kind: 'number', value: 9999 },
        optional: /\\bmay\\b/i.test(clause) || undefined,
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
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+(that\\s+card|those\\s+cards|it)\\b`, 'i')
    );
    if (discardTargeted) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardTargeted[1]),
        amount: { kind: 'number', value: 1 },
        target: parseObjectSelector(discardTargeted[2]),
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const discardHalf = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+half\\s+the\\s+cards\\s+in\\s+(?:their|your)\\s+hand,\\s+rounded\\s+(up|down)$`, 'i')
    );
    if (discardHalf) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardHalf[1]),
        amount: { kind: 'reference_amount', raw: `half_hand_rounded_${String(discardHalf[2] || '').trim().toLowerCase()}` },
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const subjectlessDiscardHalf = clause.match(/^(?:then\s+)?discards?\s+half\s+the\s+cards\s+in\s+(?:their|your)\s+hand(?:,\s+rounded\s+(up|down))?$/i);
    if (subjectlessDiscardHalf) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'each_player' },
        amount: { kind: 'reference_amount', raw: `half_hand_rounded_${String(subjectlessDiscardHalf[1] || 'up').trim().toLowerCase()}` },
        raw: rawClause,
      });
    }

    const discard = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:also\\s+)?(?:may\\s+)?discards?\\s+(that\\s+many|a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i')
    );
    if (discard) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discard[1]),
        amount: parseQuantity(discard[2]),
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const eachPlayerWhoCantDiscard = clause.match(/^each\s+player\s+who\s+can't\s+discards?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (eachPlayerWhoCantDiscard) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'each_player' },
        amount: parseQuantity(eachPlayerWhoCantDiscard[1]),
        raw: rawClause,
      });
    }

    const mayHaveDiscard = clause.match(/^(?:you\s+may\s+)?have\s+(target\s+opponent|target\s+player|that\s+opponent|that\s+player|an\s+opponent)\s+discard\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (mayHaveDiscard) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(mayHaveDiscard[1]),
        amount: parseQuantity(mayHaveDiscard[2]),
        optional: true,
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

    const revealRandomCard = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}reveals?\\s+a\\s+card\\s+at\\s+random\\s+from\\s+(?:your|their|his or her)\\s+hand$`, 'i'));
    if (revealRandomCard) {
      return withMeta({
        kind: 'reveal_hand',
        who: parsePlayerSelector(revealRandomCard[1]),
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

    const anyTargetsMill = clause.match(
      /^any\s+number\s+of\s+target\s+players\s+each\s+mills?\s+(that many|that much|a|an|\d+|x|[a-z]+)\s+cards?$/i
    );
    if (anyTargetsMill) {
      return withMeta({
        kind: 'mill',
        who: { kind: 'any_number_of_target_players' },
        amount: parseQuantity(anyTargetsMill[1]),
        raw: rawClause,
        });
    }

    const mill = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}mill(?:s)?\\s+(that many|that much|a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i'));
    if (mill) {
      return withMeta({
        kind: 'mill',
        who: parsePlayerSelector(mill[1]),
        amount: parseQuantity(mill[2]),
        raw: rawClause,
        });
    }

    const millDefault = clause.match(/^mill\s+(that many|that much|a|an|\d+|x|[a-z]+)\s+cards?\b/i);
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
    const goad = clause.match(/^(?:for\s+each\s+opponent,\s+)?goad\s+(.+)$/i);
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

  {
    const mustBeBlocked = clause.match(/^(.+?)\s+must\s+be\s+blocked\s+if\s+able$/i);
    if (mustBeBlocked) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(mustBeBlocked[1] || '').trim()),
        effectText: ['must be blocked if able'],
        duration: 'static',
        raw: rawClause,
        });
    }

    const attacksIfAble = clause.match(/^(.+?)\s+attacks(?:\s+(.+?))?\s+this\s+turn\s+if\s+able$/i);
    if (attacksIfAble) {
      const attackTarget = String(attacksIfAble[2] || '').trim();
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(attacksIfAble[1] || '').trim()),
        duration: 'this_turn',
        effectText: [attackTarget ? `attacks ${attackTarget} this turn if able` : 'attacks this turn if able'],
        raw: rawClause,
        });
    }

    const attacksNextCombat = clause.match(/^(.+?)\s+attacks\s+during\s+its\s+controller(?:'|â€™)?s\s+next\s+combat\s+phase\s+if\s+able$/i);
    if (attacksNextCombat) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(attacksNextCombat[1] || '').trim()),
        duration: 'until_next_turn',
        effectText: ["attacks during its controller's next combat phase if able"],
        raw: rawClause,
      });
    }

    const cantBlockThis = clause.match(/^(.+?)\s+can(?:not|'t)\s+block\s+(.+?)\s+this\s+turn$/i);
    if (cantBlockThis) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(cantBlockThis[1] || '').trim()),
        duration: 'this_turn',
        effectText: [`can't block ${String(cantBlockThis[2] || '').trim()}`],
        raw: rawClause,
        });
    }

    const assignsToughnessDamage = clause.match(/^each\s+creature\s+you\s+control\s+assigns\s+combat\s+damage\s+equal\s+to\s+its\s+toughness\s+rather\s+than\s+its\s+power$/i);
    if (assignsToughnessDamage) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('each creature you control'),
        effectText: ['assigns combat damage equal to its toughness rather than its power'],
        duration: 'static',
        raw: rawClause,
        });
    }

    const toughnessGreaterDamage = clause.match(/^each\s+creature\s+you\s+control\s+with\s+toughness\s+greater\s+than\s+its\s+power\s+assigns\s+combat\s+damage\s+equal\s+to\s+its\s+toughness\s+rather\s+than\s+its\s+power$/i);
    if (toughnessGreaterDamage) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('each creature you control with toughness greater than its power'),
        effectText: ['assigns combat damage equal to its toughness rather than its power'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const enchantedNoUntap = clause.match(/^(enchanted\s+(?:permanent|creature|artifact|land))\s+does(?:n't|\s+not)\s+untap\s+during\s+its\s+controller(?:'|â€™)?s\s+untap\s+step$/i);
    if (enchantedNoUntap) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(enchantedNoUntap[1] || '').trim()),
        effectText: ["doesn't untap during its controller's untap step"],
        duration: 'while_attached',
        raw: rawClause,
        });
    }

    const gainsSuspend = clause.match(/^if\s+it\s+does(?:n't|\s+not)\s+have\s+suspend,\s*it\s+gains\s+suspend$/i);
    if (gainsSuspend) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('it'),
        abilities: ['suspend'],
        effectText: ['if it does not have suspend, it gains suspend'],
        duration: 'static',
        raw: rawClause,
        });
    }

    const doubleDamage = clause.match(/^it\s+deals\s+double\s+that\s+damage$/i);
    if (doubleDamage) {
      return withMeta({
        kind: 'modify_damage',
        mode: 'add',
        amount: { kind: 'reference_amount', raw: 'that damage' },
        damageFilter: 'any',
        raw: rawClause,
        });
    }

    const doubleDamageToTarget = clause.match(/^it\s+deals\s+double\s+that\s+damage\s+to\s+(.+)$/i);
    if (doubleDamageToTarget) {
      return withMeta({
        kind: 'modify_damage',
        mode: 'add',
        amount: { kind: 'reference_amount', raw: 'that damage' },
        damageFilter: 'any',
        targetFilter: String(doubleDamageToTarget[1] || '').trim(),
        raw: rawClause,
      });
    }

    if (/^the\s+same\s+is\s+true\s+for\s+creature\s+spells\s+you\s+control\s+and\s+creature\s+cards\s+you\s+own\s+that\s+aren't\s+on\s+the\s+battlefield$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('creature spells you control and creature cards you own that are not on the battlefield'),
        effectText: ['the same is true'],
        duration: 'static',
        raw: rawClause,
        });
    }
  }

  {
    const activateLimit = clause.match(/^activate\s+no\s+more\s+than\s+(.+?)\s+each\s+turn$/i);
    if (activateLimit) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this ability'),
        effectText: [`activate no more than ${String(activateLimit[1] || '').trim()} each turn`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const activatedAbilitiesCantBeActivated = clause.match(/^activated\s+abilities\s+of\s+(.+?)\s+can(?:'|â€™)?t\s+be\s+activated\s+unless\s+they(?:'|â€™)?re\s+mana\s+abilities$/i);
    if (activatedAbilitiesCantBeActivated) {
      return withMeta({
        kind: 'cant_activate_abilities',
        target: parseObjectSelector(String(activatedAbilitiesCantBeActivated[1] || '').trim()),
        duration: 'static',
        raw: rawClause,
      });
    }

    const tokenReplacement = clause.match(/^twice\s+that\s+many\s+of\s+those\s+tokens\s+are\s+created$/i);
    if (tokenReplacement) {
      return withMeta({
        kind: 'modify_token_creation',
        who: { kind: 'you' },
        tokenTypes: ['token'],
        mode: 'add_additional_token',
        additionalAmount: { kind: 'reference_amount', raw: 'that many' },
        raw: rawClause,
      });
    }

    const createChosenNameCopy = clause.match(/^create\s+a\s+copy\s+of\s+the\s+card\s+with\s+the\s+chosen\s+name$/i);
    if (createChosenNameCopy) {
      return withMeta({
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: 'copy of the card with the chosen name',
        raw: rawClause,
      });
    }

    const spellCostChange = clause.match(/^(.+?\s+spells?\s+(?:you\s+cast|you\s+control)?)\s+cost\s+(\{[^}]+\})\s+(less|more)\s+to\s+cast$/i);
    if (spellCostChange) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellCostChange[1] || '').trim()),
        effectText: [`cost ${String(spellCostChange[2] || '').trim()} ${String(spellCostChange[3] || '').trim()} to cast`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const domainCostReduction = clause.match(/^(?:domain\s+-\s+)?this\s+spell\s+costs?\s+(\{[^}]+\})\s+less\s+to\s+cast\s+for\s+each\s+basic\s+land\s+type\s+among\s+lands\s+you\s+control$/i);
    if (domainCostReduction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this spell'),
        effectText: [`costs ${String(domainCostReduction[1] || '').trim()} less to cast for each basic land type among lands you control`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const spellsCantBeCountered = clause.match(/^(.+?\s+spells?\s+you\s+control)\s+can(?:'|â€™)?t\s+be\s+countered$/i);
    if (spellsCantBeCountered) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellsCantBeCountered[1] || '').trim()),
        effectText: ["can't be countered"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const spellCantBeCopied = clause.match(/^(.+?)\s+can(?:not|(?:'|â€™)t)\s+be\s+copied$/i);
    if (spellCantBeCopied) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellCantBeCopied[1] || '').trim()),
        effectText: ["can't be copied"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const chosenTypeCostLess = clause.match(/^spells\s+you\s+cast\s+of\s+the\s+chosen\s+type\s+cost\s+(\{[^}]+\})\s+less\s+to\s+cast$/i);
    if (chosenTypeCostLess) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('spells you cast of the chosen type'),
        effectText: [`cost ${String(chosenTypeCostLess[1] || '').trim()} less to cast`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const genericSpellCostReduction = clause.match(/^(.+?)\s+costs?\s+(\{[^}]+\})\s+less\s+to\s+cast$/i);
    if (genericSpellCostReduction) {
      const targetText = String(genericSpellCostReduction[1] || '').trim();
      const effectText = [`costs ${String(genericSpellCostReduction[2] || '').trim()} less to cast`];
      if (/\bthis turn\b/i.test(targetText)) {
        return withMeta({
          kind: 'grant_temporary_ability',
          target: parseObjectSelector(targetText),
          duration: 'this_turn',
          effectText,
          raw: rawClause,
        });
      }

      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(targetText),
        effectText,
        duration: 'static',
        raw: rawClause,
      });
    }

    const permanentsEnterTapped = clause.match(/^(.+?)\s+enter\s+tapped$/i);
    if (permanentsEnterTapped && /\b(?:creatures?|artifacts?|lands?|permanents?)\b/i.test(String(permanentsEnterTapped[1] || ''))) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(permanentsEnterTapped[1] || '').trim()),
        effectText: ['enter tapped'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const allAbleBlockTarget = clause.match(
      /^all\s+creatures(?:\s+(your\s+opponents\s+control))?(?:\s+with\s+(.+?))?\s+able\s+to\s+block\s+(.+?)\s+this\s+turn\s+do\s+so$/i
    );
    if (allAbleBlockTarget) {
      const blockerText = [
        'all creatures',
        String(allAbleBlockTarget[1] || '').trim(),
        allAbleBlockTarget[2] ? `with ${String(allAbleBlockTarget[2] || '').trim()}` : '',
        'able to block',
      ]
        .filter(Boolean)
        .join(' ');
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector(blockerText),
        attacker: parseObjectSelector(String(allAbleBlockTarget[3] || '').trim()),
        duration: 'end_of_turn',
        raw: rawClause,
      });
    }

    const doublePowerUntilEot = clause.match(/^double\s+(.+?)(?:'|â€™)?s\s+power\s+until\s+end\s+of\s+turn$/i);
    if (doublePowerUntilEot) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(doublePowerUntilEot[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['double power'],
        raw: rawClause,
      });
    }

    const excessDamageToController = clause.match(/^excess\s+damage\s+is\s+dealt\s+to\s+(.+?)(?:'|â€™)?s\s+controller\s+instead$/i);
    if (excessDamageToController) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(excessDamageToController[1] || '').trim()),
        effectText: ['excess damage is dealt to its controller instead'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const ifPlayerDoesCounter = clause.match(/^if\s+a\s+player\s+does,\s*counter\s+this\s+permanent$/i);
    if (ifPlayerDoesCounter) {
      return withMeta({
        kind: 'counter_spell',
        target: parseObjectSelector('this permanent'),
        raw: rawClause,
      });
    }

    const becomesArtifactCreatureEot = clause.match(/^(it|this\s+permanent)\s+becomes\s+an\s+artifact\s+creature\s+until\s+end\s+of\s+turn$/i);
    if (becomesArtifactCreatureEot) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(becomesArtifactCreatureEot[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['becomes an artifact creature'],
        raw: rawClause,
      });
    }

    const remainsTappedUntapRestriction = clause.match(/^(.+?)\s+do(?:es)?(?:n't|\s+not)\s+untap\s+during\s+its\s+controller(?:'|â€™)?s\s+untap\s+step\s+for\s+as\s+long\s+as\s+(.+?)\s+remains\s+tapped$/i);
    if (remainsTappedUntapRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(remainsTappedUntapRestriction[1] || '').trim()),
        effectText: [`doesn't untap while ${String(remainsTappedUntapRestriction[2] || '').trim()} remains tapped`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const staticUntapLock = clause.match(/^(.+?)\s+do(?:es)?(?:n't|\s+not)\s+untap\s+during\s+their\s+controllers?(?:'|â€™)?\s+untap\s+steps$/i);
    if (staticUntapLock) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticUntapLock[1] || '').trim()),
        effectText: ["don't untap during their controllers' untap steps"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const handsRevealed = clause.match(/^(.+?)\s+play\s+with\s+their\s+hands\s+revealed$/i);
    if (handsRevealed) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(handsRevealed[1] || '').trim()),
        effectText: ['play with their hands revealed'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const areTokens = clause.match(/^(.+?)\s+are\s+tokens$/i);
    if (areTokens) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(areTokens[1] || '').trim()),
        effectText: ['are tokens'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const cantPlayLandsThisTurn = clause.match(/^(.+?)\s+can(?:not|(?:'|â€™)t)\s+play\s+lands\s+this\s+turn$/i);
    if (cantPlayLandsThisTurn) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(cantPlayLandsThisTurn[1] || '').trim()),
        duration: 'this_turn',
        effectText: ["can't play lands this turn"],
        raw: rawClause,
      });
    }

    const nextTurnInstantSorceryLock = clause.match(
      /^(.+?)\s+can(?:not|(?:'|â€™)t)\s+cast\s+instant\s+or\s+sorcery\s+spells\s+during\s+that\s+player(?:'|â€™)?s\s+next\s+turn$/i
    );
    if (nextTurnInstantSorceryLock) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(nextTurnInstantSorceryLock[1] || '').trim()),
        duration: 'until_next_turn',
        effectText: ["can't cast instant or sorcery spells during that player's next turn"],
        raw: rawClause,
      });
    }

    const noMaxHandSize = clause.match(/^(.+?)\s+ha(?:ve|s)\s+no\s+maximum\s+hand\s+size(?:\s+for\s+the\s+rest\s+of\s+the\s+game)?$/i);
    if (noMaxHandSize) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(noMaxHandSize[1] || '').trim()),
        effectText: ['have no maximum hand size'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const doublePowerToughness = clause.match(/^double\s+(.+?)(?:'|â€™)?s\s+power\s+and\s+toughness\s+until\s+end\s+of\s+turn$/i);
    if (doublePowerToughness) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(doublePowerToughness[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['double power and toughness'],
        raw: rawClause,
      });
    }

    if (/^you\s+do(?:n't|\s+not)\s+lose\s+the\s+game\s+for\s+having\s+0\s+or\s+less\s+life$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: ["don't lose the game for having 0 or less life"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const castAsThoughFlash = clause.match(/^(?:you\s+may\s+)?cast\s+(.+?)\s+spells\s+as\s+though\s+they\s+had\s+flash$/i);
    if (castAsThoughFlash) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(`you casting ${String(castAsThoughFlash[1] || '').trim()} spells`),
        effectText: ['may cast as though they had flash'],
        duration: 'static',
        raw: rawClause,
      });
    }

    if (/^(?:your\s+opponents|each\s+opponent)\s+can't\s+cast\s+spells\s+during\s+your\s+turn$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('your opponents'),
        effectText: ["can't cast spells during your turn"],
        duration: 'static',
        raw: rawClause,
      });
    }

    if (/^each\s+opponent\s+can\s+cast\s+spells\s+only\s+any\s+time\s+they\s+could\s+cast\s+a\s+sorcery$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('each opponent'),
        effectText: ['can cast spells only any time they could cast a sorcery'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const chooseCreatureTypeOtherThan = clause.match(/^choose\s+a\s+creature\s+type\s+other\s+than\s+.+$/i);
    if (chooseCreatureTypeOtherThan) {
      return withMeta({ kind: 'choose_creature_type', raw: rawClause });
    }

    const chooseAnyNumberTargetCreatures = clause.match(/^choose\s+any\s+number\s+of\s+target\s+creatures$/i);
    if (chooseAnyNumberTargetCreatures) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector('any number of target creatures'),
        optional: true,
        raw: rawClause,
      });
    }

    const noncreatureCostIncrease = clause.match(/^(.+?)\s+costs?\s+(\{[^}]+\})\s+more\s+to\s+cast$/i);
    if (noncreatureCostIncrease) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(noncreatureCostIncrease[1] || '').trim()),
        effectText: [`costs ${String(noncreatureCostIncrease[2] || '').trim()} more to cast`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const losesDefender = clause.match(/^(this\s+creature|it|target\s+creature)\s+loses\s+defender\s+until\s+end\s+of\s+turn$/i);
    if (losesDefender) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(losesDefender[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['loses defender'],
        raw: rawClause,
      });
    }

    const temporaryLoseKeywords = clause.match(/^(.+?)\s+loses?\s+([a-z, ]+)\s+until\s+end\s+of\s+turn$/i);
    if (temporaryLoseKeywords) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(temporaryLoseKeywords[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: [`lose ${String(temporaryLoseKeywords[2] || '').trim()}`],
        raw: rawClause,
      });
    }

    if (/^if\s+you\s+cast\s+a\s+spell\s+this\s+way,\s+pay\s+life\s+equal\s+to\s+its\s+mana\s+value\s+rather\s+than\s+pay\s+its\s+mana\s+cost$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('spell cast this way'),
        effectText: ['pay life equal to its mana value rather than pay its mana cost'],
        duration: 'static',
        raw: rawClause,
      });
    }

    if (/^it\s+creates\s+twice\s+that\s+many\s+of\s+those\s+tokens$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('it'),
        effectText: ['doubles token creation'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const additionalMana = clause.match(/^its\s+controller\s+adds\s+an\s+additional\s+((?:\{[^}]+\})+)$/i);
    if (additionalMana) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'target_player' },
        mana: String(additionalMana[1] || '').trim(),
        raw: rawClause,
      });
    }

    if (/^only\s+your\s+opponents\s+may\s+activate\s+this\s+ability$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this ability'),
        effectText: ['only your opponents may activate this ability'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const gainTwiceThatMuchLife = clause.match(/^(.+?)\s+gain(?:s)?\s+twice\s+that\s+much\s+life$/i);
    if (gainTwiceThatMuchLife) {
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(String(gainTwiceThatMuchLife[1] || '').trim()),
        amount: { kind: 'reference_amount', raw: 'twice that much' },
        raw: rawClause,
      });
    }

    const alternateLandReturnCost = clause.match(/^you\s+may\s+pay\s+(\{[^}]+\})\s+and\s+return\s+(.+?)\s+to\s+its\s+owner(?:'|â€™)?s\s+hand\s+rather\s+than\s+pay\s+this\s+spell(?:'|â€™)?s\s+mana\s+cost$/i);
    if (alternateLandReturnCost) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may pay ${String(alternateLandReturnCost[1] || '').trim()} and return ${String(alternateLandReturnCost[2] || '').trim()} to its owner's hand rather than pay this spell's mana cost`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const alternateTapCost = clause.match(/^if\s+you\s+control\s+a\s+(plains|island|swamp|mountain|forest),\s+you\s+may\s+tap\s+an\s+untapped\s+creature\s+you\s+control\s+rather\s+than\s+pay\s+this\s+spell(?:'|â€™)?s\s+mana\s+cost$/i);
    if (alternateTapCost) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may tap an untapped creature you control rather than pay this spell's mana cost if you control a ${String(alternateTapCost[1] || '').trim().toLowerCase()}`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const flashSurcharge = clause.match(/^(?:you\s+may\s+)?cast\s+this\s+spell\s+as\s+though\s+it\s+had\s+flash\s+if\s+you\s+pay\s+(.+?)\s+more\s+to\s+cast\s+it$/i);
    if (flashSurcharge) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may cast this spell as though it had flash if you pay ${String(flashSurcharge[1] || '').trim()} more to cast it`],
        duration: 'static',
        raw: rawClause,
        });
    }

    if (/^(?:you\s+may\s+)?have\s+this\s+creature\s+assign\s+its\s+combat\s+damage\s+as\s+though\s+it\s+weren(?:'|â€™)?t\s+blocked$/i.test(clause)) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('this creature'),
        duration: 'this_turn',
        effectText: ['assign combat damage as though it were not blocked'],
        raw: rawClause,
        });
    }

    const attachToTarget = clause.match(/^attach\s+to\s+(.+)$/i);
    if (attachToTarget) {
      return withMeta({
        kind: 'attach',
        attachment: parseObjectSelector('this permanent'),
        to: parseObjectSelector(String(attachToTarget[1] || '').trim()),
        raw: rawClause,
        });
    }

    const chooseTwoCreatures = clause.match(/^choose\s+(target\s+creature\s+you\s+control\s+and\s+target\s+creature\s+you\s+don(?:'|â€™)?t\s+control)$/i);
    if (chooseTwoCreatures) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseTwoCreatures[1] || '').trim()),
        raw: rawClause,
        });
    }

    const sourceDamageCantBePrevented = clause.match(/^damage\s+that\s+would\s+be\s+dealt\s+by\s+(.+?)\s+can(?:not|(?:'|â€™)t)\s+be\s+prevented$/i);
    if (sourceDamageCantBePrevented) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(sourceDamageCantBePrevented[1] || '').trim()),
        effectText: ["damage it deals can't be prevented"],
        duration: 'static',
        raw: rawClause,
        });
    }

    if (/^damage\s+can(?:not|'t)\s+be\s+prevented$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('damage'),
        effectText: ["can't be prevented"],
        duration: 'static',
        raw: rawClause,
        });
    }

    const castOnlyRestriction = clause.match(/^cast\s+this\s+spell\s+only\s+during\s+(.+)$/i);
    if (castOnlyRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this spell'),
        effectText: [`cast only during ${String(castOnlyRestriction[1] || '').trim()}`],
        duration: 'static',
        raw: rawClause,
        });
    }

    const spellPerTurnRestriction = clause.match(/^(.+?)\s+can(?:not|(?:'|â€™)t)\s+cast\s+more\s+than\s+one\s+spell\s+each\s+turn$/i);
    if (spellPerTurnRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellPerTurnRestriction[1] || '').trim()),
        effectText: ["can't cast more than one spell each turn"],
        duration: 'static',
        raw: rawClause,
        });
    }

    const alternateCost = clause.match(/^(?:you\s+may\s+)?pay\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)\s+rather\s+than\s+pay\s+this\s+spell(?:'|â€™)?s\s+mana\s+cost$/i);
    if (alternateCost) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may pay ${String(alternateCost[1] || '').replace(/\s+/g, '')} rather than pay this spell's mana cost`],
        duration: 'static',
        raw: rawClause,
        });
    }

    const eachPlayerChooseLands = clause.match(/^each\s+player\s+chooses\s+a\s+number\s+of\s+lands\s+they\s+control\s+equal\s+to\s+the\s+number\s+of\s+lands\s+controlled\s+by\s+the\s+player\s+who\s+controls\s+the\s+fewest$/i);
    if (eachPlayerChooseLands) {
      return withMeta({
        kind: 'player_choice',
        choice: 'number_of_lands',
        raw: rawClause,
      });
    }

    const enchantedLandType = clause.match(/^(enchanted\s+land)\s+is\s+an?\s+(plains|island|swamp|mountain|forest)$/i);
    if (enchantedLandType) {
      const landType = String(enchantedLandType[2] || '').trim().toLowerCase();
      const normalizedLandType = (landType.charAt(0).toUpperCase() + landType.slice(1)) as 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest';
      return withMeta({
        kind: 'set_basic_land_type',
        target: parseObjectSelector(String(enchantedLandType[1] || '').trim()),
        landType: normalizedLandType,
        duration: 'static',
        raw: rawClause,
      });
    }

    const payLife = clause.match(/^(?:you\s+may\s+)?pay\s+(\d+)\s+life$/i);
    if (payLife) {
      return withMeta({
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: { kind: 'number', value: Number.parseInt(String(payLife[1] || '0'), 10) || 0 },
        optional: true,
        raw: rawClause,
        });
    }

    const discardUpTo = clause.match(/^discard\s+up\s+to\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?$/i);
    if (discardUpTo) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: parseQuantity(String(discardUpTo[1] || '').trim()),
        optional: true,
        raw: rawClause,
        });
    }

    if (/^(?:your\s+opponents|each\s+opponent)\s+can(?:not|'t)\s+gain\s+life$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('your opponents'),
        effectText: ["can't gain life"],
        duration: 'static',
        raw: rawClause,
        });
    }

    const chosenColorProtection = clause.match(/^(enchanted\s+creature)\s+has\s+protection\s+from\s+the\s+chosen\s+color$/i);
    if (chosenColorProtection) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(chosenColorProtection[1] || '').trim()),
        effectText: ['protection from the chosen color'],
        duration: 'while_attached',
        raw: rawClause,
        });
    }

    if (/^if\s+you\s+(?:don(?:'|â€™)?t|can(?:'|â€™)?t),\s*you\s+lose\s+the\s+game$/i.test(clause)) {
      return withMeta({
        kind: 'lose_game',
        raw: rawClause,
        });
    }
  }

  return null;
}


