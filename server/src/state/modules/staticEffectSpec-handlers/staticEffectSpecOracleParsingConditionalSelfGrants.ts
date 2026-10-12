// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingConditionalSelfGrants.ts
// Conditional self statics: "As long as <condition>, this creature gets +X/+Y and has <keywords>"
// and "<this creature> has <keywords> as long as <condition>". The condition is evaluated by the
// shared static-condition evaluator against current state; an unrecognized condition yields no
// spec (never "always on").
// Public entry symbols: pushConditionalSelfGrantSpecs, parseStaticSelfCondition.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpec.js';
import {
  buildSpec,
  parseAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const CARD_TYPES = ['artifact', 'enchantment', 'creature', 'land', 'planeswalker', 'legendary creature', 'equipment', 'aura', 'token'];

function countWord(word: string): number | undefined {
  const w = String(word || '').toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return COUNT_WORDS[w];
}

function singular(noun: string): string {
  const n = String(noun || '').toLowerCase().trim();
  if (n === 'elves') return 'elf';
  if (n.endsWith('ves')) return `${n.slice(0, -3)}f`;
  if (n.endsWith('ies')) return `${n.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x)es$/.test(n)) return n.slice(0, -2);
  if (n.endsWith('s') && !n.endsWith('ss')) return n.slice(0, -1);
  return n;
}

/** Map a condition phrase (text after "as long as") to an evaluable static condition. */
export function parseStaticSelfCondition(raw: string): StaticEffectCondition | null {
  const c = String(raw || '').toLowerCase().replace(/\u2019/g, "'").trim().replace(/[.,]+$/, '');
  if (/^it(?:'s| is) your turn$/.test(c)) return { kind: 'during_source_controller_turn' };
  if (/^seven or more cards are in your graveyard$/.test(c)) return { kind: 'source_controller_has_threshold' };
  if (/^you have the city's blessing$/.test(c)) return { kind: 'source_controller_has_citys_blessing' };
  if (/^(?:it|this creature|~)(?:'s| is) attacking$/.test(c)) return { kind: 'target_is_attacking' };
  if (/^(?:it|this creature|~)(?:'s| is) untapped$/.test(c)) return { kind: 'target_is_untapped' };
  if (/^(?:it|this creature|~)(?:'s| is) tapped$/.test(c)) return { kind: 'target_is_tapped' };
  if (/^(?:it|this creature|~)(?:'s| is) equipped$/.test(c)) return { kind: 'target_is_equipped' };
  const life = c.match(/^you have (\w+) or more life$/);
  if (life) {
    const amount = countWord(life[1]);
    return amount === undefined ? null : { kind: 'source_controller_life_at_least', amount };
  }
  const counter = c.match(/^(?:it|this creature|~) has (?:a|an|one or more) ([+\-\d/a-z ]+?) counters? on it$/);
  if (counter) return { kind: 'target_has_counter', counterType: counter[1].trim() };
  const control = c.match(/^you control (?:(a|an|another)|(?:at least )?(\w+)(?: or more)?)( other)? ([a-z' -]+?)$/);
  if (control) {
    const other = control[1] === 'another' || Boolean(control[3]);
    const count = control[1] ? 1 : countWord(control[2] || '');
    if (count === undefined) return null;
    const noun = control[4].replace(/\s+(?:creatures?|permanents?)$/, (m) => m).trim();
    const typePart = noun.replace(/\s+(?:creatures?|permanents?)$/, '').trim();
    const isCreatureSuffix = /\bcreatures?$/.test(noun);
    const single = singular(typePart);
    if (CARD_TYPES.includes(single) || CARD_TYPES.includes(singular(noun))) {
      return { kind: 'source_controller_controls_matching', cardType: CARD_TYPES.includes(single) ? single : singular(noun), count, other };
    }
    if (/^[a-z-]+$/.test(single)) {
      return { kind: 'source_controller_controls_matching', creatureType: single, count, other, creaturesOnly: isCreatureSuffix };
    }
  }
  return null;
}

function selfSubject(sourceName: string): string {
  const name = String(sourceName || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const short = name.split(',')[0];
  return `(?:this creature|this permanent|~|it${name ? `|${name}` : ''}${short && short !== name ? `|${short}` : ''})`;
}

/** Push self-scoped specs for conditional "has X" / "gets +X/+Y" statics. */
export function pushConditionalSelfGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const subject = selfSubject(source.sourceName);
  const lines = String(oracle || '').toLowerCase().split(/\n+/);
  const leading = new RegExp(
    String.raw`^\s*(?:[a-z' ]+\s*(?:\u2014|--|-)\s*)?as long as ([^,]+),\s*${subject}\s+(?:gets\s+([+-]\d+)\/([+-]\d+)(?:\s+and\s+(?:has|gains)\s+([^.]+))?|(?:has|gains)\s+([^.]+))`,
  );
  const trailing = new RegExp(
    String.raw`(?:^|[.]\s*)${subject}\s+(?:gets\s+([+-]\d+)\/([+-]\d+)\s+and\s+)?has\s+(.+?)\s+as long as ([^.]+)`,
  );
  let index = 0;
  for (const line of lines) {
    if (/^\s*(?:when|whenever|at the beginning)\b/.test(line) || line.replace(/"[^"]*"/g, '').includes(':')) continue;
    let conditionText = '';
    let power = 0;
    let toughness = 0;
    let abilityTail = '';
    const lead = line.match(leading);
    if (lead) {
      conditionText = lead[1];
      power = Number(lead[2] || 0);
      toughness = Number(lead[3] || 0);
      abilityTail = lead[4] || lead[5] || '';
    } else {
      const trail = line.match(trailing);
      if (!trail) continue;
      // Svyelun-style "has indestructible as long as you control at least two other Merfolk" is
      // owned by the legacy static path; this handler covers the generic shapes it doesn't.
      if (/as long as you control at least \w+ other/.test(line) && /has indestructible/.test(line)) continue;
      if (/unspent mana/.test(line)) continue;
      power = Number(trail[1] || 0);
      toughness = Number(trail[2] || 0);
      abilityTail = trail[3] || '';
      conditionText = trail[4];
    }
    const condition = parseStaticSelfCondition(conditionText);
    if (!condition) continue;
    const abilities = parseAbilitiesFromTail(abilityTail);
    if (abilities.length === 0 && power === 0 && toughness === 0) continue;
    specs.push(buildSpec(
      source,
      `conditional-self-grant-${index++}`,
      { kind: 'self' },
      {
        ...(power || toughness ? { power, toughness } : {}),
        ...(abilities.length > 0 ? { abilities } : {}),
      },
      condition,
    ));
  }
}
