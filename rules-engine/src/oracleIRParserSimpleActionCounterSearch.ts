/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause add-counter / remove-counter / search-library clauses
 * Public: tryParseSimpleActionCounterSearchClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import {
  tryParseRemoveAllCountersFromTargetClause,
  tryParseNextSpellCostReduceForCountersRemovedClause,
} from './oracleIRRemoveCountersCostReduce';
import {
  PLAYER_SUBJECT_PREFIX,
  REFERENCEABLE_COUNTER_AMOUNT_PATTERN,
  parseCounterQuantity,
  parseScaledCounterQuantity,
  parseSmallNumber,
  countEnergySymbols,
} from './oracleIRParserSimpleActionHelpers';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionCounterSearchClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const tryParseSimpleActionClause = args.parseRest;

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
    const armyCounterClause = normalizeOracleText(clause).replace(/^[(\s]+/, '').replace(/[.)\s]+$/g, '').trim();
    const armyCounter = armyCounterClause.match(
      /^put (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) \+1\/\+1 counters? on an army you control$/i,
    );
    if (armyCounter) {
      const amountToken = armyCounterClause.match(
        /^put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) \+1\/\+1 counters? on an army you control$/i,
      );
      return withMeta({
        kind: 'add_counter',
        amount: parseCounterQuantity(String(amountToken?.[1] || 'a')),
        counter: '+1/+1',
        target: parseObjectSelector('an army you control'),
        raw: rawClause,
      });
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
        amount: parseCounterQuantity('the same number'),
        counter: 'each kind',
        target: parseObjectSelector(sameKindCounters[1]),
        raw: rawClause,
        });
    }
  }

  {
    const scaledEachCreatureCounters = clause.match(
      /^put\s+(x)\s+(.+?)\s+counters?\s+on\s+(each\s+creature\s+you\s+control)\s*,\s*where\s+x\s+is\s+(.+)$/i,
    );
    if (scaledEachCreatureCounters) {
      return withMeta({
        kind: 'add_counter',
        amount: parseCounterQuantity(String(scaledEachCreatureCounters[1] || 'x')),
        counter: normalizeCounterName(String(scaledEachCreatureCounters[2] || '')),
        target: parseObjectSelector(String(scaledEachCreatureCounters[3] || 'each creature you control')),
        whereX: { kind: 'where', raw: String(scaledEachCreatureCounters[4] || '').trim() },
        raw: rawClause,
      });
    }
  }

  {
    const addCounters = clause.match(new RegExp(`^(?:otherwise,?\\s*)?${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?put\\s+(${REFERENCEABLE_COUNTER_AMOUNT_PATTERN})\\s+(.+?)\\s+counters?\\s+on\\s+(.+?)(?:,\\s*where\\s+x\\s+is\\s+(.+))?\\s*$`, 'i'));
    if (addCounters && !/\bonto\s+the\s+battlefield\b/i.test(clause)) {
      const whereRaw = String(addCounters[5] || '').trim();
      return withMeta({
        kind: 'add_counter',
        amount: parseCounterQuantity(addCounters[2]),
        counter: normalizeCounterName(String(addCounters[3] || '')),
        target: parseObjectSelector(addCounters[4]),
        ...(whereRaw ? { whereX: { kind: 'where', raw: whereRaw } } : {}),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const distributeVariableCounters = clause.match(
      /^(?:you\s+)?(?:may\s+)?distribute\s+(?:up to\s+)?a number of\s+(.+?)\s+counters?\s+(?:equal to\s+(.+?)\s+)?among\s+(.+)$/i
    );
    if (distributeVariableCounters) {
      const equalText = String(distributeVariableCounters[2] || '').trim();
      const amount = equalText
        ? parseQuantity(equalText)
        : { kind: 'reference_amount' as const, raw: 'a number' };
      return withMeta({
        kind: 'add_counter',
        amount: amount.kind === 'unknown' && equalText ? { kind: 'unknown', raw: `equal to ${equalText}` } : amount,
        counter: normalizeCounterName(String(distributeVariableCounters[1] || '')),
        target: parseObjectSelector(distributeVariableCounters[3]),
        distribution: 'among',
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
        distribution: 'among',
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
      const thisSourceStatAmount = equalText.match(
        /^this\s+(permanent|creature)(?:'|’)?s\s+(power|toughness)$/i,
      );
      const amount = cardStatAmount
        ? { kind: 'object_stat' as const, subject: 'that_card' as const, stat: String(cardStatAmount[1] || '').toLowerCase() as 'power' | 'toughness' }
        : thisSourceStatAmount
          ? {
              kind: 'object_stat' as const,
              subject: String(thisSourceStatAmount[1] || '').toLowerCase() === 'creature' ? 'this_creature' as const : 'this_permanent' as const,
              stat: String(thisSourceStatAmount[2] || '').toLowerCase() as 'power' | 'toughness',
            }
        : creatureStatAmount
          ? { kind: 'reference_amount' as const, raw: `equal to ${equalText}` }
          : equalText ? parseQuantity(equalText) : { kind: 'unknown' as const, raw: 'a number' };
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
    const addThatManyEnergy = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}get(?:s)?\\s+that\\s+many\\s+\\{e\\}(?:\\s*\\(?energy counters?\\)?)?\\s*$`, 'i'),
    );
    if (addThatManyEnergy) {
      return withMeta({
        kind: 'add_player_counter',
        who: parsePlayerSelector(addThatManyEnergy[1]),
        amount: { kind: 'reference_amount', raw: 'that many' },
        counter: 'energy',
        raw: rawClause,
      });
    }

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
    const removeAnyNumberCounters = clause.match(/^remove\s+any\s+number\s+of\s+(.+?)\s+counters?\s+from\s+(.+)$/i);
    if (removeAnyNumberCounters) {
      return withMeta({
        kind: 'remove_counter',
        amount: { kind: 'any_number' },
        counter: normalizeCounterName(String(removeAnyNumberCounters[1] || '')),
        target: parseObjectSelector(removeAnyNumberCounters[2]),
        optional: true,
        raw: rawClause,
        });
    }

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

    const removeAnyAmongBattlefield = clause.match(
      /^remove\s+any\s+number\s+of\s+counters\s+from\s+among\s+permanents\s+on\s+the\s+battlefield$/i
    );
    if (removeAnyAmongBattlefield) {
      return withMeta({
        kind: 'remove_counter',
        amount: { kind: 'any_number' },
        counter: 'any',
        target: parseObjectSelector('among permanents on the battlefield'),
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

    const removeAllCountersTarget = tryParseRemoveAllCountersFromTargetClause(clause);
    if (removeAllCountersTarget) {
      return withMeta(removeAllCountersTarget as any);
    }

    const nextSpellCostReduceCounters = tryParseNextSpellCostReduceForCountersRemovedClause(clause);
    if (nextSpellCostReduceCounters) {
      return withMeta(nextSpellCostReduceCounters as any);
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

    const referencedPossessiveZoneExile = clause.match(
      /^search\s+its\s+(controller|owner)(?:'|’)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+(all\s+|any\s+number\s+of\s+)?cards?\s+with\s+the\s+same\s+name\s+as\s+(that\s+spell|that\s+card)\s+and\s+exile\s+them$/i
    );
    if (referencedPossessiveZoneExile) {
      const role = String(referencedPossessiveZoneExile[1] || '').trim().toLowerCase();
      const limitText = String(referencedPossessiveZoneExile[2] || '').trim();
      return withMeta({
        kind: 'exile_named_cards_from_zones',
        who:
          role === 'owner'
            ? { kind: 'owner_of_referenced_object' }
            : { kind: 'controller_of_referenced_object' },
        zones: ['graveyard', 'hand', 'library'],
        nameSource: /that\s+spell/i.test(String(referencedPossessiveZoneExile[3] || ''))
          ? 'target_spell_name'
          : 'referenced_card_name',
        maxResults: /^(?:all|any\s+number\s+of)\s*$/i.test(limitText) ? 'any_number' : undefined,
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

    if (/^choose\s+an\s+opponent(?:\s+at\s+random|\s+who\s+.+)?$/i.test(clause)) {
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

    const leadingTemporaryAnimation = clause.match(/^until\s+end\s+of\s+turn,\s+(.+?)\s+becomes?\s+a\s+(\d+)\/(\d+)(?:\s+(.+?))?\s+creature(?:\s+in\s+addition\s+to\s+its\s+other\s+types)?$/i);
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

    const leadingUntilNextTurnAnimation = clause.match(/^until\s+your\s+next\s+turn,\s+(.+?)\s+becomes?\s+a\s+(\d+)\/(\d+)(?:\s+(.+?))?\s+creature(?:\s+in\s+addition\s+to\s+its\s+other\s+types)?$/i);
    if (leadingUntilNextTurnAnimation) {
      const typeText = String(leadingUntilNextTurnAnimation[4] || '').trim();
      return withMeta({
        kind: 'animate_permanent',
        target: parseObjectSelector(String(leadingUntilNextTurnAnimation[1] || '').trim()),
        power: Number.parseInt(String(leadingUntilNextTurnAnimation[2] || '0'), 10),
        toughness: Number.parseInt(String(leadingUntilNextTurnAnimation[3] || '0'), 10),
        addTypes: typeText ? [...typeText.split(/\s+/).filter(Boolean), 'creature'] : ['creature'],
        duration: 'until_next_turn',
        raw: rawClause,
      });
    }

    const suffixUntilNextTurnAnimation = clause.match(/^(.+?)\s+becomes?\s+a\s+(\d+)\/(\d+)(?:\s+(.+?))?\s+creature(?:\s+in\s+addition\s+to\s+its\s+other\s+types)?\s+until\s+your\s+next\s+turn$/i);
    if (suffixUntilNextTurnAnimation) {
      const typeText = String(suffixUntilNextTurnAnimation[4] || '').trim();
      return withMeta({
        kind: 'animate_permanent',
        target: parseObjectSelector(String(suffixUntilNextTurnAnimation[1] || '').trim()),
        power: Number.parseInt(String(suffixUntilNextTurnAnimation[2] || '0'), 10),
        toughness: Number.parseInt(String(suffixUntilNextTurnAnimation[3] || '0'), 10),
        addTypes: typeText ? [...typeText.split(/\s+/).filter(Boolean), 'creature'] : ['creature'],
        duration: 'until_next_turn',
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
  return null;
}
