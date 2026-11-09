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
import { parseResourceDesignationCondition } from './staticEffectSpecResourceDesignationConditions.js';
import { parseExtraSelfCondition } from '../staticEffectSpecExtraConditions.js';
import { parseR35SelfCondition } from '../staticEffectSpecR35Conditions.js';
import { parseZoneCountCondition } from '../staticEffectSpecZoneCountConditions.js';
import { parseCommanderCondition } from '../staticEffectSpecCommanderCondition.js';
import { parseEntryLifeCondition } from '../staticEffectSpecEntryLifeConditions.js';
import { parseOtherwiseGrant, splitOtherwiseClause } from './staticEffectSpecOtherwiseClause.js';
import { parseCountersPutThisTurnCondition } from '../countersPutThisTurnCondition.js';

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
  const r35 = parseR35SelfCondition(c);
  if (r35) return r35;
  const resource = parseResourceDesignationCondition(c);
  if (resource) return resource;
  const zoneCount = parseZoneCountCondition(c);
  if (zoneCount) return zoneCount;
  if (/^it(?:'s| is) your turn$/.test(c)) return { kind: 'during_source_controller_turn' };
  if (/^seven or more cards are in your graveyard$/.test(c)) return { kind: 'source_controller_has_threshold' };
  const graveyardCount = c.match(/^(?:there are (\w+) or more cards in your graveyard|(\w+) or more cards are in your graveyard)$/);
  if (graveyardCount) {
    const amount = countWord(graveyardCount[1] || graveyardCount[2]);
    if (amount === undefined) return null;
    return amount === 7 ? { kind: 'source_controller_has_threshold' } : { kind: 'source_controller_graveyard_at_least', amount };
  }
  if (/^you have the city's blessing$/.test(c)) return { kind: 'source_controller_has_citys_blessing' };
  if (/^(?:it|this creature|~)(?:'s| is) attacking$/.test(c)) return { kind: 'target_is_attacking' };
  if (/^(?:it|this creature|~)(?:'s| is) untapped$/.test(c)) return { kind: 'target_is_untapped' };
  if (/^(?:it|this creature|~)(?:'s| is) tapped$/.test(c)) return { kind: 'target_is_tapped' };
  if (/^(?:it|this creature|~)(?:'s| is) equipped$/.test(c)) return { kind: 'target_is_equipped' };
  // B59: Freewind Equenaut - as long as this creature is enchanted.
  if (/^(?:it|this creature|~)(?:'s| is) enchanted$/.test(c)) return { kind: 'target_is_enchanted' };
  const life = c.match(/^you have (\w+) or more life$/);
  if (life) {
    const amount = countWord(life[1]);
    return amount === undefined ? null : { kind: 'source_controller_life_at_least', amount };
  }
  const counter = c.match(/^(?:it|this creature|~) has (?:a|an|one or more) ([+\-\d/a-z ]+?) counters? on it$/);
  if (counter) return { kind: 'target_has_counter', counterType: counter[1].trim() };
  const commander = parseCommanderCondition(c);
  if (commander) return commander as StaticEffectCondition;
  const entryLife = parseEntryLifeCondition(c);
  if (entryLife) return entryLife as StaticEffectCondition;
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
  // B62: Beast / Erudite Aerialist ? "you've put one or more +1/+1 counters on ~ this turn"
  {
    const counters = parseCountersPutThisTurnCondition(c);
    if (counters) return counters;
  }
  // B62: Earth Rumble Wrestlers
  if (/^you control an? land creature or an? land entered(?: the battlefield)? under your control this turn$/.test(c)) {
    return { kind: 'controller_land_creature_or_land_entered_this_turn' } as StaticEffectCondition;
  }
  // B67: Omenport Vigilante / Slickshot Vault-Buster
  if (/^you(?:'ve| have) committed a crime this turn$/.test(c)) {
    return { kind: 'source_controller_committed_crime_this_turn' } as StaticEffectCondition;
  }
  // B67: War Historian
  if (/^(?:it|this creature|~) attacked a battle this turn$/.test(c)) {
    return { kind: 'target_attacked_battle_this_turn' } as StaticEffectCondition;
  }
  // B75: Technodrome — "its power is 6 or greater"
  {
    const powerAtLeast = c.match(/^(?:its |this creature's |~'s )?power is (\w+) or greater$/);
    if (powerAtLeast) {
      const amount = countWord(powerAtLeast[1]);
      if (amount !== undefined) return { kind: 'target_power_at_least', power: amount } as StaticEffectCondition;
    }
  }
  // B76: Chillerpillar — "this creature is monstrous"
  if (/^(?:it|this creature|~) is monstrous$/.test(c)) {
    return { kind: 'target_is_monstrous' } as StaticEffectCondition;
  }
  // B76: Flutterfox — "you control an artifact or enchantment"
  if (/^you control an? artifact or (?:an? )?enchantment$/.test(c)
    || /^you control an? enchantment or (?:an? )?artifact$/.test(c)) {
    return { kind: 'source_controller_controls_artifact_or_enchantment' } as StaticEffectCondition;
  }
  // B76: Hungry Ridgewolf — "you control another Wolf or Werewolf"
  {
    const orTypes = c.match(/^you control (another )?([a-z]+) or ([a-z]+)$/);
    if (orTypes) {
      return {
        kind: 'source_controller_controls_creature_type_any',
        creatureTypes: [orTypes[2], orTypes[3]],
        other: Boolean(orTypes[1]),
        count: 1,
      } as StaticEffectCondition;
    }
  }
  // B76: Goblin Blast-Runner — "you sacrificed a permanent this turn"
  if (/^you sacrificed (?:a|one or more) permanents? this turn$/.test(c)) {
    return { kind: 'source_controller_sacrificed_permanent_this_turn' } as StaticEffectCondition;
  }
  // B76: Homarid — "there is exactly one tide counter on this creature"
  {
    const exact = c.match(/^there (?:is|are) exactly (\w+) ([a-z0-9+/ -]+?) counters? on (?:this creature|~|it)$/);
    if (exact) {
      const amount = countWord(exact[1]);
      if (amount !== undefined) {
        return {
          kind: 'source_counter_exactly',
          amount,
          counterType: String(exact[2] || '').trim(),
        } as StaticEffectCondition;
      }
    }
  }
  // B69: Blood Baron — compound life thresholds (AND via conditions[] on the caller)
  {
    const lifeAndOpp = c.match(/^you have (\w+) or more life and an opponent has (\w+) or less life$/);
    if (lifeAndOpp) {
      const yours = countWord(lifeAndOpp[1]);
      const opp = countWord(lifeAndOpp[2]);
      if (yours !== undefined && opp !== undefined) {
        return {
          kind: 'source_controller_life_at_least',
          amount: yours,
          // Stash opponent threshold for pushConditionalSelfGrantSpecs to expand into conditions[].
          _andOpponentLifeAtMost: opp,
        } as any;
      }
    }
  }
  return parseExtraSelfCondition(c);
}

function selfSubject(sourceName: string): string {
  const name = String(sourceName || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const short = name.split(',')[0];
  // Legendary short names: "Svyelun" for Svyelun of Sea and Sky (first word of the name).
  const first = short.split(/\s+/)[0];
  const firstAlt = first && first.length >= 3 && first !== short ? `|${first}` : '';
  return `(?:this creature|this permanent|~|it|he|she${name ? `|${name}` : ''}${short && short !== name ? `|${short}` : ''}${firstAlt})`;
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
    // B58: ability words may include digits/hyphens (Descend 4); 'an additional' PT (Akawalli).
    String.raw`^\s*(?:[a-z'0-9 -]+\s*(?:\u2014|--|-)\s*)?(?:as long as ([^,]+)|(during your turn)),\s*${subject}\s+(?:gets\s+(?:an additional\s+)?([+-]\d+)\/([+-]\d+)(?:\s+and\s+(?:(?:has|gains)\s+)?([^.]+))?|(?:has|gains)\s+("[^"]*"|[^.]+))`,
  );
  const trailing = new RegExp(
    String.raw`(?:^|[.]\s*|\u2014\s*)${subject}\s+(?:gets\s+(?:an additional\s+)?([+-]\d+)\/([+-]\d+)(?:\s+and\s+(?:(?:has|gains)\s+)?(.+?))?|has\s+("[^"]*"|.+?))\s+as long as ([^.]+)`,
  );
  let index = 0;
  for (const fullLine of lines) {
    const [line, otherwiseText] = splitOtherwiseClause(fullLine);
    if (/^\s*(?:when|whenever|at the beginning)\b/.test(line) || line.replace(/"[^"]*"/g, '').includes(':')) continue;
    let conditionText = '';
    let power = 0;
    let toughness = 0;
    let abilityTail = '';
    const lead = line.match(leading);
    if (lead) {
      // "During your turn, ~ has first strike" reads as "as long as it's your turn".
      conditionText = lead[2] ? "it's your turn" : lead[1];
      power = Number(lead[3] || 0);
      toughness = Number(lead[4] || 0);
      abilityTail = lead[5] || lead[6] || '';
    } else {
      const trail = line.match(trailing);
      if (!trail) continue;
      power = Number(trail[1] || 0);
      toughness = Number(trail[2] || 0);
      abilityTail = trail[3] || trail[4] || '';
      conditionText = trail[5];
    }
    const condition = parseStaticSelfCondition(conditionText);
    if (!condition) continue;
    const abilities = parseAbilitiesFromTail(abilityTail);
    // B58: Akawalli Descend 8 block-cap rider (not a keyword word).
    if (/can(?:not|'t) be blocked by more than one creature/i.test(abilityTail)
      && !abilities.includes("can't be blocked by more than one creature")) {
      abilities.push("can't be blocked by more than one creature");
    }
    if (abilities.length === 0 && power === 0 && toughness === 0) continue;
    const andOppLife = Number((condition as any)._andOpponentLifeAtMost);
    if (Number.isFinite(andOppLife)) delete (condition as any)._andOpponentLifeAtMost;
    const spec = buildSpec(
      source,
      `conditional-self-grant-${index++}`,
      { kind: 'self' },
      {
        ...(power || toughness ? { power, toughness } : {}),
        ...(abilities.length > 0 ? { abilities } : {}),
      },
      condition,
    );
    // B69: Blood Baron — "you have N+ life and an opponent has M or less life"
    if (Number.isFinite(andOppLife)) {
      spec.conditions = [{ kind: 'opponent_life_at_most', amount: andOppLife } as StaticEffectCondition];
    }
    specs.push(spec);
    const otherwise = otherwiseText ? parseOtherwiseGrant(otherwiseText, subject) : null;
    if (otherwise) {
      const other = { ...buildSpec(source, `conditional-self-grant-otherwise-${index++}`, { kind: 'self' }, otherwise, condition), conditionNegated: true };
      if (Number.isFinite(andOppLife)) {
        (other as any).conditions = [{ kind: 'opponent_life_at_most', amount: andOppLife }];
      }
      specs.push(other);
    }
  }
}
