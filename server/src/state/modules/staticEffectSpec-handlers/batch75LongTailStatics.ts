// server/src/state/modules/staticEffectSpec-handlers/batch75LongTailStatics.ts
// B75 static long-tail:
//   March of the Machines — noncreature artifacts are MV creatures
//   Seven Dwarves — +N/+N for each other creature named <Name> you control
//   Shield of Kaldra — Equipment named A, B, and C have indestructible
//   Soul Swindler — indestructible after visiting an Attraction this turn
//   Coram — +X/+0 from greatest power among creature cards in all graveyards
//   Technodrome — can't attack/block unless power ≥ N (via combat conditions sibling)
// Public: pushBatch75LongTailStaticSpecs.
// Sibling extensions: Nyx Infusion attached otherwise, Avalanche CDA, Cursed Rack hand size,
//   Pillar of War as-though defender, power-at-least self combat condition.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

function pushMarchOfTheMachines(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/each noncreature artifact is an? artifact creature with power and toughness each equal to its mana value/.test(text)) {
    return;
  }
  const conds: StaticEffectCondition[] = [
    { kind: 'target_has_type', cardType: 'artifact' } as StaticEffectCondition,
    { kind: 'target_lacks_type', cardType: 'creature' } as StaticEffectCondition,
  ];
  const typeSpec = buildSpec(
    source,
    'noncreature-artifact-becomes-creature',
    { kind: 'all_permanents' },
    { typeAdditions: ['Creature'] },
  );
  typeSpec.conditions = conds;
  typeSpec.layer = 4;
  specs.push(typeSpec);
  const ptSpec = buildSpec(
    source,
    'noncreature-artifact-mv-pt',
    { kind: 'all_permanents' },
    { setPowerToughnessFromManaValue: true } as any,
  );
  ptSpec.conditions = conds;
  specs.push(ptSpec);
}

function pushOtherNamedCreatureAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const subject = String(source.sourceName || '').toLowerCase();
  const short = subject.split(',')[0].trim();
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) gets ([+-]\d+\s*\/\s*[+-]\d+) for each other creature named ([a-z0-9' ,.-]+?) you control/,
  );
  // Also "Seven Dwarves gets +1/+1 for each other creature named Seven Dwarves you control."
  const named = m || text.match(
    new RegExp(
      `(?:${[subject, short].filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')).join('|')}) gets ([+-]\\d+\\s*\\/\\s*[+-]\\d+) for each other creature named ([a-z0-9' ,.-]+?) you control`,
    ),
  );
  if (!named) return;
  const buff = parseBuffSegment(named[1] || '');
  const cardName = String(named[2] || '').trim();
  if (!buff || !cardName) return;
  specs.push(buildSpec(
    source,
    `other-named-creature-anthem:${cardName.replace(/\s+/g, '-')}`,
    { kind: 'self' },
    {
      power: buff.power,
      toughness: buff.toughness,
      countBasis: 'creatures_named',
      countName: cardName,
      countExcludeSource: true,
    } as any,
  ));
}

function pushNamedEquipmentIndestructible(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*equipment named ([a-z0-9' ,.-]+?) have indestructible/,
  );
  if (!m) return;
  const names = String(m[1] || '')
    .split(/\s*,\s*|\s+and\s+/)
    .map((n) => n.trim())
    .filter(Boolean);
  if (!names.length) return;
  for (const cardName of names) {
    specs.push(buildSpec(
      source,
      `named-equipment-indestructible:${cardName.replace(/\s+/g, '-')}`,
      { kind: 'all_permanents' },
      { abilities: ['indestructible'] },
      { kind: 'target_has_name', cardName } as StaticEffectCondition,
    ));
  }
}

function pushVisitedAttractionIndestructible(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /as long as you(?:'ve| have) visited an? attraction this turn,?\s*(?:this creature|~) has indestructible/,
  );
  if (!m) return;
  specs.push(buildSpec(
    source,
    'visited-attraction-indestructible',
    { kind: 'self' },
    { abilities: ['indestructible'] },
    { kind: 'source_controller_visited_attraction_this_turn' } as StaticEffectCondition,
  ));
}

function pushGreatestGraveyardPowerPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:this creature|~|[a-z' ,.-]+?) gets \+x\/([+-]?\d+),?\s*where x is the greatest power among creature cards in all graveyards/,
  );
  if (!m) return;
  const toughness = Number(m[1] || 0);
  if (!Number.isFinite(toughness)) return;
  specs.push(buildSpec(
    source,
    'greatest-gy-power-pump',
    { kind: 'self' },
    {
      power: 1,
      toughness,
      countBasis: 'greatest_power_among_creature_cards_in_all_graveyards',
    } as any,
  ));
}

export function pushBatch75LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushMarchOfTheMachines(specs, source, oracle);
  pushOtherNamedCreatureAnthem(specs, source, oracle);
  pushNamedEquipmentIndestructible(specs, source, oracle);
  pushVisitedAttractionIndestructible(specs, source, oracle);
  pushGreatestGraveyardPowerPump(specs, source, oracle);
}
