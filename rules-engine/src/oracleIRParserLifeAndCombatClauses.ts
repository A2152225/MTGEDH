import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

function parseDamageAmount(raw: string | undefined): Extract<OracleEffectStep, { kind: 'deal_damage' }>['amount'] {
  const normalized = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();

  if (normalized === 'that much' || normalized === 'that many') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'its power') {
    return { kind: 'object_stat', subject: 'it', stat: 'power' };
  }
  if (normalized === 'its toughness') {
    return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  }
  if (normalized === 'its mana value') {
    return { kind: 'object_stat', subject: 'it', stat: 'mana_value' };
  }
  if (normalized === "that card's power") {
    return { kind: 'object_stat', subject: 'that_card', stat: 'power' };
  }
  if (normalized === "that card's toughness") {
    return { kind: 'object_stat', subject: 'that_card', stat: 'toughness' };
  }
  if (normalized === "that card's mana value") {
    return { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' };
  }
  if (normalized === "that creature's power") {
    return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  }
  if (normalized === "that creature's toughness") {
    return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  }
  if (normalized === "the sacrificed creature's power") {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'power' };
  }
  if (normalized === "the sacrificed creature's toughness") {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'toughness' };
  }
  if (normalized === "the sacrificed creature's mana value") {
    return { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'mana_value' };
  }

  return { kind: 'unknown', raw: String(raw || '').trim() };
}

function parseLifeChangeAmount(
  raw: string | undefined
): Extract<OracleEffectStep, { kind: 'gain_life' | 'lose_life' }>['amount'] {
  const parsedQuantity = parseQuantity(raw);
  if (parsedQuantity.kind !== 'unknown') return parsedQuantity;

  const normalized = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();

  if (normalized === 'its power') {
    return { kind: 'object_stat', subject: 'it', stat: 'power' };
  }
  if (normalized === 'its toughness') {
    return { kind: 'object_stat', subject: 'it', stat: 'toughness' };
  }
  if (normalized === 'its mana value') {
    return { kind: 'object_stat', subject: 'it', stat: 'mana_value' };
  }
  if (normalized === "that card's power") {
    return { kind: 'object_stat', subject: 'that_card', stat: 'power' };
  }
  if (normalized === "that card's toughness") {
    return { kind: 'object_stat', subject: 'that_card', stat: 'toughness' };
  }
  if (normalized === "that card's mana value") {
    return { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' };
  }
  if (normalized === "that creature's power") {
    return { kind: 'object_stat', subject: 'that_creature', stat: 'power' };
  }
  if (normalized === "that creature's toughness") {
    return { kind: 'object_stat', subject: 'that_creature', stat: 'toughness' };
  }
  if (normalized === 'the life lost this way') {
    return { kind: 'reference_amount', raw: normalized };
  }

  return parsedQuantity;
}

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'â€™-]*?(?:'s|â€™s)? (?:controller|owner)|[a-z0-9][a-z0-9 ,.'â€™-]*?(?:'s|â€™s) (?:controller|owner))\\s+)?";

const SELF_DAMAGE_SOURCE_SUBJECT_PATTERN =
  "(?:it|this (?:permanent|spell|creature|artifact|enchantment|planeswalker|battle|land|card|emblem|token)|that [a-z0-9][a-z0-9 ,.'â€™-]*|target [a-z0-9][a-z0-9 ,.'â€™-]*|another target [a-z0-9][a-z0-9 ,.'â€™-]*)";

const NAMED_DAMAGE_SOURCE_PATTERN =
  "[A-Z0-9][A-Za-z0-9'â€™/-]*(?: [A-Z0-9][A-Za-z0-9'â€™/-]*)*(?:, [A-Z0-9][A-Za-z0-9'â€™/-]*(?: [A-Z0-9][A-Za-z0-9'â€™/-]*)*)?";

export function tryParseLifeAndCombatClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalizedRawClause = normalizeOracleText(rawClause);

  {
    const gain = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}gains?\\s+(that much|that many|\\d+|x|[a-z]+)\\s+life\\b`, 'i'));
    if (gain) {
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(gain[1]),
        amount: parseQuantity(gain[2]),
        raw: rawClause,
      });
    }

    const gainDefault = clause.match(/^gain\s+(that much|that many|\d+|x|[a-z]+)\s+life\b/i);
    if (gainDefault) {
      return withMeta({
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: parseQuantity(gainDefault[1]),
        raw: rawClause,
      });
    }

    const gainEqual = clause.match(/^(.*?)(?:gains?\s+life\s+equal\s+to)\s+(.+)$/i);
    if (gainEqual) {
      const whoRaw = String(gainEqual[1] || '').trim().replace(/\s+$/, '');
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(whoRaw || 'you'),
        amount: parseLifeChangeAmount(gainEqual[2]),
        raw: rawClause,
      });
    }

    const gainEqualDefault = clause.match(/^gain\s+life\s+equal\s+to\s+(.+)$/i);
    if (gainEqualDefault) {
      return withMeta({
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: parseLifeChangeAmount(gainEqualDefault[1]),
        raw: rawClause,
      });
    }

    const lose = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}loses?\\s+(that much|that many|\\d+|x|[a-z]+)\\s+life\\b`, 'i'));
    if (lose) {
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(lose[1]),
        amount: parseQuantity(lose[2]),
        raw: rawClause,
      });
    }

    const loseDefault = clause.match(/^lose\s+(that much|that many|\d+|x|[a-z]+)\s+life\b/i);
    if (loseDefault) {
      return withMeta({
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: parseQuantity(loseDefault[1]),
        raw: rawClause,
      });
    }

    const loseEqual = clause.match(/^(.*?)(?:loses?\s+life\s+equal\s+to)\s+(.+)$/i);
    if (loseEqual) {
      const whoRaw = String(loseEqual[1] || '').trim().replace(/\s+$/, '');
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(whoRaw || 'you'),
        amount: parseLifeChangeAmount(loseEqual[2]),
        raw: rawClause,
      });
    }

    const loseEqualDefault = clause.match(/^lose\s+life\s+equal\s+to\s+(.+)$/i);
    if (loseEqualDefault) {
      return withMeta({
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: parseLifeChangeAmount(loseEqualDefault[1]),
        raw: rawClause,
      });
    }
  }

  {
    const dealDamageEqual = clause.match(/^deal\s+damage\s+equal\s+to\s+(.+?)\s+to\s+(.+)$/i);
    if (dealDamageEqual) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(dealDamageEqual[1]),
        target: parseObjectSelector(dealDamageEqual[2]),
        raw: rawClause,
      });
    }

    const sourceDealsDamageEqual = clause.match(
      new RegExp(`^(${SELF_DAMAGE_SOURCE_SUBJECT_PATTERN})\\s+deals?\\s+damage\\s+equal\\s+to\\s+(.+?)\\s+to\\s+(.+)$`, 'i')
    );
    if (sourceDealsDamageEqual) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(sourceDealsDamageEqual[2]),
        source: parseObjectSelector(sourceDealsDamageEqual[1]),
        target: parseObjectSelector(sourceDealsDamageEqual[3]),
        raw: rawClause,
      });
    }

    const namedSourceDealsDamageEqual = normalizedRawClause.match(
      new RegExp(`^(${NAMED_DAMAGE_SOURCE_PATTERN})\\s+deals?\\s+damage\\s+equal\\s+to\\s+(.+?)\\s+to\\s+(.+)$`)
    );
    if (namedSourceDealsDamageEqual) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(namedSourceDealsDamageEqual[2]),
        source: parseObjectSelector(namedSourceDealsDamageEqual[1]),
        target: parseObjectSelector(namedSourceDealsDamageEqual[3]),
        raw: rawClause,
      });
    }

    const dealDamage = clause.match(/^deal\s+(that much|\d+|x|[a-z]+)\s+damage\s+to\s+(.+)$/i);
    if (dealDamage) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(dealDamage[1]),
        target: parseObjectSelector(dealDamage[2]),
        raw: rawClause,
      });
    }

    const sourceDealsDamage = clause.match(
      new RegExp(`^(${SELF_DAMAGE_SOURCE_SUBJECT_PATTERN})\\s+deals?\\s+(that much|\\d+|x|[a-z]+)\\s+damage\\s+to\\s+(.+)$`, 'i')
    );
    if (sourceDealsDamage) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(sourceDealsDamage[2]),
        source: parseObjectSelector(sourceDealsDamage[1]),
        target: parseObjectSelector(sourceDealsDamage[3]),
        raw: rawClause,
      });
    }

    const namedSourceDealsDamage = normalizedRawClause.match(
      new RegExp(`^(${NAMED_DAMAGE_SOURCE_PATTERN})\\s+deals?\\s+(that much|\\d+|x|[a-z]+)\\s+damage\\s+to\\s+(.+)$`)
    );
    if (namedSourceDealsDamage) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(namedSourceDealsDamage[2]),
        source: parseObjectSelector(namedSourceDealsDamage[1]),
        target: parseObjectSelector(namedSourceDealsDamage[3]),
        raw: rawClause,
      });
    }
  }

  {
    const tapOrUntap = clause.match(/^(?:(?:you|its controller)\s+may\s+)?tap\s+or\s+untap\s+(.+)$/i);
    if (tapOrUntap) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(tapOrUntap[1]),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const tapTarget = clause.match(
      /^tap\s+((?:(?:all|(?:up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?target|that|those|this|enchanted|equipped)\s+.+|it|them))$/i
    );
    if (tapTarget) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(tapTarget[1]),
        mode: 'tap',
        raw: rawClause,
      });
    }

    const untapTarget = clause.match(
      /^untap\s+((?:(?:all|(?:up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?target|that|those|this|enchanted|equipped)\s+.+|it|them))$/i
    );
    if (untapTarget) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(untapTarget[1]),
        mode: 'untap',
        raw: rawClause,
      });
    }

    const optionalUntapChoice = clause.match(
      /^(?:you\s+may\s+)?choose\s+not\s+to\s+untap\s+(.+?)\s+during\s+your\s+untap\s+step$/i
    );
    if (optionalUntapChoice) {
      return withMeta({
        kind: 'optional_untap_choice',
        target: parseObjectSelector(optionalUntapChoice[1]),
        optional: true,
        raw: rawClause,
      });
    }

    const skipNextUntap = clause.match(
      /^((?:(?:all|(?:up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?target|that|those|this|enchanted|equipped)\s+.+|it|them))\s+do(?:es)?(?:n't|\s+not)\s+untap during (?:its|their) controller(?:'|â€™)?s next untap step$/i
    );
    if (skipNextUntap) {
      return withMeta({
        kind: 'skip_next_untap',
        target: parseObjectSelector(skipNextUntap[1]),
        raw: rawClause,
      });
    }

    const assignsNoCombatDamage = clause.match(/^(.+?)\s+assigns?\s+no\s+combat\s+damage\s+this\s+turn$/i);
    if (assignsNoCombatDamage) {
      return withMeta({
        kind: 'assign_no_combat_damage',
        target: parseObjectSelector(assignsNoCombatDamage[1]),
        duration: 'this_turn',
        raw: rawClause,
      });
    }
  }

  return null;
}



