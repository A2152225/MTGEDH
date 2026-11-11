// server/src/state/modules/staticEffectSpec-handlers/batch85LongTailStatics.ts
// B85 static long-tail:
//   Spiritual Asylum — creatures and lands you control have keywords
//   Runadi — creatures you control with N+ counters have keywords
//   Furtive Courier — can't be blocked after sacrificing an artifact this turn
//   Moraug — each creature you control gets ±N/±N for each time it attacked this turn
//   Criminal Past — commander creatures you own have keywords (+ optional quoted)
//   Mari — Assassins, Mercenaries, and Rogues you control have keywords
//   Zombie Master — other TYPE have quoted ability
//   Ygra — other creatures are Food artifacts (+ quoted ability)
// Public: pushBatch85LongTailStaticSpecs.
// Sibling: Innkeeper via qualifiedGrants; Earthen/Trash-Bot via countedPT;
//   Brand via castRestrictionTail; First Sliver cascade via cascadeCastGrants;
//   Sutured/Shapeshifter via variablePTControlledCountCDA; Rukarumel via TypeExtras.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function countWord(raw: string): number | undefined {
  const w = String(raw || '').toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return COUNT_WORDS[w];
}

function pushCreaturesAndLandsKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/creatures and lands you control have ([^.]+)/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(source, 'creatures-you-control-keywords', { kind: 'creatures_you_control' }, { abilities }));
  specs.push(buildSpec(source, 'lands-you-control-keywords', { kind: 'lands_you_control' }, { abilities }));
}

function pushCounterThresholdYouControlKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /creatures you control with (\w+) or more ([+\-\d/a-z]+) counters? on them have ([^.]+)/,
  );
  if (!m) return;
  const amount = countWord(m[1] || '');
  if (amount === undefined) return;
  const abilities = parseLordAbilitiesFromTail(m[3] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'counter-threshold-you-control-keywords',
    { kind: 'creatures_you_control' },
    { abilities },
    {
      kind: 'target_has_counter_at_least',
      counterType: String(m[2] || '').trim(),
      amount,
    } as StaticEffectCondition,
  ));
}

function pushSacrificedArtifactUnblockable(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:this creature|~) can(?:'t|not) be blocked as long as you(?:'ve| have) sacrificed an? artifact this turn/.test(text)) {
    return;
  }
  specs.push(buildSpec(
    source,
    'sacrificed-artifact-unblockable',
    { kind: 'self' },
    { abilities: ["can't be blocked"] },
    { kind: 'source_controller_sacrificed_artifact_this_turn' } as StaticEffectCondition,
  ));
}

function pushMoraugAttackCountAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each creature you control gets ([+-]\d+\s*\/\s*[+-]\d+) for each time it has attacked this turn/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'attacked-this-turn-count-anthem',
    { kind: 'creatures_you_control' },
    {
      power: buff.power,
      toughness: buff.toughness,
      countBasis: 'recipient_times_attacked_this_turn',
    },
  ));
}

function pushCommanderYouOwnKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/commander creatures you own have ([^.]+)/);
  if (!m) return;
  // Strip quoted clause for keyword parse; quoted body is granted as ability text.
  const tail = m[1] || '';
  const quoted = [...tail.matchAll(/"([^"]+)"/g)].map((q) => q[1].trim()).filter(Boolean);
  const keywords = parseLordAbilitiesFromTail(tail.replace(/"[^"]*"/g, ' '));
  const abilities = [...keywords, ...quoted];
  if (!abilities.length) return;
  const spec = buildSpec(
    source,
    'commander-you-own-keywords',
    { kind: 'all_creatures' },
    { abilities },
  );
  spec.conditions = [
    { kind: 'target_is_commander' } as StaticEffectCondition,
    { kind: 'target_owned_by_source_controller' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushMultiTypeYouControlKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /([a-z]+)s?, ([a-z]+)s?, and ([a-z]+)s? you control have ([^.]+)/,
  );
  if (!m) return;
  const types = [m[1], m[2], m[3]].map((t) => String(t || '').trim()).filter(Boolean);
  const abilities = parseLordAbilitiesFromTail((m[4] || '').replace(/"[^"]*"/g, ' '));
  if (types.length < 3 || !abilities.length) return;
  specs.push(buildSpec(
    source,
    `multi-type-you-control-keywords:${types.join('-')}`,
    { kind: 'creatures_you_control' },
    { abilities },
    { kind: 'target_has_any_subtype', subtypes: types } as StaticEffectCondition,
  ));
}

function pushOtherTypeQuotedAbility(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/other ([a-z]+)s? have "([^"]+)"/);
  if (!m) return;
  const creatureType = String(m[1] || '').trim();
  const abilities = parseLordAbilitiesFromTail(`"${m[2]}"`);
  if (!creatureType || !abilities.length) return;
  specs.push(buildSpec(
    source,
    `other-${creatureType}-quoted-ability`,
    { kind: 'other_all_creatures_of_type', creatureType: creatureType.charAt(0).toUpperCase() + creatureType.slice(1) },
    { abilities },
  ));
}

function pushOtherCreaturesAreFood(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /other creatures are food artifacts in addition to their other types(?: and have "([^"]+)")?/,
  );
  if (!m) return;
  const abilities = m[1] ? parseLordAbilitiesFromTail(`"${m[1]}"`) : [];
  specs.push(buildSpec(
    source,
    'other-creatures-are-food-artifacts',
    { kind: 'other_all_creatures' },
    {
      typeAdditions: ['Food', 'Artifact'],
      ...(abilities.length ? { abilities } : {}),
    },
  ));
}

export function pushBatch85LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushCreaturesAndLandsKeywords(specs, source, oracle);
  pushCounterThresholdYouControlKeywords(specs, source, oracle);
  pushSacrificedArtifactUnblockable(specs, source, oracle);
  pushMoraugAttackCountAnthem(specs, source, oracle);
  pushCommanderYouOwnKeywords(specs, source, oracle);
  pushMultiTypeYouControlKeywords(specs, source, oracle);
  pushOtherTypeQuotedAbility(specs, source, oracle);
  pushOtherCreaturesAreFood(specs, source, oracle);
}
