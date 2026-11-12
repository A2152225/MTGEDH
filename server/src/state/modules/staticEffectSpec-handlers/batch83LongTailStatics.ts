// server/src/state/modules/staticEffectSpec-handlers/batch83LongTailStatics.ts
// B83 static long-tail:
//   Spectral Guardian — while untapped, noncreature artifacts have shroud
//   Deathleaper — creatures you control that entered this turn have keywords
//   Cybermen Squadron — nonlegendary artifact creatures you control have keywords
//   Born to Drive — enchanted permanent (while a creature) +N/+N per creature and/or Vehicle
//   Thieves' Tools — equipped creature can't be blocked while power ≤ N
// Public: pushBatch83LongTailStaticSpecs.
// Sibling: Swarm of Rats / Cosmogoyf / Primalcrux via variablePT; Living Lands via layer4;
//   Lovestruck via selfCombatConditions; Song / Emissary / Knowledge via countedPT;
//   Burakos short-name via intrinsicAlsoCreatureTypes.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

function pushUntappedNoncreatureArtifactKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as (?:this creature|~|it) is untapped, noncreature artifacts have ([^.]+)/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  const spec = buildSpec(
    source,
    'untapped-noncreature-artifact-keywords',
    { kind: 'all_permanents', qualifier: { nonType: 'creature' } },
    { abilities },
  );
  spec.conditions = [
    { kind: 'source_is_untapped' } as StaticEffectCondition,
    { kind: 'target_has_type', cardType: 'artifact' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushEnteredThisTurnYouControlKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /creatures you control that entered(?: the battlefield)? this turn have ([^.]+)/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'entered-this-turn-you-control-keywords',
    { kind: 'creatures_you_control' },
    { abilities },
    { kind: 'target_entered_this_turn' },
  ));
}

function pushNonlegendaryArtifactCreatureKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/nonlegendary artifact creatures you control have ([^.]+)/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  const spec = buildSpec(
    source,
    'nonlegendary-artifact-creature-keywords',
    { kind: 'creatures_you_control' },
    { abilities },
  );
  spec.conditions = [
    { kind: 'target_is_nonlegendary_creature' } as StaticEffectCondition,
    { kind: 'target_has_type', cardType: 'artifact' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function countWord(raw: string): number | undefined {
  const w = String(raw || '').toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return COUNT_WORDS[w];
}

function pushEquippedPowerAtMostUnblockable(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /equipped creature can(?:'t|not) be blocked as long as its power is (\w+) or less/,
  );
  if (!m) return;
  const power = countWord(m[1] || '');
  if (power === undefined) return;
  specs.push({
    ...buildSpec(
      source,
      'equipped-power-at-most-unblockable',
      { kind: 'self' },
      { abilities: ["can't be blocked"] },
      { kind: 'target_power_at_most', power } as StaticEffectCondition,
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushEnchantedCreatureAndOrVehiclePump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as enchanted permanent is an? creature, it gets ([+-]\d+\s*\/\s*[+-]\d+) for each creature and\/or vehicles? you control/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push({
    ...buildSpec(
      source,
      'enchanted-creature-and-or-vehicle-pump',
      { kind: 'self' },
      {
        power: buff.power,
        toughness: buff.toughness,
        countBasis: 'controller_permanents_of_type',
        countCardType: '(?:creature|vehicle)',
      },
      { kind: 'target_has_type', cardType: 'creature' } as StaticEffectCondition,
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

export function pushBatch83LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushUntappedNoncreatureArtifactKeywords(specs, source, oracle);
  pushEnteredThisTurnYouControlKeywords(specs, source, oracle);
  pushNonlegendaryArtifactCreatureKeywords(specs, source, oracle);
  pushEquippedPowerAtMostUnblockable(specs, source, perm, oracle);
  pushEnchantedCreatureAndOrVehiclePump(specs, source, perm, oracle);
}
