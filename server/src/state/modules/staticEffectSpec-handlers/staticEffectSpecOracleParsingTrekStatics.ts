// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingTrekStatics.ts
// Star Trek (trk/trc) self statics:
//   Cloaking Device (Romulan Bird-of-Prey): "As long as this Spacecraft isn't a creature, it has hexproof."
//   (generic: "as long as this <noun>/~/it isn't a creature, it has <keywords>"; a stationed Spacecraft that is a
//   creature is detected by the target_lacks_type station check).
//   R32: "During your turn, (this Spacecraft and) <group> you control have X" (Hemmer, K'Vort);
//   "(Other) historic creatures you control have X" (On the Shoulders of Giants);
//   "All <type>s get +N/+N and are goaded" (Koloth; the goad half is collectStaticGoadSources).
// Public entry symbols: pushTrekSelfStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpec.js';
import { buildSpec, parseAbilitiesFromTail, parseLordCreatureType, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const NOT_CREATURE_GRANT = /\bas long as (?:this (?:spacecraft|planet|artifact|permanent|vehicle)|~|it) isn't a creature, (?:it|~|this \w+) has ([^.]+)/;

export function pushTrekSelfStaticSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  let index = 0;
  for (const line of String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/)) {
    const m = line.match(NOT_CREATURE_GRANT);
    if (!m) continue;
    const abilities = parseAbilitiesFromTail(m[1]);
    if (abilities.length === 0) continue;
    specs.push(buildSpec(source, `not-creature-self-grant-${index++}`, { kind: 'self' } as any, { abilities }, { kind: 'target_lacks_type', cardType: 'creature' } as any));
  }
  pushTrekGroupStaticSpecs(specs, source, oracle);
}

const YOUR_TURN_GROUP = /^during your turn, (?:(this \w+|~) and )?(other )?([a-z]+) you control (?:have|has) ([^."]+)$/;
const HISTORIC_GROUP = /^(other )?historic creatures you control (?:have|has) ([^."]+)$/;
const TYPE_GOAD_PT = /^all ([a-z]+) get ([+-]\d+)\/([+-]\d+) and are goaded$/;

function pushTrekGroupStaticSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const lines = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/);
  lines.forEach((raw, index) => {
    const line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    let m = line.match(YOUR_TURN_GROUP);
    if (m) {
      const abilities = parseAbilitiesFromTail(m[4]);
      if (abilities.length === 0) return;
      const yourTurn = { kind: 'during_source_controller_turn' } as any;
      if (m[1]) specs.push(buildSpec(source, 'trek-your-turn-self:' + index, { kind: 'self' } as any, { abilities }, yourTurn));
      const group = m[3];
      if (group === 'creatures') {
        specs.push(buildSpec(source, 'trek-your-turn-group:' + index, { kind: m[2] ? 'other_creatures_you_control' : 'creatures_you_control' } as any, { abilities }, yourTurn));
      } else {
        const spec: any = buildSpec(source, 'trek-your-turn-group:' + index, { kind: 'permanents_you_control' } as any, { abilities }, yourTurn);
        const typeWord = /(?:ss|craft)$/.test(group) ? group : group.replace(/s$/, '');
        spec.conditions = [{ kind: 'target_has_type', cardType: typeWord }];
        specs.push(spec);
      }
      return;
    }
    m = line.match(HISTORIC_GROUP);
    if (m) {
      const abilities = parseAbilitiesFromTail(m[2]);
      if (abilities.length === 0) return;
      specs.push(buildSpec(source, 'trek-historic-group:' + index, { kind: m[1] ? 'other_creatures_you_control' : 'creatures_you_control' } as any, { abilities }, { kind: 'target_is_historic' } as any));
      return;
    }
    m = line.match(TYPE_GOAD_PT);
    if (m) {
      const creatureType = parseLordCreatureType(m[1]);
      if (!creatureType) return;
      specs.push(buildSpec(source, 'trek-type-goad-pt:' + index, { kind: 'all_creatures_of_type', creatureType } as any, { power: Number(m[2]), toughness: Number(m[3]) } as any));
    }
  });
}

