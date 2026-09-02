/**
 * Origin parent: oracleIRParserZoneAndRemovalActions.ts
 * Cluster: “counter [target spell…] unless its controller pays {N}/{X}/for-each”
 *   plus destroy-unless-pays-life (Giant Albatross family).
 * Public: tryParseCounterUnlessPaysClause, parseUnlessPaysManaExpression
 * Leaf must not import oracleIRParserZoneAndRemovalActions.ts.
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

export interface ParsedUnlessPaysManaExpression {
  readonly mana: string;
  /** “1 for each card in your graveyard” / “2 plus 1 for each Faerie you control”. */
  readonly manaAmountRaw?: string;
  /** “your devotion to blue” from “{X}, where X is …”. */
  readonly whereX?: string;
  readonly forEachOpponentStackObjects?: boolean;
}

function stripTrailingReminder(text: string): string {
  return String(text || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/[.]+$/g, '')
    .trim();
}

/**
 * Quoted from mtg_data.db (is_token = 0):
 * Mana Leak / Metallic Rebuke: “pays {3}”
 * Circular Logic: “pays {1} for each card in your graveyard”
 * Concerted Defense: “pays {1} plus an additional {1} for each creature in your party”
 * Spell Stutter: “pays {2} plus an additional {1} for each Faerie you control”
 * Thassa's Rebuff: “pays {X}, where X is your devotion to blue”
 */
export function parseUnlessPaysManaExpression(payRaw: string): ParsedUnlessPaysManaExpression | null {
  const text = stripTrailingReminder(String(payRaw || ''));
  if (!text) return null;

  const whereX = text.match(/^(\{X\})\s*,?\s*where\s+x\s+is\s+(.+)$/i);
  if (whereX) {
    return { mana: '{X}', whereX: String(whereX[2] || '').trim() };
  }

  const plusAdditional = text.match(
    /^(\{[^}]+\})\s+plus\s+(?:an\s+)?additional\s+(\{[^}]+\})\s+for\s+each\s+(.+)$/i,
  );
  if (plusAdditional) {
    const baseToken = String(plusAdditional[1] || '').replace(/[{}]/g, '').trim();
    const extraToken = String(plusAdditional[2] || '').replace(/[{}]/g, '').trim();
    const eachPart = String(plusAdditional[3] || '').trim();
    if (!/^\d+$/.test(baseToken) || !/^\d+$/.test(extraToken) || !eachPart) return null;
    return {
      mana: String(plusAdditional[1] || '').trim(),
      manaAmountRaw: `${baseToken} plus ${extraToken} for each ${eachPart}`,
    };
  }

  const forEach = text.match(/^(\{[^}]+\})\s+for\s+each\s+(.+)$/i);
  if (forEach) {
    const unitToken = String(forEach[1] || '').replace(/[{}]/g, '').trim();
    const eachPart = String(forEach[2] || '').trim();
    if (!/^\d+$/.test(unitToken) || !eachPart) return null;
    return {
      mana: String(forEach[1] || '').trim(),
      manaAmountRaw: `${unitToken} for each ${eachPart}`,
    };
  }

  const simple = text.match(/^((?:\{[^}]+\})+)$/);
  if (simple) {
    return { mana: String(simple[1] || '').trim() };
  }

  return null;
}

function buildUnlessPaysManaStep(args: {
  readonly whoText: string;
  readonly payRaw: string;
  readonly counterTarget: string;
  readonly rawClause: string;
  readonly withMeta: WithMeta;
  readonly forEachOpponentStackObjects?: boolean;
  readonly forEachPermanentText?: string;
}): Extract<OracleEffectStep, { kind: 'unless_pays_mana' }> | null {
  const parsed = parseUnlessPaysManaExpression(args.payRaw);
  if (!parsed) return null;
  return args.withMeta({
    kind: 'unless_pays_mana',
    who: parsePlayerSelector(args.whoText),
    mana: parsed.mana,
    ...(parsed.manaAmountRaw ? { manaAmountRaw: parsed.manaAmountRaw } : {}),
    ...(parsed.whereX ? { whereX: parsed.whereX } : {}),
    ...(args.forEachOpponentStackObjects ? { forEachOpponentStackObjects: true } : {}),
    ...(args.forEachPermanentText ? { forEachPermanentText: args.forEachPermanentText } : {}),
    steps: [
      args.withMeta({
        kind: 'counter_spell',
        target: parseObjectSelector(args.counterTarget),
        raw: args.rawClause,
      }),
    ],
    raw: args.rawClause,
  });
}

export function tryParseCounterUnlessPaysClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = String(clause || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const mayPayOr = normalized.match(
    /^for\s+each\s+(?:of\s+)?(those creatures),\s+its\s+controller\s+may\s+pay\s+(\{[^}]+\})\s+or\s+(\{[^}]+\})\s*$/i,
  );
  if (mayPayOr) {
    const first = String(mayPayOr[2] || '').trim();
    const second = String(mayPayOr[3] || '').trim();
    if (!first || !second) return null;
    return withMeta({
      kind: 'unless_pays_mana',
      who: parsePlayerSelector('its controller'),
      mana: first,
      manaOptions: [first, second],
      forEachPermanentText: String(mayPayOr[1] || 'those creatures').trim(),
      steps: [],
      raw: rawClause,
    });
  }

  const preventCombatUnless = normalized.match(
    /^for\s+each\s+(.+?),\s+prevent\s+all\s+combat\s+damage\s+that\s+would\s+be\s+dealt\s+by\s+that\s+creature\s+this\s+turn\s+unless\s+its\s+controller\s+pays\s+(.+)$/i,
  );
  if (preventCombatUnless) {
    const parsedPay = parseUnlessPaysManaExpression(String(preventCombatUnless[2] || ''));
    if (!parsedPay) return null;
    return withMeta({
      kind: 'unless_pays_mana',
      who: parsePlayerSelector('its controller'),
      mana: parsedPay.mana,
      ...(parsedPay.manaAmountRaw ? { manaAmountRaw: parsedPay.manaAmountRaw } : {}),
      ...(parsedPay.whereX ? { whereX: parsedPay.whereX } : {}),
      forEachPermanentText: String(preventCombatUnless[1] || '').trim(),
      steps: [
        withMeta({
          kind: 'prevent_damage',
          amount: 'all',
          target: parseObjectSelector('that creature'),
          duration: 'this_turn',
          combatOnly: true,
          raw: rawClause,
        }),
      ],
      raw: rawClause,
    });
  }

  const destroyForEachUnlessLife = normalized.match(
    /^for\s+each\s+(.+?),\s+destroy\s+that\s+creature\s+unless\s+its\s+controller\s+pays\s+(\d+)\s+life$/i,
  );
  if (destroyForEachUnlessLife) {
    const amount = parseInt(String(destroyForEachUnlessLife[2] || '0'), 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return withMeta({
      kind: 'unless_pays_life',
      who: parsePlayerSelector('its controller'),
      amount,
      forEachPermanentText: String(destroyForEachUnlessLife[1] || '').trim(),
      steps: [
        withMeta({
          kind: 'destroy',
          target: parseObjectSelector('that creature'),
          raw: rawClause,
        }),
      ],
      raw: rawClause,
    });
  }

  const whirlwind = normalized.match(
    /^for\s+each\s+(spell and ability your opponents control),\s+counter\s+it\s+unless\s+its\s+controller\s+pays\s+(.+)$/i,
  );
  if (whirlwind) {
    return buildUnlessPaysManaStep({
      whoText: 'its controller',
      payRaw: String(whirlwind[2] || ''),
      counterTarget: String(whirlwind[1] || '').trim(),
      rawClause,
      withMeta,
      forEachOpponentStackObjects: true,
    });
  }

  const destroyUnlessLife = normalized.match(
    /^destroy\s+(.+?)\s+unless\s+(its\s+controller|that\s+player|they)\s+pays?\s+(\d+)\s+life$/i,
  );
  if (destroyUnlessLife) {
    const amount = parseInt(String(destroyUnlessLife[3] || '0'), 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return withMeta({
      kind: 'unless_pays_life',
      who: parsePlayerSelector(String(destroyUnlessLife[2] || '').trim()),
      amount,
      steps: [
        withMeta({
          kind: 'destroy',
          target: parseObjectSelector(String(destroyUnlessLife[1] || '').trim()),
          raw: rawClause,
        }),
      ],
      raw: rawClause,
    });
  }

  const counterUnlessPays = normalized.match(
    /^counter\s+(target\s+.+?|that\s+spell(?:\s+or\s+ability)?|that\s+ability|the\s+chosen\s+spell|it)\s+unless\s+its\s+controller\s+pays\s+(.+)$/i,
  );
  if (counterUnlessPays && /\b(?:spell|spells|ability|abilities)\b/i.test(String(counterUnlessPays[1] || ''))) {
    return buildUnlessPaysManaStep({
      whoText: 'its controller',
      payRaw: String(counterUnlessPays[2] || ''),
      counterTarget: String(counterUnlessPays[1] || '').trim(),
      rawClause,
      withMeta,
    });
  }

  return null;
}
