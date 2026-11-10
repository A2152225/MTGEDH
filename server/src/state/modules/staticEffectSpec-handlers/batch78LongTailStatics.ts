// server/src/state/modules/staticEffectSpec-handlers/batch78LongTailStatics.ts
// B78 static long-tail:
//   Hexgold Hoverwings — equipped creatures you control get ±N/±N
//   Bloodfire Enforcers — keywords while GY has an instant and a sorcery
//   Fire Nation Cadets — firebending while a Lesson is in GY
//   Leapfrog — flying after casting an instant/sorcery this turn
//   Swimmer in Nightmares — pump while any GY has N+ cards
//   Warden of the Wall — animate on opponents' turns
//   Arcus Acolyte — other creatures without +1/+1 have outlast
// Public: pushBatch78LongTailStaticSpecs.
// Sibling: Mirri tapped attack-you cap, Steal Enchantment control, Prowler's Helm except-Walls,
//   Brothers Yamazaki exact-name legend exemption, Storm Cauldron classifier.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const COUNT_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function countWord(raw: string): number | undefined {
  const w = String(raw || '').toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return COUNT_WORDS[w];
}

function pushEquippedCreaturesAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /creatures you control that are equipped get ([+-]\d+\s*\/\s*[+-]\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'equipped-creatures-anthem',
    { kind: 'creatures_you_control' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_is_equipped' } as StaticEffectCondition,
  ));
}

function pushInstantAndSorceryGyKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) has ([^.]+?) as long as an? instant cards? and an? sorcery cards? (?:are|is) in your graveyard/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  const spec = buildSpec(
    source,
    'instant-and-sorcery-gy-keywords',
    { kind: 'self' },
    { abilities },
  );
  spec.conditions = [
    { kind: 'controller_graveyard_type_at_least', cardType: 'instant', amount: 1 } as StaticEffectCondition,
    { kind: 'controller_graveyard_type_at_least', cardType: 'sorcery', amount: 1 } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushLessonGyKeyword(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) has (firebending \d+|[\w ]+?) as long as there'?s an? lesson cards? in your graveyard/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (/^firebending \d+$/.test(String(m[1] || '').trim()) && !abilities.length) {
    abilities.push(String(m[1]).trim());
  }
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'lesson-gy-keyword',
    { kind: 'self' },
    { abilities },
    { kind: 'controller_graveyard_type_at_least', cardType: 'lesson', amount: 1 } as StaticEffectCondition,
  ));
}

function pushCastInstantSorcerySelfKeyword(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) has ([^.]+?) as long as you(?:'ve| have) cast an? instant or sorcery spells? this turn/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'cast-instant-sorcery-self-keyword',
    { kind: 'self' },
    { abilities },
    { kind: 'controller_instant_or_sorcery_cast_this_turn' } as StaticEffectCondition,
  ));
}

function pushAnyGraveyardSizePump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) gets ([+-]\d+\s*\/\s*[+-]\d+) as long as there are (\w+) or more cards in a single graveyard/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  const amount = countWord(m[2]);
  if (!buff || amount === undefined) return;
  specs.push(buildSpec(
    source,
    'any-gy-size-pump',
    { kind: 'self' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'any_graveyard_at_least', amount, count: amount } as StaticEffectCondition,
  ));
}

function pushOffTurnSelfAnimate(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /during turns other than yours, (?:this artifact|this permanent|~|it) is an? (\d+)\s*\/\s*(\d+) ([a-z]+) artifact creature with ([^.]+)/,
  );
  if (!m) return;
  const setPower = Number(m[1]);
  const setToughness = Number(m[2]);
  const creatureType = m[3].charAt(0).toUpperCase() + m[3].slice(1);
  const abilities = parseLordAbilitiesFromTail(m[4] || '');
  if (!Number.isFinite(setPower) || !Number.isFinite(setToughness)) return;
  const cond: StaticEffectCondition = { kind: 'not_during_source_controller_turn' } as StaticEffectCondition;
  specs.push({
    ...buildSpec(source, 'off-turn-animate-type', { kind: 'self' }, {
      typeAdditions: ['Creature', 'Artifact', creatureType],
    }, cond),
    layer: 4,
  });
  specs.push(buildSpec(
    source,
    'off-turn-animate-pt',
    { kind: 'self' },
    { setPower, setToughness },
    cond,
  ));
  if (abilities.length) {
    specs.push(buildSpec(
      source,
      'off-turn-animate-keywords',
      { kind: 'self' },
      { abilities },
      cond,
    ));
  }
}

function pushEquippedExceptByType(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/equipped creature can(?:not|'t) be blocked except by ([a-z]+)s?/);
  if (!m) return;
  const typeWord = m[1].replace(/ies$/, 'y').replace(/s$/, '');
  if (!typeWord || ['creature', 'artifact'].includes(typeWord)) return;
  const label = typeWord.charAt(0).toUpperCase() + typeWord.slice(1) + 's';
  specs.push({
    ...buildSpec(
      source,
      'equipped-except-by-type',
      { kind: 'self' },
      { abilities: [`can't be blocked except by ${label}`] },
    ),
    sourcePermanentId: hostId,
    scope: { kind: 'self' },
  });
}

function pushOtherWithoutCounterOutlast(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each other creature you control without an? ([+\-\d/a-z ]+?) counters? on it has outlast (\{[^}]+(?:\}\/?\{[^}]+)*\})/,
  );
  if (!m) return;
  specs.push(buildSpec(
    source,
    'other-without-counter-outlast',
    { kind: 'other_creatures_you_control' },
    { abilities: [`outlast ${m[2]}`] },
    {
      kind: 'target_lacks_counter',
      counterType: String(m[1] || '').trim(),
    } as StaticEffectCondition,
  ));
}

export function pushBatch78LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushEquippedCreaturesAnthem(specs, source, oracle);
  pushInstantAndSorceryGyKeywords(specs, source, oracle);
  pushLessonGyKeyword(specs, source, oracle);
  pushCastInstantSorcerySelfKeyword(specs, source, oracle);
  pushAnyGraveyardSizePump(specs, source, oracle);
  pushOffTurnSelfAnimate(specs, source, oracle);
  pushEquippedExceptByType(specs, source, perm, oracle);
  pushOtherWithoutCounterOutlast(specs, source, oracle);
}
