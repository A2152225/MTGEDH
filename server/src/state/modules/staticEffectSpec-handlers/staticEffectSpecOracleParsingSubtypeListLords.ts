// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingSubtypeListLords.ts
// Phase 5 step 1: subtype-list lords without "creatures" ("Treefolk you control have vigilance",
//   "Skeletons and Zombies you control get +1/+1 and have menace") and qualifier subsets
//   ("Attacking creatures you control get +1/+0", "Untapped creatures you control get +0/+2").
// Runs after the core parser; skips any clause the core already produced an equivalent spec for.
// Phase 5 finish: multi-word types ("Eldrazi Spawn"), non-creature-type words (snow, Spacecraft,
//   Nautilid), "creature tokens", permanents subjects, "you and permanents", source-counter counts
//   ("for each strife counter on this") and "as long as there are N or more X counters on this".
// Public entry symbols: pushSubtypeListLordSpecs.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpec.js';
import { isCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  parseLordCreatureType,
  type StaticEffectSpecSource,
  pushPlayerAbilityGrantsFromList,
} from './staticEffectSpecOracleParseHelpers.js';
import { parseStaticSelfCondition } from './staticEffectSpecOracleParsingConditionalSelfGrants.js';
import { parsePhase5LordCondition, preprocessPhase5LordClause } from './staticEffectSpecOracleParsingPhase5Conditions.js';

