/**
 * Origin parent: oracleIRParserEffectClauseToStep.ts
 * Cluster: leading until-EOT activated lose / as-though hexproof-shroud
 *   (Detection Tower / Arcane Lighthouse). Continuous statics stay
 *   StaticEffectSpec. Not a card-name route.
 * Public: tryParseUntilEotProtectionOverrideClause
 * Leaf must not import oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep.js';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const MARKER = 'until-eot-protection-override';
const PROTECTION_KEYWORDS = ['hexproof', 'shroud'] as const;

const ACTIVATED_COST_PREFIX =
  /^(?:(?:\{[^}]+\}|\{T\})\s*,\s*)*(?:\{[^}]+\}|\{T\})\s*:\s*(.+)$/i;

function stripActivatedCostPrefix(clause: string): string {
  const match = String(clause || '').trim().match(ACTIVATED_COST_PREFIX);
  return match ? String(match[1] || '').trim() : String(clause || '').trim();
}

function parseProtectionKeywords(text: string): string[] {
  const found: string[] = [];
  const lower = String(text || '').toLowerCase();
  for (const keyword of PROTECTION_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(lower) && !found.includes(keyword)) {
      found.push(keyword);
    }
  }
  return found;
}

function hasUntilEotWindow(body: string): boolean {
  return /^until\s+end\s+of\s+turn\b/i.test(body)
    || /\buntil\s+end\s+of\s+turn\.?$/i.test(body);
}

function stripUntilEotWindow(body: string): string {
  return String(body || '')
    .replace(/^until\s+end\s+of\s+turn,?\s*/i, '')
    .replace(/\s+until\s+end\s+of\s+turn\.?$/i, '')
    .replace(/[.]+$/g, '')
    .trim();
}

export function tryParseUntilEotProtectionOverrideClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): Extract<OracleEffectStep, { kind: 'grant_static_ability' }> | null {
  const { rawClause, withMeta } = args;
  const clause = normalizeOracleText(String(args.clause || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
  if (!clause) return null;

  const body = stripActivatedCostPrefix(clause);
  if (!hasUntilEotWindow(body)) return null;

  const stripped = stripUntilEotWindow(body);
  if (!stripped) return null;

  const asThough = stripped.match(
    /^(your opponents and )?((?:creatures|permanents) your opponents control)(?: with [^.]+?)? can be the targets? of spells and abilities( you control)? as though they didn'?t have (.+)$/i,
  );
  if (asThough) {
    const abilities = parseProtectionKeywords(String(asThough[4] || ''));
    if (abilities.length === 0) return null;
    const subjectKind = String(asThough[2] || '').toLowerCase().startsWith('permanents')
      ? 'opponent_permanents'
      : 'opponent_creatures';
    const mode = asThough[3] ? 'asThoughController' : 'asThoughAll';
    const effectText = [
      MARKER,
      mode,
      `scope:${subjectKind}`,
      ...(asThough[1] ? ['scope:player_opponents'] : []),
      ...abilities.map((ability) => `ability:${ability}`),
    ];
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(asThough[2] || 'creatures your opponents control')),
      effectText,
      duration: 'end_of_turn',
      raw: rawClause,
    });
  }

  const lose = stripped.match(
    /^((?:creatures|permanents) your opponents control) lose (.+)$/i,
  );
  if (lose) {
    const abilities = parseProtectionKeywords(String(lose[2] || ''));
    if (abilities.length === 0) return null;
    const subjectKind = String(lose[1] || '').toLowerCase().startsWith('permanents')
      ? 'opponent_permanents'
      : 'opponent_creatures';
    const effectText = [
      MARKER,
      'remove',
      `scope:${subjectKind}`,
      ...abilities.map((ability) => `ability:${ability}`),
    ];
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(lose[1] || 'creatures your opponents control')),
      effectText,
      duration: 'end_of_turn',
      raw: rawClause,
    });
  }

  return null;
}
