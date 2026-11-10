// server/src/state/modules/staticEffectSpec-handlers/batch84LongTailStatics.ts
// B84 static long-tail:
//   Aspect of Wolf — enchanted +X/+Y half Forests (down/up)
//   Serra's Emissary — you + creatures have protection from the chosen card type
//   Tyrannical Pitlord — the chosen creature gets ±N/±N and has keywords
//   Orochi Merge-Keeper — modified → quoted mana ability
//   Relic Vial — control a TYPE → quoted ability
//   Gideon Blackblade — during your turn, is an N/N creature with keywords (still a PW)
// Public: pushBatch84LongTailStaticSpecs.
// Sibling: Living Lore / Lost Order / Angry Mob via variablePTControlledCountCDA;
//   Conspiracy via TypeExtras; Qal Sisma / Myr Prototype via combatAttackerSelfTax;
//   Lavinia / Sanctum via castRestrictionTail; Grafdigger / Worms via batch31CastLocks.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

function pushAspectOfWolf(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/enchanted creature gets \+x\/\+y,? where x is half the number of forests you control, rounded down, and y is half the number of forests you control, rounded up/.test(text)) {
    return;
  }
  specs.push({
    ...buildSpec(
      source,
      'aspect-of-wolf-power',
      { kind: 'self' },
      {
        power: 1,
        toughness: 0,
        countBasis: 'controller_lands_of_subtype_half_down',
        countCardType: 'forest',
      },
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
  specs.push({
    ...buildSpec(
      source,
      'aspect-of-wolf-toughness',
      { kind: 'self' },
      {
        power: 0,
        toughness: 1,
        countBasis: 'controller_lands_of_subtype_half_up',
        countCardType: 'forest',
      },
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushSerraEmissaryProtection(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/you and creatures you control have protection from the chosen card type/.test(text)) return;
  const chosen = String((perm as any)?.chosenCardType || (perm as any)?.card?.chosenCardType || '').trim().toLowerCase();
  if (!chosen) return;
  const ability = `protection from ${chosen}`;
  specs.push(buildSpec(
    source,
    'you-creatures-protection-chosen-card-type',
    { kind: 'creatures_you_control' },
    { abilities: [ability] },
  ));
  specs.push(buildSpec(
    source,
    'you-protection-chosen-card-type-self',
    { kind: 'self' },
    { abilities: [ability] },
  ));
}

function pushTyrannicalChosenCreature(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/the chosen creature gets ([+-]\d+\s*\/\s*[+-]\d+)(?: and has ([^.]+))?/);
  if (!m) return;
  const hostId = String(
    (perm as any)?.chosenCreatureId
    || (perm as any)?.chosenPermanentId
    || (perm as any)?.card?.chosenCreatureId
    || '',
  ).trim();
  if (!hostId) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const abilities = m[2] ? parseLordAbilitiesFromTail(m[2]) : [];
  specs.push({
    ...buildSpec(
      source,
      'chosen-creature-pump',
      { kind: 'self' },
      { power: buff.power, toughness: buff.toughness, ...(abilities.length ? { abilities } : {}) },
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushModifiedQuotedSelfAbility(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as (?:this creature|~|it) is modified, (?:it|this creature|~) has "([^"]+)"/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(`"${m[1]}"`);
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'modified-quoted-self-ability',
    { kind: 'self' },
    { abilities },
    { kind: 'target_is_modified' } as StaticEffectCondition,
  ));
}

function pushControlTypeQuotedSelfAbility(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as you control an? ([a-z]+), (?:this (?:artifact|creature|permanent)|~) has "([^"]+)"/,
  );
  if (!m) return;
  const creatureType = String(m[1] || '').trim();
  const abilities = parseLordAbilitiesFromTail(`"${m[2]}"`);
  if (!creatureType || !abilities.length) return;
  specs.push(buildSpec(
    source,
    'control-type-quoted-self-ability',
    { kind: 'self' },
    { abilities },
    {
      kind: 'source_controller_controls_matching',
      creatureType,
      count: 1,
      creaturesOnly: true,
    } as StaticEffectCondition,
  ));
}

function pushYourTurnPlaneswalkerCreature(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /during your turn, (?:this planeswalker|~|[a-z' ,.-]+?) is an? (\d+)\s*\/\s*(\d+) ([a-z ]+?) creature with ([a-z ,]+) that'?s still a planeswalker/,
  );
  if (!m) return;
  const subtypes = String(m[3] || '').trim().split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const abilities = parseLordAbilitiesFromTail(m[4] || '');
  specs.push(buildSpec(
    source,
    'your-turn-planeswalker-creature',
    { kind: 'self' },
    {
      typeAdditions: ['Creature', ...subtypes],
      setPower: Number(m[1]),
      setToughness: Number(m[2]),
      ...(abilities.length ? { abilities } : {}),
    },
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
  ));
}

export function pushBatch84LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushAspectOfWolf(specs, source, perm, oracle);
  pushSerraEmissaryProtection(specs, source, perm, oracle);
  pushTyrannicalChosenCreature(specs, source, perm, oracle);
  pushModifiedQuotedSelfAbility(specs, source, oracle);
  pushControlTypeQuotedSelfAbility(specs, source, oracle);
  pushYourTurnPlaneswalkerCreature(specs, source, oracle);
}
