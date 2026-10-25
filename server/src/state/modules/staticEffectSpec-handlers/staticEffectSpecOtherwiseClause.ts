// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOtherwiseClause.ts
// Generic "Otherwise, <subject> gets +X/+Y [and has K] / has K" clauses that follow a conditional static
// ("As long as C, ~ gets +2/+2. Otherwise, ~ gets -1/-1." / Serra's Boon). The otherwise half is the same
// condition with conditionNegated: true, so any condition kind the evaluator understands can be negated.
// Public entry symbols: splitOtherwiseClause, parseOtherwiseGrant.

import type { StaticEffectGrant } from '../staticEffectSpecTypes.js';
import { parseAbilitiesFromTail } from './staticEffectSpecOracleParseHelpers.js';

/** Splits "<main>. otherwise, <rest>" into [main, rest]; rest is '' when there is no otherwise clause. */
export function splitOtherwiseClause(line: string): [string, string] {
  const m = String(line || '').match(/^(.*?)[.;]?\s*otherwise,\s*(.+?)\.?\s*$/);
  return m ? [m[1], m[2]] : [String(line || ''), ''];
}

/** subjectPattern: regex source for the clause subject ("it", "~", "enchanted creature", the card name...). */
export function parseOtherwiseGrant(rest: string, subjectPattern: string): StaticEffectGrant | null {
  const text = String(rest || '').trim().replace(/\.$/, '');
  if (!text) return null;
  const re = new RegExp('^(?:' + subjectPattern + '|it)\\s+(?:gets\\s+([+-]\\d+)\\/([+-]\\d+)(?:\\s+and\\s+(?:has|gains)\\s+(.+))?|(?:has|gains)\\s+(.+))$');
  const m = text.match(re);
  if (!m) return null;
  const power = Number(m[1] || 0);
  const toughness = Number(m[2] || 0);
  const tail = m[3] || m[4] || '';
  const abilities = tail ? parseAbilitiesFromTail(tail) : [];
  if (tail && abilities.length === 0) return null;
  if (!power && !toughness && abilities.length === 0) return null;
  return { ...(power || toughness ? { power, toughness } : {}), ...(abilities.length ? { abilities } : {}) };
}
