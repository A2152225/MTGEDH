// server/src/state/modules/staticEffectSpec-handlers/batch77LongTailStatics.ts
// B77 static long-tail:
//   Omnath — +N/+N for each unspent mana
//   Tom Bombadil — hexproof+indestructible from lore counters among Sagas
//   Deification — planeswalkers of chosen type have hexproof
//   Valentina — other Villains are Heroes
//   Blaster — other nontoken artifact creatures and Vehicles have modular N
//   Canopy Cover — enchanted host hexproof + flying/reach block restriction
// Public: pushBatch77LongTailStaticSpecs.
// Sibling: Winter delirium opponent hand size; Ayesha defending-player artifacts unblockable.

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

function pushUnspentManaSelfPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  // B88: also "for each unspent green mana you have" (Omnath, Locus of Mana).
  const m = text.match(
    /(?:this creature|~|[a-z' ,.-]+?) gets ([+-]\d+\s*\/\s*[+-]\d+) for each unspent(?: (white|blue|black|red|green))? mana you have/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const color = String(m[2] || '').trim();
  specs.push(buildSpec(
    source,
    color ? `unspent-mana-self-pump:${color}` : 'unspent-mana-self-pump',
    { kind: 'self' },
    {
      power: buff.power,
      toughness: buff.toughness,
      countBasis: 'controller_unspent_mana',
      ...(color ? { countColor: color } : {}),
    } as any,
  ));
}

function pushSagaLoreKeywordGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as there are (\w+) or more lore counters among sagas you control, (?:this creature|~|[a-z' ,.-]+?) has ([^.]+)/,
  );
  if (!m) return;
  const amount = countWord(m[1]);
  const abilities = parseLordAbilitiesFromTail(m[2] || '');
  if (amount === undefined || !abilities.length) return;
  specs.push(buildSpec(
    source,
    'saga-lore-self-keywords',
    { kind: 'self' },
    { abilities },
    {
      kind: 'source_controller_saga_lore_counters_at_least',
      count: amount,
      amount,
    } as StaticEffectCondition,
  ));
}

function pushChosenPlaneswalkerTypeHexproof(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/planeswalkers you control of the chosen type have hexproof/.test(text)) return;
  const chosen = String(
    (perm as any).chosenPlaneswalkerType
    || (perm as any).chosenType
    || (perm as any).card?.chosenPlaneswalkerType
    || (perm as any).card?.chosenType
    || '',
  ).trim();
  if (!chosen) return;
  specs.push(buildSpec(
    source,
    'chosen-pw-type-hexproof',
    { kind: 'planeswalkers_you_control' },
    { abilities: ['hexproof'] },
    {
      kind: 'target_has_creature_type',
      creatureType: chosen,
    } as StaticEffectCondition,
  ));
}

function pushOtherVillainsAreHeroes(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/other villains you control are heroes in addition to their other types/.test(text)) return;
  specs.push({
    ...buildSpec(
      source,
      'other-villains-are-heroes',
      { kind: 'other_permanents_you_control' },
      { typeAdditions: ['Hero'] },
      { kind: 'target_has_creature_type', creatureType: 'Villain' } as StaticEffectCondition,
    ),
    layer: 4,
  });
}

function pushOtherModularGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /other nontoken artifact creatures and vehicles you control have modular (\d+)/,
  );
  if (!m) return;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return;
  // Artifact creatures (nontoken).
  specs.push(buildSpec(
    source,
    'other-nontoken-artifact-creatures-modular',
    { kind: 'other_creatures_you_control', qualifier: { token: false } },
    { abilities: [`modular ${n}`] },
    { kind: 'target_has_type', cardType: 'artifact' } as StaticEffectCondition,
  ));
  // Vehicles (including noncreature vehicles).
  specs.push(buildSpec(
    source,
    'other-vehicles-modular',
    { kind: 'other_permanents_you_control', qualifier: { subtype: 'vehicle', token: false } },
    { abilities: [`modular ${n}`] },
  ));
}

function pushCanopyCoverHostGrants(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const abilities: string[] = [];
  if (/enchanted creature can(?:not|'t) be blocked except by creatures with flying or reach/.test(text)) {
    abilities.push("can't be blocked except by creatures with flying or reach");
  }
  if (/enchanted creature can(?:not|'t) be the target of spells or abilities your opponents control/.test(text)) {
    abilities.push('hexproof');
  }
  if (!abilities.length) return;
  specs.push({
    ...buildSpec(source, 'canopy-cover-host', { kind: 'self' }, { abilities }),
    sourcePermanentId: hostId,
    scope: { kind: 'self' },
  });
}

export function pushBatch77LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushUnspentManaSelfPump(specs, source, oracle);
  pushSagaLoreKeywordGrant(specs, source, oracle);
  pushChosenPlaneswalkerTypeHexproof(specs, source, perm, oracle);
  pushOtherVillainsAreHeroes(specs, source, oracle);
  pushOtherModularGrant(specs, source, oracle);
  pushCanopyCoverHostGrants(specs, source, perm, oracle);
}
