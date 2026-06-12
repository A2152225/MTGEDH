import type { OracleEffectStep } from './oracleIR';
import {
  buildDamageStepFromClauseParts,
  buildMillStepFromClauseParts,
  buildQuantityStepFromClauseParts,
} from './oracleIRParserQuantityHelpers';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

function parseDamageAmount(raw: string | undefined): Extract<OracleEffectStep, { kind: 'deal_damage' }>['amount'] {
  const normalized = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/[."]+$/g, '');

  if (normalized === 'that much' || normalized === 'that many') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'that amount of' || normalized === 'that mana value' || normalized === 'the result') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'double that') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'damage to an opponent this turn, it deals double that') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'combat damage this turn, it deals that' || normalized === 'that damage') {
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
  if (normalized === 'twice its power') {
    return { kind: 'object_stat', subject: 'it', stat: 'power', multiplier: 2 };
  }
  if (normalized === 'twice x') {
    return { kind: 'unknown', raw: 'twice X' };
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
  if (normalized === "that equipment's mana value") {
    return { kind: 'object_stat', subject: 'that_equipment', stat: 'mana_value' };
  }
  if (normalized === "that spell's mana value") {
    return { kind: 'reference_amount', raw: normalized };
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
  if (normalized === "the sacrificed artifact's mana value") {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (/^damage equal to the number of charge counters on it to target player and that much$/i.test(normalized)) {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (/^damage equal to the number of quest counters on it to up to one target creature unless that creature's controller has this permanent deal that much$/i.test(normalized)) {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'its power' || normalized === 'their power' || normalized === "the creature's power") {
    return { kind: 'object_stat', subject: 'source', stat: 'power' };
  }

  const parsedQuantity = parseQuantity(raw);
  if (parsedQuantity.kind !== 'unknown') return parsedQuantity;

  return { kind: 'unknown', raw: String(raw || '').trim() };
}

function parseLifeChangeAmount(
  raw: string | undefined
): Extract<OracleEffectStep, { kind: 'gain_life' | 'lose_life' }>['amount'] {
  const normalizedRaw = String(raw || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .replace(/[."]+$/g, '');
  const lifeOnly = normalizedRaw.match(/^(.+?)\s+life$/i);
  const parsedQuantity = parseQuantity(lifeOnly ? String(lifeOnly[1] || '').trim() : normalizedRaw);
  if (parsedQuantity.kind !== 'unknown') return parsedQuantity;

  const normalized = normalizedRaw.toLowerCase();

  if (normalized === 'the life that player lost this turn') {
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
  if (normalized === 'the life lost this way') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'that much' || normalized === 'that many') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'that much life plus 1 instead') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'that amount of' || normalized === 'that mana value' || normalized === 'the result') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'the mana value of the sacrificed permanent') {
    return { kind: 'object_stat', subject: 'the_sacrificed_permanent', stat: 'mana_value' };
  }
  if (normalized === "that permanent's mana value") {
    return { kind: 'object_stat', subject: 'that_permanent', stat: 'mana_value' };
  }
  if (normalized === "the sacrificed enchantment's mana value") {
    return { kind: 'object_stat', subject: 'the_sacrificed_enchantment', stat: 'mana_value' };
  }
  if (normalized === 'the high bid') {
    return { kind: 'reference_amount', raw: normalized };
  }
  if (normalized === 'the power of target creature you control') {
    return { kind: 'object_stat', subject: 'target_creature_you_control', stat: 'power' };
  }
  if (normalized === 'your speed') {
    return { kind: 'reference_amount', raw: normalized };
  }

  return parsedQuantity;
}

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|you and that player|you and target player|you and that opponent|you and target opponent|each player|each other player|each opponent|each of those opponents|any number of target opponents|any number of target players other than that player|any number of target players|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'â€™-]*?(?:'s|â€™s)? (?:controller|owner)|[a-z0-9][a-z0-9 ,.'â€™-]*?(?:'s|â€™s) (?:controller|owner))\\s+)?";

const SELF_DAMAGE_SOURCE_SUBJECT_PATTERN =
  "(?:it|he|she|this (?:permanent|spell|creature|artifact|enchantment|planeswalker|battle|land|card|emblem|token|aura|equipment|class|saga|spacecraft|vehicle)|enchanted creature|equipped creature|each creature(?: you control)?(?: that[^,]+?)?|up to [a-z0-9 -]+ target creatures? you control|that [a-z0-9][a-z0-9 ,.'â€™-]*|target [a-z0-9][a-z0-9 ,.'â€™-]*|another target [a-z0-9][a-z0-9 ,.'â€™-]*)";

const NAMED_DAMAGE_SOURCE_PATTERN =
  "[A-Z0-9][A-Za-z0-9'â€™/-]*(?: [A-Z0-9][A-Za-z0-9'â€™/-]*)*(?:, [A-Z0-9][A-Za-z0-9'â€™/-]*(?: [A-Z0-9][A-Za-z0-9'â€™/-]*)*)?";

const DAMAGE_AMOUNT_PATTERN = "that much|that many|twice\\s+x|x|\\d+|[a-z]+";

function isDamageAmountDescriptor(raw: string | undefined): boolean {
  return /^(?:combat|noncombat)$/i.test(String(raw || '').trim());
}

function shouldSkipGenericDamageSource(raw: string | undefined): boolean {
  const normalized = normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (/^otherwise\b/.test(normalized)) return true;
  if (/\band\b/.test(normalized) && /\b(?:gets?|gains?|draws?|creates?|destroys?|returns?|exiles?|adds?|gain|draw|create|destroy|return|exile|add)\b/.test(normalized)) return true;
  return false;
}

function normalizeDamageClauseForParse(clause: string): string {
  let working = normalizeOracleText(clause)
    .replace(/^[\s(]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/^[\u2022•]\s*/, '')
    .trim();

  working = working.replace(/^(?:[ivxlcdm]+)\s*(?:[-?]|[^\w\s])+\s*/i, '');
  working = working.replace(
    /^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\s+-\s+(?=(?:this|it|he|she|each|target|enchanted|equipped|[A-Z0-9]).*\bdeals?\b)/i,
    ''
  );
  working = working.replace(
    /^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\s+\.\.\s*(?=(?:this|it|he|she|each|target|enchanted|equipped|[A-Z0-9]).*\bdeals?\b)/i,
    ''
  );
  working = working.replace(/^\+\s*\{[^}]+\}\s+-\s*/i, '');

  const commaEmbeddedDamage = working.match(/^[\s\S]+?,\s*([^,;]*\bdeals?\b[\s\S]*)$/i);
  if (commaEmbeddedDamage && !/^\s*[^,;]*\bdeals?\b/i.test(working)) {
    working = String(commaEmbeddedDamage[1] || '').trim();
  }
  working = working.replace(/,\s*then\b[\s\S]*$/i, '').trim();

  const triggerBody = working.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (triggerBody) working = String(triggerBody[1] || '').trim();

  const mayHave = working.match(/^(?:(?:you|any opponent|any player|that player|that opponent|its controller|that [a-z0-9][a-z0-9 ,'â€™-]*?(?:'s|â€™s)? controller)\s+may\s+)?have\s+(.+?)\s+deal\s+(.+)$/i);
  if (mayHave) {
    working = `${String(mayHave[1] || '').trim()} deals ${String(mayHave[2] || '').trim()}`;
  }

  return working.trim();
}

export function tryParseLifeAndCombatClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  let { clause, rawClause, withMeta } = args;
  clause = normalizeOracleText(clause)
    .replace(/^enchanted\s+\w+\s+has\s+"(?:\{[^}]+\}(?:,\s*)?)+(?:,\s*[^:]+)?:\s*/i, '')
    .replace(/^(?:\{[^}]+\}(?:,\s*)?)+(?:,\s*[^:]+)?:\s*/i, '')
    .replace(/^(?:\{TK\})+\s*-\s*/i, '')
    .replace(/^\d+(?:\s*-\s*\d+)?\s*\|\s*/i, '')
    .replace(/^when(?:ever)?\s+.+?,\s*/i, '')
    .replace(/^at\s+the\s+beginning\s+of\s+.+?,\s*/i, '')
    .trim();

  {
    const gainThatMuch = clause.match(/^you gain that much life$/i);
    if (gainThatMuch) {
      return withMeta({
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: { kind: 'reference_amount', raw: 'that much' },
        raw: rawClause,
      });
    }

    const gainEach = clause.match(/^(you and (?:that|target) (?:player|opponent))\s+each\s+gain\s+(that much|that many|\d+|x|[a-z]+)\s+life\b/i);
    if (gainEach) {
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(gainEach[1]),
        amount: parseQuantity(gainEach[2]),
        raw: rawClause,
      });
    }

    const gainForEach = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}gains?\\s+(\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+life\\s+for\\s+each\\s+(.+)$`, 'i'),
    );
    if (gainForEach) {
      const amountText = `${String(gainForEach[2] || '').trim()} life for each ${String(gainForEach[3] || '').trim()}`;
      const parsedAmount = parseQuantity(amountText);
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(gainForEach[1]),
        amount: parsedAmount.kind === 'unknown' ? { kind: 'reference_amount', raw: amountText } : parsedAmount,
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

    const gainDrawClause = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}gains?\\s+((?:that much|that many|\\d+|x|[a-z]+)\\s+life)\\s+and\\s+draws?\\s+((?:a|an|\\d+|x|[a-z]+)\\s+cards?)(?:,\\s+where\\s+x\\s+is\\s+(.+))?$`,
        'i'
      )
    );
    if (gainDrawClause) {
      const who = parsePlayerSelector(gainDrawClause[1]);
      const whereX = gainDrawClause[4]
        ? ({ kind: 'where', raw: String(gainDrawClause[4] || '').trim() } as const)
        : undefined;
      return withMeta({
        kind: 'gain_life',
        who,
        amount: parseLifeChangeAmount(String(gainDrawClause[2] || '').trim()),
        ...(whereX ? { whereX } : {}),
        raw: rawClause,
      });
    }

    const gainTail = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}gains?\\s+(.+)$`, 'i'));
    if (
      gainTail &&
      /\blife\b/i.test(gainTail[2]) &&
      !/\bfor\s+each\b/i.test(gainTail[2]) &&
      !/\blife\s+equal\s+to\b/i.test(gainTail[2]) &&
      !/\sand\s+draws?\s+/i.test(gainTail[2])
    ) {
      return buildQuantityStepFromClauseParts({
        kind: 'gain_life',
        who: parsePlayerSelector(gainTail[1]),
        quantityTail: String(gainTail[2] || '').trim(),
        rawClause,
        withMeta,
      });
    }

    const gainDefaultTail = clause.match(/^gain\s+(.+)$/i);
    if (gainDefaultTail && /\blife\b/i.test(gainDefaultTail[1]) && !/\bfor\s+each\b/i.test(gainDefaultTail[1]) && !/\blife\s+equal\s+to\b/i.test(gainDefaultTail[1])) {
      return buildQuantityStepFromClauseParts({
        kind: 'gain_life',
        who: { kind: 'you' },
        quantityTail: String(gainDefaultTail[1] || '').trim(),
        rawClause,
        withMeta,
      });
    }

    const loseEqual = clause.match(/^(.*?)(?:loses?\s+life\s+equal\s+to)\s+(.+)$/i);
    if (loseEqual) {
      const whoRaw = String(loseEqual[1] || '').trim().replace(/^you\s+may\s+have\s+/i, '').replace(/^have\s+/i, '').replace(/\s+$/, '');
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

    const loseTail = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}loses?\\s+(.+)$`, 'i'));
    if (loseTail && /\blife\b/i.test(loseTail[2]) && !/half\s+(?:your|their|his or her)\s+life/i.test(loseTail[2]) && !/\blife\s+equal\s+to\b/i.test(loseTail[2])) {
      return buildQuantityStepFromClauseParts({
        kind: 'lose_life',
        who: parsePlayerSelector(loseTail[1]),
        quantityTail: String(loseTail[2] || '').trim(),
        rawClause,
        withMeta,
      });
    }

    const loseHalfLife = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}loses?\\s+half\\s+(?:your|their|his or her)\\s+life,\\s*rounded\\s+up$`, 'i'));
    if (loseHalfLife) {
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(loseHalfLife[1]),
        amount: { kind: 'reference_amount', raw: 'half their life rounded up' },
        raw: rawClause,
      });
    }

    const loseQuarterLife = clause.match(/^the loser of the flip loses a quarter of their life, rounded up$/i);
    if (loseQuarterLife) {
      return withMeta({
        kind: 'lose_life',
        who: { kind: 'raw', text: 'the loser of the flip' },
        amount: { kind: 'reference_amount', raw: 'a quarter of their life, rounded up' },
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

    const loseEach = clause.match(/^(you and (?:that|target) (?:player|opponent)|any number of target (?:players|opponents))\s+each\s+lose\s+(that much|that many|\d+|x|[a-z]+)\s+life\b/i);
    if (loseEach) {
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(loseEach[1]),
        amount: parseQuantity(loseEach[2]),
        raw: rawClause,
      });
    }

    const mayHaveLose = clause.match(/^(?:you\s+may\s+)?have\s+(.+?)\s+lose\s+(that much|that many|\d+|x|[a-z]+)\s+life\b/i);
    if (mayHaveLose) {
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(String(mayHaveLose[1] || '').trim()),
        amount: parseQuantity(mayHaveLose[2]),
        optional: true,
        raw: rawClause,
      });
    }

  }

  {
    const damageClause = normalizeDamageClauseForParse(clause);
    const damageIncrease = damageClause.match(
      /^if\s+(.+?)\s+would\s+deal\s+(?:(combat|noncombat)\s+)?damage\s+to\s+(.+?),\s*it\s+deals?\s+that much damage plus\s+(.+?)\s+instead$/i
    );
    if (damageIncrease) {
      const damageFilterRaw = String(damageIncrease[2] || '').toLowerCase();
      return withMeta({
        kind: 'modify_damage',
        mode: 'add',
        amount: parseQuantity(String(damageIncrease[4] || '').trim()),
        sourceFilter: String(damageIncrease[1] || '').trim(),
        targetFilter: String(damageIncrease[3] || '').trim(),
        damageFilter: damageFilterRaw === 'combat' ? 'combat' : damageFilterRaw === 'noncombat' ? 'noncombat' : 'any',
        raw: rawClause,
      } as OracleEffectStep);
    }

    const damageIncreaseFollowup = damageClause.match(/^it\s+deals?\s+that much damage plus\s+(.+?)(?:\s+instead)?$/i);
    if (damageIncreaseFollowup) {
      return withMeta({
        kind: 'modify_damage',
        mode: 'add',
        amount: parseQuantity(String(damageIncreaseFollowup[1] || '').trim()),
        damageFilter: 'any',
        raw: rawClause,
      } as OracleEffectStep);
    }

    const damageDecrease = damageClause.match(
      /^if\s+(.+?)\s+would\s+deal\s+(?:(combat|noncombat)\s+)?damage\s+to\s+(.+?),\s*it\s+deals?\s+that much damage minus\s+(.+?)(?:\s+to\s+.+?)?\s+instead$/i
    );
    if (damageDecrease) {
      const damageFilterRaw = String(damageDecrease[2] || '').toLowerCase();
      return withMeta({
        kind: 'modify_damage',
        mode: 'subtract',
        amount: parseQuantity(String(damageDecrease[4] || '').trim()),
        sourceFilter: String(damageDecrease[1] || '').trim(),
        targetFilter: String(damageDecrease[3] || '').trim(),
        damageFilter: damageFilterRaw === 'combat' ? 'combat' : damageFilterRaw === 'noncombat' ? 'noncombat' : 'any',
        raw: rawClause,
      } as OracleEffectStep);
    }

    const damageDecreaseFollowup = damageClause.match(/^it\s+deals?\s+that much damage minus\s+(.+?)(?:\s+to\s+.+?)?(?:\s+instead)?$/i);
    if (damageDecreaseFollowup) {
      return withMeta({
        kind: 'modify_damage',
        mode: 'subtract',
        amount: parseQuantity(String(damageDecreaseFollowup[1] || '').trim()),
        damageFilter: 'any',
        raw: rawClause,
      } as OracleEffectStep);
    }

    const doubleThatReplacement = damageClause.match(
      /^damage to an opponent this turn, it deals double that damage to (.+)$/i
    );
    if (doubleThatReplacement) {
      return withMeta({
        kind: 'deal_damage',
        amount: { kind: 'reference_amount', raw: 'double that' },
        source: { kind: 'raw', text: 'it' },
        target: parseObjectSelector(String(doubleThatReplacement[1] || '').trim()),
        raw: rawClause,
      });
    }

    if (/^each deals damage equal to its power to the other$/i.test(damageClause)) {
      return withMeta({
        kind: 'deal_damage',
        amount: { kind: 'object_stat', subject: 'source', stat: 'power' },
        source: { kind: 'raw', text: 'each creature' },
        target: { kind: 'raw', text: 'the other creature' },
        raw: rawClause,
      });
    }

    const fight = damageClause.match(/^(.+?)\s+fights?\s+(.+)$/i);
    if (fight) {
      return withMeta({
        kind: 'deal_damage',
        amount: { kind: 'object_stat', subject: 'source', stat: 'power' },
        source: parseObjectSelector(String(fight[1] || '').trim()),
        target: parseObjectSelector(String(fight[2] || '').trim()),
        raw: rawClause,
      });
    }

    const sourceDealsDynamicDamage = damageClause.match(
      /^(.+?)\s+deals?\s+(.+?)\s+damage\s+to\s+([^,]+)(?:,\s*where\s+x\s+is\s+(.+))?$/i
    );
    if (sourceDealsDynamicDamage) {
      const quantityTail = sourceDealsDynamicDamage[4]
        ? `${String(sourceDealsDynamicDamage[2] || '').trim()}, where x is ${String(sourceDealsDynamicDamage[4] || '').trim()}`
        : String(sourceDealsDynamicDamage[2] || '').trim();
      return buildDamageStepFromClauseParts({
        source: parseObjectSelector(String(sourceDealsDynamicDamage[1] || '').trim()),
        quantityTail,
        target: parseObjectSelector(String(sourceDealsDynamicDamage[3] || '').trim()),
        rawClause,
        withMeta,
      });
    }

    const dealDamageEqualDynamic = damageClause.match(/^deal\s+damage\s+equal\s+to\s+(.+?)\s+to\s+(.+)$/i);
    if (dealDamageEqualDynamic && /,\s*where\s+x\s+is\s+/i.test(damageClause)) {
      return buildDamageStepFromClauseParts({
        quantityTail: String(dealDamageEqualDynamic[1] || '').trim(),
        target: parseObjectSelector(String(dealDamageEqualDynamic[2] || '').trim()),
        rawClause,
        withMeta,
      });
    }

    const equalDividedDamage = damageClause.match(
      /^(.+?)\s+deals?\s+damage\s+equal\s+to\s+(.+?)\s+divided\s+as\s+you\s+choose\s+among\s+one,\s+two,\s+or\s+three\s+targets$/i
    );
    if (equalDividedDamage) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(equalDividedDamage[2]),
        source: parseObjectSelector(String(equalDividedDamage[1] || '').trim()),
        target: { kind: 'raw', text: 'one, two, or three targets' },
        division: 'as_you_choose',
        raw: rawClause,
      });
    }

    const equalDividedDamageGeneric = damageClause.match(
      /^(.+?)\s+deals?\s+damage\s+equal\s+to\s+(.+?)\s+divided(?:\s+(?:evenly, rounded down),?\s+among|\s+as you choose among)\s+(.+)$/i
    );
    if (equalDividedDamageGeneric) {
      const whereSuffix = damageClause.match(/,\s*where\s+x\s+is\s+(.+)$/i);
      if (whereSuffix) {
        const evenlyRounded = /\bevenly,?\s+rounded\s+down\b/i.test(damageClause);
        return buildDamageStepFromClauseParts({
          source: parseObjectSelector(String(equalDividedDamageGeneric[1] || '').trim()),
          quantityTail: `${String(equalDividedDamageGeneric[2] || '').trim()}, where x is ${String(whereSuffix[1] || '').trim()}`,
          target: parseObjectSelector(String(equalDividedDamageGeneric[3] || '').trim()),
          division: evenlyRounded ? 'evenly_rounded_down' : 'as_you_choose',
          rawClause,
          withMeta,
        });
      }
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(equalDividedDamageGeneric[2]),
        source: parseObjectSelector(equalDividedDamageGeneric[1]),
        target: parseObjectSelector(equalDividedDamageGeneric[3]),
        division: /\bevenly,?\s+rounded\s+down\b/i.test(damageClause) ? 'evenly_rounded_down' : 'as_you_choose',
        raw: rawClause,
      });
    }

    const dividedDamageWhere = damageClause.match(
      /^(?:(.+?)\s+)?deals?\s+(.+?)\s+damage\s+divided(?:\s+(evenly, rounded down))?(?:\s+as you choose)?\s+among\s+(.+?),\s*where\s+x\s+is\s+(.+)$/i
    );
    if (dividedDamageWhere) {
      const sourceText = String(dividedDamageWhere[1] || '').trim();
      const evenlyRounded = Boolean(String(dividedDamageWhere[3] || '').trim());
      return buildDamageStepFromClauseParts({
        ...(sourceText ? { source: parseObjectSelector(sourceText) } : {}),
        quantityTail: `${String(dividedDamageWhere[2] || '').trim()}, where x is ${String(dividedDamageWhere[5] || '').trim()}`,
        target: parseObjectSelector(String(dividedDamageWhere[4] || '').trim()),
        division: evenlyRounded ? 'evenly_rounded_down' : 'as_you_choose',
        rawClause,
        withMeta,
      });
    }

    const dividedDamage = damageClause.match(new RegExp(`^(?:(.+?)\\s+)?deals?\\s+(${DAMAGE_AMOUNT_PATTERN})\\s+damage\\s+divided(?:\\s+(evenly, rounded down))?\\s+as you choose among\\s+(.+)$`, 'i'));
    if (dividedDamage) {
      const sourceText = String(dividedDamage[1] || '').trim();
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(String(dividedDamage[2] || '').trim()),
        ...(sourceText ? { source: parseObjectSelector(sourceText) } : {}),
        target: parseObjectSelector(String(dividedDamage[4] || '').trim()),
        division: dividedDamage[3] ? 'evenly_rounded_down' : 'as_you_choose',
        raw: rawClause,
      });
    }

    const evenlyDividedDamage = damageClause.match(new RegExp(`^(?:(.+?)\\s+)?deals?\\s+(${DAMAGE_AMOUNT_PATTERN})\\s+damage\\s+divided\\s+(evenly, rounded down),?\\s+among\\s+(.+)$`, 'i'));
    if (evenlyDividedDamage && !isDamageAmountDescriptor(evenlyDividedDamage[2])) {
      const sourceText = String(evenlyDividedDamage[1] || '').trim();
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(String(evenlyDividedDamage[2] || '').trim()),
        ...(sourceText ? { source: parseObjectSelector(sourceText) } : {}),
        target: parseObjectSelector(String(evenlyDividedDamage[4] || '').trim()),
        division: 'evenly_rounded_down',
        raw: rawClause,
      });
    }

    const dealDamageEqual = damageClause.match(/^deal\s+damage\s+equal\s+to\s+(.+?)\s+to\s+(.+)$/i);
    if (dealDamageEqual) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(dealDamageEqual[1]),
        target: parseObjectSelector(dealDamageEqual[2]),
        raw: rawClause,
      });
    }

    const sourceDealsDamageEqual = damageClause.match(
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

    const sourceDealsDamageToEqual = damageClause.match(/^(.+?)\s+deals?\s+damage\s+to\s+(.+?)\s+equal\s+to\s+(.+)$/i);
    if (sourceDealsDamageToEqual && !shouldSkipGenericDamageSource(sourceDealsDamageToEqual[1])) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(sourceDealsDamageToEqual[3]),
        source: parseObjectSelector(sourceDealsDamageToEqual[1]),
        target: parseObjectSelector(sourceDealsDamageToEqual[2]),
        raw: rawClause,
      });
    }

    const genericSourceDealsDamageEqual = damageClause.match(/^(.+?)\s+deals?\s+damage\s+equal\s+to\s+(.+?)\s+to\s+(.+)$/i);
    if (genericSourceDealsDamageEqual && !shouldSkipGenericDamageSource(genericSourceDealsDamageEqual[1])) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseDamageAmount(genericSourceDealsDamageEqual[2]),
        source: parseObjectSelector(genericSourceDealsDamageEqual[1]),
        target: parseObjectSelector(genericSourceDealsDamageEqual[3]),
        raw: rawClause,
      });
    }

    const namedSourceDealsDamageEqual = normalizeOracleText(damageClause).match(
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

    const dealDamage = damageClause.match(new RegExp(`^deals?\\s+(${DAMAGE_AMOUNT_PATTERN})\\s+damage\\s+to\\s+(.+)$`, 'i'));
    if (dealDamage && !isDamageAmountDescriptor(dealDamage[1])) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(String(dealDamage[1] || '').trim()),
        target: parseObjectSelector(dealDamage[2]),
        raw: rawClause,
      });
    }

    const sourceDealsDamage = damageClause.match(
      new RegExp(`^(${SELF_DAMAGE_SOURCE_SUBJECT_PATTERN})\\s+deals?\\s+(${DAMAGE_AMOUNT_PATTERN})\\s+damage\\s+to\\s+(.+)$`, 'i')
    );
    if (sourceDealsDamage && !isDamageAmountDescriptor(sourceDealsDamage[2])) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(sourceDealsDamage[2]),
        source: parseObjectSelector(sourceDealsDamage[1]),
        target: parseObjectSelector(sourceDealsDamage[3]),
        raw: rawClause,
      });
    }

    const genericSourceDealsDamage = damageClause.match(new RegExp(`^(.+?)\\s+deals?\\s+(${DAMAGE_AMOUNT_PATTERN})\\s+damage\\s+to\\s+(.+)$`, 'i'));
    if (genericSourceDealsDamage && !isDamageAmountDescriptor(genericSourceDealsDamage[2]) && !shouldSkipGenericDamageSource(genericSourceDealsDamage[1])) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(String(genericSourceDealsDamage[2] || '').trim()),
        source: parseObjectSelector(genericSourceDealsDamage[1]),
        target: parseObjectSelector(genericSourceDealsDamage[3]),
        raw: rawClause,
      });
    }

    const namedSourceDealsDamage = normalizeOracleText(damageClause).match(
      new RegExp(`^(${NAMED_DAMAGE_SOURCE_PATTERN})\\s+deals?\\s+(${DAMAGE_AMOUNT_PATTERN})\\s+damage\\s+to\\s+(.+)$`)
    );
    if (namedSourceDealsDamage && !isDamageAmountDescriptor(namedSourceDealsDamage[2])) {
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
    const tapOrUntap = clause.match(/^(?:or\s+)?(?:(?:you|its controller)\s+may\s+)?tap\s+or\s+untap\s+(.+)$/i);
    if (tapOrUntap) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(tapOrUntap[1]),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const nonTargetTapUntap = clause.match(
      /^(?:or\s+)?(?:for\s+each\s+opponent,\s+)?(tap|untap)\s+((?:(?:all|each)\s+|up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(?:creatures?|lands?|artifacts?|enchantments?|permanents?)(?:\s+(?:you control|target player controls|an opponent controls|your opponents control|that player controls|that opponent controls))?(?:\s+with\s+.+?)?)$/i
    );
    if (nonTargetTapUntap) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(String(nonTargetTapUntap[2] || '').trim()),
        mode: String(nonTargetTapUntap[1] || '').toLowerCase() as 'tap' | 'untap',
        raw: rawClause,
      });
    }

    const broadNonTargetTapUntap = clause.match(
      /^(?:or\s+)?(?:for\s+each\s+opponent,\s+)?(?:(?:you|target player)\s+)?(tap|untap)s?\s+((?:(?:all|each(?:\s+other)?|up to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+|x))\s+).+)$/i
    );
    if (broadNonTargetTapUntap && /\b(?:creatures?|lands?|artifacts?|enchantments?|permanents?|you control)\b/i.test(String(broadNonTargetTapUntap[2] || ''))) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(String(broadNonTargetTapUntap[2] || '').trim()),
        mode: String(broadNonTargetTapUntap[1] || '').toLowerCase() as 'tap' | 'untap',
        raw: rawClause,
      });
    }

    const tapTarget = clause.match(
      /^(?:or\s+)?(?:for\s+each\s+opponent,\s+)?tap\s+((?:(?:all|any\s+number\s+of\s+untapped|another\s+target|one\s+or\s+two\s+target|(?:up\s+to\s+)?x\s+target|(?:(?:up\s+to\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?target|that|those|this|enchanted|equipped)\s+.+|it|them))$/i
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
      /^untap\s+((?:(?:all|another\s+target|(?:(?:up\s+to\s+)?(?:one|two|one or two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+)?(?:other\s+)?target|the chosen|that|those|this|enchanted|equipped)\s+.+|it|them))$/i
    );
    if (untapTarget) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(untapTarget[1]),
        mode: 'untap',
        raw: rawClause,
      });
    }

    const untapBroad = clause.match(/^untap\s+(.+)$/i);
    if (
      untapBroad &&
      /\b(?:creatures?|lands?|artifacts?|permanents?|enchantments?)\b/i.test(String(untapBroad[1] || ''))
    ) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(String(untapBroad[1] || '').trim()),
        mode: 'untap',
        raw: rawClause,
      });
    }

    const untapAndRemoveFromCombat = clause.match(/^untap\s+(it|them|that\s+creature|target\s+creature)\s+and\s+remove\s+it\s+from\s+combat$/i);
    if (untapAndRemoveFromCombat) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(String(untapAndRemoveFromCombat[1] || '').trim()),
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

    const controllerSkipNextUntap = clause.match(
      /^(.+?)\s+do(?:es)?(?:n't|\s+not)\s+untap\s+during\s+(?:your|their)\s+next\s+untap\s+step$/i
    );
    if (controllerSkipNextUntap) {
      return withMeta({
        kind: 'skip_next_untap',
        target: parseObjectSelector(String(controllerSkipNextUntap[1] || '').trim()),
        raw: rawClause,
      });
    }

    const conditionalUntapRestriction = clause.match(/^(.+?)\s+do(?:es)?(?:n't|\s+not)\s+untap\s+during\s+your\s+untap\s+step\s+if\s+(.+)$/i);
    if (conditionalUntapRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(conditionalUntapRestriction[1] || '').trim()),
        effectText: [`doesn't untap during your untap step if ${String(conditionalUntapRestriction[2] || '').trim()}`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const staticUntapRestriction = clause.match(/^(.+?)\s+do(?:es)?(?:n't|\s+not)\s+untap\s+during\s+(?:your|its\s+controller(?:'|â€™)?s)\s+untap\s+step(?:\s+for\s+as\s+long\s+as\s+you\s+control\s+this\s+creature)?$/i);
    if (staticUntapRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticUntapRestriction[1] || '').trim()),
        effectText: [normalizeOracleText(rawClause)],
        duration: 'static',
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

    const preventAllToTarget = clause.match(/^prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(.+?)\s+this\s+turn$/i);
    if (preventAllToTarget) {
      return withMeta({
        kind: 'prevent_damage',
        amount: 'all',
        recipientTarget: parseObjectSelector(String(preventAllToTarget[1] || '').trim()),
        duration: 'this_turn',
        raw: rawClause,
      });
    }

    const preventCombatByTarget = clause.match(/^prevent\s+all\s+combat\s+damage(?:\s+that\s+would\s+be\s+dealt)?\s+by\s+(.+?)\s+this\s+turn$/i);
    if (preventCombatByTarget) {
      return withMeta({
        kind: 'prevent_damage',
        amount: 'all',
        target: parseObjectSelector(String(preventCombatByTarget[1] || '').trim()),
        duration: 'this_turn',
        combatOnly: true,
        raw: rawClause,
      });
    }

    const preventCombatTargetWouldDeal = clause.match(/^prevent\s+all\s+combat\s+damage\s+(.+?)\s+would\s+deal\s+this\s+turn$/i);
    if (preventCombatTargetWouldDeal) {
      return withMeta({
        kind: 'prevent_damage',
        amount: 'all',
        target: parseObjectSelector(String(preventCombatTargetWouldDeal[1] || '').trim()),
        duration: 'this_turn',
        combatOnly: true,
        raw: rawClause,
      });
    }

    const preventCombatToAndBy = clause.match(/^prevent\s+all\s+combat\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+and\s+dealt\s+by\s+(.+?)(?:\s+this\s+turn)?$/i);
    if (preventCombatToAndBy) {
      const target = parseObjectSelector(String(preventCombatToAndBy[1] || '').trim());
      return withMeta({
        kind: 'prevent_damage',
        amount: 'all',
        target,
        recipientTarget: target,
        duration: 'this_turn',
        combatOnly: true,
        raw: rawClause,
      });
    }

    const staticPreventBy = clause.match(/^prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+by\s+(.+)$/i);
    if (staticPreventBy) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticPreventBy[1] || '').trim()),
        effectText: ['prevent all damage that would be dealt by this object'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const selfCombatPreventThisTurn = clause.match(
      /^prevent\s+all\s+combat\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(it|this creature|~)\s+this\s+turn\.?$/i,
    );
    if (selfCombatPreventThisTurn) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('this creature'),
        effectText: ['prevent all combat damage that would be dealt to this creature this turn'],
        duration: 'end_of_turn',
        raw: rawClause,
      });
    }

    const staticPreventTo = clause.match(/^prevent\s+all\s+(combat\s+)?damage\s+that\s+would\s+be\s+dealt\s+to\s+(.+)$/i);
    if (staticPreventTo) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticPreventTo[2] || '').trim()),
        effectText: [`prevent all ${staticPreventTo[1] ? 'combat ' : ''}damage that would be dealt to this object`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const sourcePreventMillEachOpponent = clause.match(
      /^if\s+a\s+source\s+you\s+control\s+would\s+deal\s+damage\s+to\s+an\s+opponent,\s+prevent\s+that\s+damage\s+and\s+each\s+opponent\s+mills\s+that\s+many\s+cards\.?$/i
    );
    if (sourcePreventMillEachOpponent) {
      return withMeta({
        kind: 'conditional',
        condition: {
          kind: 'if',
          raw: 'a source you control would deal damage to an opponent',
        },
        steps: [
          {
            kind: 'prevent_damage',
            amount: { kind: 'reference_amount', raw: 'that much' },
            duration: 'this_turn',
            raw: 'prevent that damage',
          },
          buildMillStepFromClauseParts({
            who: { kind: 'each_opponent' },
            quantityTail: 'that many cards',
            rawClause: 'each opponent mills that many cards',
            withMeta,
          }),
        ],
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  return null;
}



