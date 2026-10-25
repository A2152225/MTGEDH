// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingPhase5Conditions.ts
// Phase 5 (round 3): condition phrases and clause rewrites for the last regex-only statics:
// "this turn" tracking (life gained, attacked with N <type>, nonland permanents entered), delirium,
// top card colour, equipped-creature tapped state, exactly-N-named, commander casts count, Solved,
// face-down / colour qualifiers, "this creature and <X> creatures", Goddric-style conditional self "becomes".
// Public entry symbols: parsePhase5LordCondition, preprocessPhase5LordClause, pushConditionalSelfBecomesSpecs.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpec.js';
import { buildSpec, parseLordAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const NUM: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string): number | undefined => NUM[w] ?? (Number.isFinite(Number(w)) ? Number(w) : undefined);
const singular = (w: string): string => w.replace(/(?:ves)$/, 'f').replace(/ies$/, 'y').replace(/(?<!s)s$/, '');

/** Condition phrases owned by Phase 5 round 3. Returns null when the phrase is not one of them. */
export function parsePhase5LordCondition(raw: string, sourceName: string): StaticEffectCondition | null {
  const text = String(raw || '').trim().replace(/\u2019/g, "'");
  const c = (o: Record<string, unknown>) => o as unknown as StaticEffectCondition;
  if (/^you(?:'ve)? gained life this turn$/.test(text)) return c({ kind: 'controller_gained_life_this_turn' });
  let m = text.match(/^you attacked with (\w+) or more ([a-z]+) this turn$/);
  if (m && num(m[1])) return c({ kind: 'controller_attacked_with_at_least', count: num(m[1]), creatureType: singular(m[2]) });
  m = text.match(/^(\w+) or more nonland permanents entered(?: the battlefield)? under your control this turn$/);
  if (m && num(m[1])) return c({ kind: 'controller_nonland_entered_at_least', count: num(m[1]) });
  m = text.match(/^there are (\w+) or more card types among cards in your graveyard$/);
  if (m && num(m[1])) return c({ kind: 'controller_graveyard_card_types_at_least', count: num(m[1]) });
  m = text.match(/^the top card of your library is (white|blue|black|red|green)$/);
  if (m) return c({ kind: 'controller_library_top_is_color', color: m[1] });
  m = text.match(/^equipped creature is (tapped|untapped)$/);
  if (m) return c({ kind: m[1] === 'tapped' ? 'source_attached_is_tapped' : 'source_attached_is_untapped' });
  m = text.match(/^you control exactly (\w+) permanents named (.+)$/);
  if (m && num(m[1])) {
    const name = m[2] === '~' ? String(sourceName || '').toLowerCase() : m[2];
    return c({ kind: 'controller_controls_named_exactly', count: num(m[1]), option: name });
  }
  return null;
}

export type Phase5ClauseRewrite = {
  clause: string;
  conditions: StaticEffectCondition[];
  alsoSelf: boolean;
  extraAbilities: string[];
  countBasis?: string;
};

/** Rewrites one clause (label already split off) into a shape the subtype-list lord matcher understands. */
export function preprocessPhase5LordClause(clause: string, label: string): Phase5ClauseRewrite {
  const out: Phase5ClauseRewrite = { clause, conditions: [], alsoSelf: false, extraAbilities: [] };
  if (label === 'solved') out.conditions.push({ kind: 'source_is_solved' } as unknown as StaticEffectCondition);
  out.clause = out.clause
    .replace(/^the .legend rule. doesn't apply to them,? and\s+/, '')
    .replace(/^face-down creatures\b/, (s) => { out.conditions.push({ kind: 'target_is_face_down' } as unknown as StaticEffectCondition); return 'creatures'; })
    .replace(/^(white|blue|black|red|green) creatures\b/, (_s, color) => {
      out.conditions.push({ kind: 'target_has_mana_color', color } as unknown as StaticEffectCondition); return 'creatures';
    })
    .replace(/^(?:this creature|~) and\s+/, () => { out.alsoSelf = true; return ''; })
    .replace(/\s+and can't be blocked by creatures with (defender|flying|reach)$/, (_s, kw) => {
      out.extraAbilities.push(`can't be blocked by creatures with ${kw}`); return '';
    })
    .replace(/\s+for each time you've cast your commander from the command zone this game$/, () => {
      out.countBasis = 'controller_commander_casts'; return '';
    });
  return out;
}

/** "As long as <cond>, ~ is a <Type> with base power and toughness N/M[, kw][, and "..."]" (Goddric). */
export function pushConditionalSelfBecomesSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
  conditionOf: (raw: string) => StaticEffectCondition | null,
): void {
  const name = String(source.sourceName || '').toLowerCase();
  const short = name.split(',')[0];
  for (const line of String(oracle || '').split('\n')) {
    const body = line.replace(/\([^)]*\)/g, '').replace(/^[a-z' ]+ \u2014 /, '').trim();
    const m = body.match(/^as long as ([^,]+),\s*(?:~|this creature|[a-z' ,-]+?) is an? ([a-z]+) with base power and toughness (\d+)\/(\d+)(.*)$/);
    if (!m) continue;
    const head = body.slice(body.indexOf(',') + 1).trim();
    if (!(head.startsWith('~') || head.startsWith('this creature') || head.startsWith(short) || head.startsWith(name))) continue;
    const condition = conditionOf(m[1]);
    if (!condition) continue;
    const typeWord = m[2].charAt(0).toUpperCase() + m[2].slice(1);
    const tail = m[5].replace(/"[^"]*"/g, '').replace(/^[,\s]+|[.,\s]+$/g, '').replace(/,?\s*and\s*$/, '');
    // Quoted abilities (Goddric's "{R}: Dragons you control get +1/+0 ...") are granted verbatim.
    const quoted = [...m[5].matchAll(/"([^"]+)"/g)].map((q) => q[1].trim()).filter(Boolean);
    const abilities = [...(tail ? parseLordAbilitiesFromTail(tail) : []), ...quoted];
    const id = `conditional-self-becomes:${m[2]}`;
    if (specs.some((s) => String(s.id).endsWith(id))) continue;
    const push = (suffix: string, grant: StaticEffectSpec['grant']) => {
      const spec = buildSpec(source, `${id}:${suffix}`, { kind: 'self' }, grant);
      spec.conditions = [condition];
      specs.push(spec);
    };
    push('pt', { setPower: Number(m[3]), setToughness: Number(m[4]) });
    push('type', { typeAdditions: [typeWord], loseOtherCreatureTypes: true });
    if (abilities.length > 0) push('abilities', { abilities });
  }
}