/** Self-relative condition phrases become source-relative for lords; target-relative ones are unsupported. */
function lordCondition(raw: string, sourceName: string): StaticEffectCondition | null {
  let text = String(raw || '').trim();
  const phase5 = parsePhase5LordCondition(text, sourceName);
  if (phase5) return phase5;
  if (/^you(?:'re| are) the monarch$/.test(text)) return { kind: 'source_controller_is_monarch' };
  const counters = text.match(/^there are (\w+) or more ([a-z+\/-]+) counters on (?:this [a-z]+|~|it)$/);
  if (counters) {
    const amount = NUMBER_WORDS[counters[1]] ?? Number(counters[1]);
    return Number.isFinite(amount) && amount > 0
      ? { kind: 'source_counter_at_least', counterType: counters[2], amount } : null;
  }
  const name = String(sourceName || '').toLowerCase();
  for (const alias of [name, name.split(',')[0]]) {
    if (alias && text.startsWith(alias + ' ')) { text = '~' + text.slice(alias.length); break; }
  }
  const parsed = parseStaticSelfCondition(text);
  if (!parsed) return null;
  if (parsed.kind === 'target_is_untapped') return { kind: 'source_is_untapped' };
  if (parsed.kind === 'target_is_attacking') return { kind: 'source_is_attacking' };
  if (parsed.kind === 'target_is_equipped') return { kind: 'source_is_equipped' };
  if (String(parsed.kind).startsWith('target_')) return null;
  return parsed;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Lord words that are not creature types; matched on the type line. */
const EXTRA_TYPE_WORDS: Record<string, string> = {
  snow: 'snow', land: 'land', spacecraft: 'spacecraft', nautilid: 'nautilid', nautilids: 'nautilid',
};

const QUALIFIER_CONDITIONS: Record<string, StaticEffectCondition> = {
  attacking: { kind: 'target_is_attacking' },
  untapped: { kind: 'target_is_untapped' },
  tapped: { kind: 'target_is_tapped' },
  equipped: { kind: 'target_is_equipped' },
  enchanted: { kind: 'target_enchanted_by_aura_you_control' },
  commander: { kind: 'target_is_commander' },
  legendary: { kind: 'target_is_legendary_creature' },
  nontoken: { kind: 'target_is_not_token' },
};

const CLAUSE_RE =
  /^(you and\s+)?(other\s+)?(?:(attacking|blocking|untapped|tapped|equipped|enchanted|commander|legendary|nontoken)\s+)?([a-z][a-z' ,/-]*?)\s+(you control\s+)?(?:get\s+([+-]\d+\s*\/\s*[+-]\d+)(?:\s+and\s+have\s+(.+))?|have\s+(.+))$/;

/** Temporary / triggered / activated / scaling wording the static parser must not claim. */
const REJECT_RE = /until end of|\bfor each\b|\bwhenever\b|\bwhen\b|\bat the beginning\b|\bgains?\b|\bthis turn\b|\bwhere x\b|\bperpetually\b|\{|:/;

type LordItem = { creatureType?: string; conditions: StaticEffectCondition[]; negation?: StaticEffectCondition };

function parseLordWord(word: string): { creatureType?: string; condition?: StaticEffectCondition } | null {
  if (EXTRA_TYPE_WORDS[word]) return { condition: { kind: 'target_has_type', cardType: EXTRA_TYPE_WORDS[word] } };
  const type = parseLordCreatureType(word);
  return type && isCreatureTypeWord(type) ? { creatureType: type } : null;
}

function splitTypeList(raw: string): LordItem[] | null {
  if (/^creature tokens?$/.test(raw)) {
    return null; // already covered by the token-lord parser (and class-level gating); avoid double application
  }
  const parts = raw.replace(/\s+creatures?$/, '').split(/\s*,\s*(?:and(?:\/or)?\s+)?|\s+and(?:\/or)?\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const items: LordItem[] = [];
  for (const part of parts) {
    const words = part.split(/\s+/);
    if (words.length > 2) return null;
    const item: LordItem = { conditions: [] };
    for (const word of words) {
      const parsed = parseLordWord(word);
      if (!parsed) return null;
      if (parsed.condition) item.conditions.push(parsed.condition);
      else if (!item.creatureType) item.creatureType = parsed.creatureType;
      else item.conditions.push({ kind: 'target_has_creature_type', creatureType: parsed.creatureType });
    }
    if (words.length === 1) {
      item.negation = item.creatureType
        ? { kind: 'target_lacks_creature_type', creatureType: item.creatureType }
        : { kind: 'target_lacks_type', cardType: (item.conditions[0] as any).cardType };
    }
    items.push(item);
  }
  return items;
}

function sameGrant(a: StaticEffectSpec, power: number | undefined, toughness: number | undefined, abilities: readonly string[]): boolean {
  const g = a.grant || {};
  if ((g.power ?? undefined) !== power || (g.toughness ?? undefined) !== toughness) return false;
  const have = new Set(g.abilities || []);
  return abilities.every((ab) => have.has(ab));
}

export function pushSubtypeListLordSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const clauses = String(oracle || '').toLowerCase().split(/[.\n]+/);
  for (let rawClause of clauses) {
    let clause = rawClause.trim().replace(/\([^)]*\)/g, '').trim();
    const label = (clause.match(/^([a-z' ]+) \u2014 /) || [])[1] || '';
    clause = clause.replace(/^[a-z' ]+ \u2014 /, '').trim();
    const extraConditions: StaticEffectCondition[] = [];
    const lead = clause.match(/^as long as ([^,]+),\s*(.+)$/);
    const trail = clause.match(/^(.+?)\s+as long as (.+)$/);
    if (lead || trail) {
      const condition = lordCondition(lead ? lead[1] : trail![2], source.sourceName);
      if (!condition) continue;
      extraConditions.push(condition);
      clause = (lead ? lead[2] : trail![1]).trim();
    }
    const rewrite = preprocessPhase5LordClause(clause, label.trim());
    clause = rewrite.clause;
    extraConditions.push(...rewrite.conditions);
    clause = clause.replace(/\bward \{\d+\}/g, (m) => m.replace(/[{}]/g, ''));
    let countCounterType = '';
    clause = clause.replace(/\s+for each ([a-z+\/-]+) counter on (?:this [a-z]+|~)$/, (_m, type) => {
      countCounterType = String(type);
      return '';
    });
    if (!clause || REJECT_RE.test(clause) || /\bas long as\b/.test(clause)) continue;
    const match = clause.match(CLAUSE_RE);
    if (!match) continue;
    const includesYou = Boolean(match[1]);
    const isOther = Boolean(match[2]);
    const qualifier = match[3] || '';
    const subject = String(match[4] || '').trim();
    const youControl = Boolean(match[5]);
    const buff = match[6] ? parseBuffSegment(match[6]) : null;
    const abilities = [...parseLordAbilitiesFromTail(match[7] || match[8] || ''), ...rewrite.extraAbilities];
    if (!buff && abilities.length === 0) continue;
    if (!youControl && (!qualifier || subject !== 'creatures' || includesYou)) continue;
    if ((countCounterType || rewrite.countBasis) && !buff) continue;
    const permanents = subject === 'permanents';
    if (permanents && (buff || !youControl)) continue;
    if (includesYou && !permanents) continue;
    let items: LordItem[] = [];
    if (subject !== 'creatures' && !permanents) {
      const parsed = splitTypeList(subject);
      if (!parsed) continue;
      items = parsed;
    } else if (!qualifier && extraConditions.length === 0 && !countCounterType && !includesYou) {
      continue; // plain "creatures/permanents you control" is owned by the core parser
    }
    const qualifierCondition = !qualifier ? undefined
      : permanents && qualifier === 'legendary' ? { kind: 'target_has_type', cardType: 'legendary' } as StaticEffectCondition
        : qualifier === 'blocking' ? undefined : QUALIFIER_CONDITIONS[qualifier];
    if (qualifier === 'blocking') continue; // no blocking-state condition kind yet
    const scopeKind = permanents
      ? (isOther ? 'other_permanents_you_control' : 'permanents_you_control')
      : !youControl ? (isOther ? 'other_all_creatures' : 'all_creatures')
        : (isOther ? 'other_creatures_you_control' : 'creatures_you_control');
    if (includesYou) pushPlayerAbilityGrantsFromList(specs, source, 'subtype-list-lord:you', abilities);
    const targets: (LordItem | undefined)[] = items.length > 0 ? items : [undefined];
    targets.forEach((item, index) => {
      const creatureType = item?.creatureType;
      const plain = !item || item.conditions.length === 0;
      const already = plain && !countCounterType && !rewrite.countBasis && specs.some((spec) => spec.scope?.kind === scopeKind
        && (spec.scope?.creatureType || undefined) === creatureType
        && sameGrant(spec, buff?.power, buff?.toughness, abilities));
      if (already) return;
      const conditions: StaticEffectCondition[] = [...extraConditions, ...(item?.conditions || []),
        ...items.slice(0, index).map((prior) => prior.negation).filter((c): c is StaticEffectCondition => Boolean(c))];
      const grant = buff ? { power: buff.power, toughness: buff.toughness, abilities } : { abilities };
      if (countCounterType) Object.assign(grant, { countBasis: 'source_counters', countCounterType });
      else if (rewrite.countBasis) Object.assign(grant, { countBasis: rewrite.countBasis });
      const spec = buildSpec(
        source,
        `subtype-list-lord:${qualifier || 'any'}:${creatureType || (permanents ? 'permanent' : 'creature')}:${index}`,
        creatureType ? { kind: scopeKind, creatureType } : { kind: scopeKind },
        grant,
        qualifierCondition,
      );
      if (conditions.length > 0) spec.conditions = conditions;
      specs.push(spec);
    });
    if (rewrite.alsoSelf) {
      const self = buildSpec(source, 'subtype-list-lord:self', { kind: 'self' }, buff ? { power: buff.power, toughness: buff.toughness, abilities } : { abilities });
      if (extraConditions.length > 0) self.conditions = [...extraConditions];
      specs.push(self);
    }
  }
}
