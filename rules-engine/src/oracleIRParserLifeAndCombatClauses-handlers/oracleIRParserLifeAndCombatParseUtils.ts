/**
 * Origin parent: oracleIRParserLifeAndCombatClauses.ts
 * Cluster moved: parseDamageAmount, parseLifeChangeAmount, damage-clause patterns/normalize
 * Public: parseDamageAmount, parseLifeChangeAmount, PLAYER_SUBJECT_PREFIX,
 *   SELF_DAMAGE_SOURCE_SUBJECT_PATTERN, NAMED_DAMAGE_SOURCE_PATTERN, DAMAGE_AMOUNT_PATTERN,
 *   isDamageAmountDescriptor, shouldSkipGenericDamageSource, normalizeDamageClauseForParse
 */

import type { OracleEffectStep } from '../oracleIR';
import { normalizeOracleText, parseQuantity } from '../oracleIRParserUtils';

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

  if (
    normalized === 'the life that player lost this turn'
    || normalized === 'the life they lost this turn'
    || normalized === 'life they lost this turn'
    || normalized === 'life that player lost this turn'
    || normalized === 'the amount of life they lost this turn'
    || normalized === 'the amount of life that player lost this turn'
  ) {
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

export {
  parseDamageAmount,
  parseLifeChangeAmount,
  PLAYER_SUBJECT_PREFIX,
  SELF_DAMAGE_SOURCE_SUBJECT_PATTERN,
  NAMED_DAMAGE_SOURCE_PATTERN,
  DAMAGE_AMOUNT_PATTERN,
  isDamageAmountDescriptor,
  shouldSkipGenericDamageSource,
  normalizeDamageClauseForParse,
};
