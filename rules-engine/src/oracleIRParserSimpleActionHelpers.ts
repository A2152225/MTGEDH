/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: WithMeta plus simple-action parse helpers (quantity/mana/draw/symbol)
 * Public: WithMeta, PLAYER_SUBJECT_PREFIX, DRAW_AMOUNT_WORD_PATTERN, COUNTER_AMOUNT_PATTERN,
 * REFERENCEABLE_COUNTER_AMOUNT_PATTERN, parseManaChoiceList, parseManaOptionGroupList,
 * parseSmallNumber, parseCounterQuantity, parseScaledCounterQuantity, parseAddManaAmountExpression,
 * parseDrawAmount, normalizeDrawClauseForParse, sharedDrawSelector, buildRepeatedMana,
 * countEnergySymbols, countTicketSymbols, normalizePossessiveObjectReference,
 * recoverTruncatedActionClause, SimpleActionClauseParseArgs
 */

import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|each player|each other player|each opponent|each friend|each of those players|each of those opponents|any number of target opponents|any number of target players other than that player|any number of target players|each of that player's opponents|enchanted player|target player|target opponent|that player|that opponent|that attacking player|an opponent|the opponent|the player|attacking player|defending player|the defending player|the attacking player|the controller of those creatures|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'’-]*?(?:'s|’s)? (?:controller|owner))\\s+)?";

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
    case 'its power':
      return { kind: 'object_stat', subject: 'it', stat: 'power' };
    case "this creature's power":
      return { kind: 'object_stat', subject: 'this_creature', stat: 'power' };
    case "this permanent's power":
      return { kind: 'object_stat', subject: 'this_permanent', stat: 'power' };
    case "this permanent's toughness":
      return { kind: 'object_stat', subject: 'this_permanent', stat: 'toughness' };
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

  clause = clause.replace(/^([a-z][a-z0-9 ',/-]{0,60})[-—]\s+(?=(?:you|target|each|any number|draw|if you would draw)\b)/i, '');

  const triggerBody = clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (triggerBody && /\bdraws?\b/i.test(String(triggerBody[1] || ''))) {
    clause = String(triggerBody[1] || '').trim();
  }

  // Keep "if you would draw a card, draw N instead" intact so the draw parser can stamp
  // replacementOf: 'draw_card'. Stripping it to a bare "draw N" loses the replacement.
  const isWouldDrawReplacement = /\bif you would draw a card\b/i.test(clause);
  const replacementDrawBody = isWouldDrawReplacement
    ? null
    : clause.match(/^if\b[\s\S]*?\bwould\s+draw\b[\s\S]*?,\s+(?:instead\s+)?((?:you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)|(?:(?:you|target player|target opponent|that player|that opponent|each player|each opponent|any number of target opponents|each of that player's opponents|its controller)\s+)?(?:may\s+)?draws?\b[\s\S]+)(?:\s+instead)?$/i);
  if (replacementDrawBody) {
    clause = String(replacementDrawBody[1] || '').replace(/\s+instead$/i, '').trim();
  }

  const nextTimeReplacementDrawBody = clause.match(/^the\s+next\s+time\b[\s\S]*?,\s*instead\s+((?:(?:you|target player|target opponent|that player|that opponent|each player|each opponent|any number of target opponents|any number of target players(?: other than that player)?|its controller)\s+)?(?:may\s+)?draws?\b[\s\S]+|draw\b[\s\S]+)$/i);
  if (nextTimeReplacementDrawBody) {
    clause = String(nextTimeReplacementDrawBody[1] || '').trim();
  }

  const conditionalDrawBody = clause.match(/^if\b(?!\s+[^,]*\bwould\s+draw\b).+?,\s+((?:you\s+may\s+have\s+)?(?:(?:you|target player|target opponent|that player|that opponent|defending player|the defending player|the attacking player|any number of target opponents|any number of target players(?: other than that player)?|each of that player's opponents|its controller)\s+)?draws?\b[\s\S]+|you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)$/i);
  if (conditionalDrawBody) clause = String(conditionalDrawBody[1] || '').trim();

  const trailingCommaDraw = isWouldDrawReplacement
    ? null
    : clause.match(/,\s*((?:you\s+may\s+have\s+)?(?:(?:you|its controller|that player|that opponent|target player|target opponent|each player|each opponent|any number of target opponents|any number of target players(?: other than that player)?|each of that player's opponents|defending player|the defending player|the attacking player)\s+)?(?:may\s+)?draws?\b[\s\S]+|you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)$/i);
  if (
    trailingCommaDraw &&
    !/^\s*(?:whenever|when|if)\b/i.test(String(trailingCommaDraw[1] || '')) &&
    !/\bdeals?\s+x\s+damage\b/i.test(clause)
  ) {
    clause = String(trailingCommaDraw[1] || '').trim();
  }

  const trailingAndDraw = clause.match(/\band\s+((?:you\s+may\s+have\s+)?(?:(?:you|its controller|that player|that opponent|target player|target opponent|each player|each opponent|any number of target opponents|any number of target players(?: other than that player)?|each of that player's opponents|defending player|the defending player|the attacking player)\s+)?(?:may\s+)?draws?\b[\s\S]+|you\s+and\s+.+?\s+each\s+draws?\b[\s\S]+)$/i);
  if (
    trailingAndDraw &&
    !/\bgains?\s+x\s+life\s+and\s+draws?\s+x\s+cards,\s*where\s+x\s+is\b/i.test(clause)
  ) {
    clause = String(trailingAndDraw[1] || '').trim();
  }

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

function recoverTruncatedActionClause(clause: string): string {
  const trimmed = String(clause || '').trim();
  if (/^a card unless\b/i.test(trimmed)) return `draw ${trimmed}`;
  if (/^cards? unless\b/i.test(trimmed)) return `draw ${trimmed}`;
  return trimmed;
}

export type { WithMeta };
export type SimpleActionClauseParseArgs = {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
  parseRest: (args: {
    clause: string;
    rawClause: string;
    withMeta: WithMeta;
  }) => OracleEffectStep | null;
};
export {
  PLAYER_SUBJECT_PREFIX,
  DRAW_AMOUNT_WORD_PATTERN,
  COUNTER_AMOUNT_PATTERN,
  REFERENCEABLE_COUNTER_AMOUNT_PATTERN,
  parseManaChoiceList,
  parseManaOptionGroupList,
  parseSmallNumber,
  parseCounterQuantity,
  parseScaledCounterQuantity,
  parseAddManaAmountExpression,
  parseDrawAmount,
  normalizeDrawClauseForParse,
  sharedDrawSelector,
  buildRepeatedMana,
  countEnergySymbols,
  countTicketSymbols,
  normalizePossessiveObjectReference,
  recoverTruncatedActionClause,
};
