/**
 * Origin parent: oracleIRParserSimpleActionEarlyClauses.ts
 * Cluster: choose-a-number-between, flip-that-many, per-flip draw/damage,
 *   and "if you won N flips this way, you may cast from hand this turn"
 *   (Yusri, Fortune's Flame family).
 * Public: tryParseCoinFlipThisWayClause
 * Leaf must not import oracleIRParserEffectClauseToStep.ts or oracleIRParserSimpleActionClauses.ts.
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

function parseFlipCountWord(raw: string): number | null {
  const word = String(raw || '').trim().toLowerCase();
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  if (word in words) return words[word];
  const parsed = Number.parseInt(word, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function tryParseCoinFlipThisWayClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const clause = String(args.clause || '').replace(/[.]+$/g, '').trim();
  const rawClause = args.rawClause;
  const { withMeta } = args;
  if (!clause) return null;

  const chooseBetween = clause.match(/^choose a number between (\d+|one|two|three|four|five|six|seven|eight|nine|ten) and (\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/i);
  if (chooseBetween) {
    const min = parseFlipCountWord(String(chooseBetween[1] || ''));
    const max = parseFlipCountWord(String(chooseBetween[2] || ''));
    if (min !== null && max !== null && max >= min) {
      return withMeta({
        kind: 'choose_number',
        who: { kind: 'you' },
        min,
        max,
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  if (/^flip that many coins$/i.test(clause)) {
    return withMeta({
      kind: 'flip_coin',
      who: { kind: 'you' },
      count: 'that_many',
      raw: rawClause,
    } as OracleEffectStep);
  }

  if (/^for each flip you win,\s*draw a card$/i.test(clause)) {
    return withMeta({
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'flips you won this way' },
      raw: rawClause,
    } as OracleEffectStep);
  }

  const loseDamage = clause.match(
    /^for each flip you lose,\s*(.+?)\s+deals? (\d+) damage to you$/i,
  );
  if (loseDamage) {
    const perLoss = Number.parseInt(String(loseDamage[2] || '0'), 10);
    if (Number.isFinite(perLoss) && perLoss > 0) {
      return withMeta({
        kind: 'deal_damage',
        amount: { kind: 'reference_amount', raw: `${perLoss} for each flip you lost this way` },
        source: parseObjectSelector(String(loseDamage[1] || 'this creature').trim()),
        target: parseObjectSelector('you'),
        who: parsePlayerSelector('you'),
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  const wonThisWayCast = clause.match(
    /^if you won (five|\d+) flips this way,\s*you may cast (?:spells|nonland cards|cards) from your hand this turn without paying their mana costs?$/i,
  );
  if (wonThisWayCast) {
    return withMeta({
      kind: 'conditional',
      condition: { kind: 'if', raw: `you won ${String(wonThisWayCast[1] || 'five').trim()} flips this way` },
      steps: [{
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: ['you may cast spells from your hand without paying their mana costs'],
        duration: 'this_turn',
        raw: 'you may cast spells from your hand this turn without paying their mana costs',
      }],
      raw: rawClause,
    } as OracleEffectStep);
  }

  if (/^you may cast (?:spells|nonland cards|cards) from your hand this turn without paying their mana costs?$/i.test(clause)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: ['you may cast spells from your hand without paying their mana costs'],
      duration: 'this_turn',
      raw: rawClause,
    } as OracleEffectStep);
  }

  return null;
}
