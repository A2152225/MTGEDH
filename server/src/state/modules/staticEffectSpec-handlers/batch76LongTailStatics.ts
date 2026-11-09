// server/src/state/modules/staticEffectSpec-handlers/batch76LongTailStatics.ts
// B76 static long-tail:
//   Brothers Yamazaki — each other creature named <Name> gets ±N/±N and has keywords
//   Balthier and Fran — Vehicles you control get ±N/±N and have keywords
//   Tenacious Hunter — keywords while any creature has a -1/-1 counter
//   Rusted Relic — metalcraft self becomes N/N Golem artifact creature
//   Nighthowler — self + enchanted +X/+X from creature cards in all graveyards
//   Sonorous Howlbonder — menace creatures you control need 3+ blockers
// Public: pushBatch76LongTailStaticSpecs.
// Sibling extensions: monstrous / artifact-or-enchantment / wolf-or-werewolf /
//   sacrificed-permanent / exact-N-counters (Homarid) / Llawan color-creature cast lock /
//   Nick+Dragster block except-by / Opalescence classifier.

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

function pushOtherNamedCreatureAnthemWithKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each other creature named ([a-z0-9' ,.-]+?) gets ([+-]\d+\s*\/\s*[+-]\d+)(?: and has ([^.]+))?/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[2] || '');
  const cardName = String(m[1] || '').trim();
  if (!buff || !cardName) return;
  const abilities = m[3] ? parseLordAbilitiesFromTail(m[3]) : [];
  specs.push(buildSpec(
    source,
    `other-named-creature-buff:${cardName.replace(/\s+/g, '-')}`,
    { kind: 'other_all_creatures' },
    {
      power: buff.power,
      toughness: buff.toughness,
      ...(abilities.length ? { abilities } : {}),
    },
    { kind: 'target_has_name', cardName } as StaticEffectCondition,
  ));
}

function pushVehiclesYouControlAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /vehicles you control get ([+-]\d+\s*\/\s*[+-]\d+)(?: and have ([^.]+))?/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const abilities = m[2] ? parseLordAbilitiesFromTail(m[2]) : [];
  specs.push(buildSpec(
    source,
    'vehicles-you-control-anthem',
    { kind: 'permanents_you_control', qualifier: { subtype: 'vehicle' } },
    {
      power: buff.power,
      toughness: buff.toughness,
      ...(abilities.length ? { abilities } : {}),
    },
  ));
}

function pushBattlefieldCounterKeywordGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as a creature has an? ([+\-\d/a-z ]+?) counters? on it, (?:this creature|~) has ([^.]+)/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[2] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'battlefield-creature-counter-keywords',
    { kind: 'self' },
    { abilities },
    {
      kind: 'battlefield_has_creature_with_counter',
      counterType: String(m[1] || '').trim(),
    } as StaticEffectCondition,
  ));
}

function pushMetalcraftSelfAnimate(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'")
    .replace(/^[a-z0-9' ]+\s*[—–-]\s*/m, '');
  const m = text.match(
    /(?:this artifact|~|it) is an? (\d+)\s*\/\s*(\d+) ([a-z]+) artifact creature as long as you control (\w+) or more artifacts/,
  );
  if (!m) return;
  const setPower = Number(m[1]);
  const setToughness = Number(m[2]);
  const creatureType = m[3].charAt(0).toUpperCase() + m[3].slice(1);
  const amount = countWord(m[4]);
  if (!Number.isFinite(setPower) || !Number.isFinite(setToughness) || amount === undefined) return;
  const cond: StaticEffectCondition = {
    kind: 'source_controller_controls_matching',
    cardType: 'artifact',
    count: amount,
  } as StaticEffectCondition;
  specs.push(buildSpec(
    source,
    'metalcraft-self-animate-type',
    { kind: 'self' },
    { typeAdditions: ['Creature', creatureType] },
    cond,
  ));
  specs.push(buildSpec(
    source,
    'metalcraft-self-animate-pt',
    { kind: 'self' },
    { setPower, setToughness },
    cond,
  ));
}

function pushSelfAndEnchantedAllGraveyardCreaturePump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/(?:this creature|~) and enchanted creature each get \+x\/\+x,? where x is the number of creature cards in all graveyards/.test(text)) {
    return;
  }
  const grant = {
    power: 1,
    toughness: 1,
    countBasis: 'controller_graveyard_cards_of_type',
    countCardType: 'creature',
    countWho: 'all',
  } as any;
  const pushFor = (idPrefix: string, sourcePermanentId: string, effectSourceId?: string) => {
    specs.push({
      ...buildSpec(source, idPrefix, { kind: 'self' }, grant),
      sourcePermanentId,
      ...(effectSourceId ? { effectSourcePermanentId: effectSourceId } : {}),
      scope: { kind: 'self' as const },
    });
  };
  pushFor('self-all-gy-creature-pump', source.sourcePermanentId);
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (hostId) pushFor('enchanted-all-gy-creature-pump', hostId, source.sourcePermanentId);
}

function pushMenaceMinBlockersGrant(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each creature you control with menace can(?:not|'t) be blocked except by (\w+) or more creatures/,
  );
  if (!m) return;
  const n = countWord(m[1]);
  if (n === undefined) return;
  specs.push(buildSpec(
    source,
    'menace-min-blockers-grant',
    { kind: 'creatures_you_control', qualifier: { keyword: 'menace' } },
    { abilities: [`can't be blocked except by ${n} or more creatures`] },
  ));
}

export function pushBatch76LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushOtherNamedCreatureAnthemWithKeywords(specs, source, oracle);
  pushVehiclesYouControlAnthem(specs, source, oracle);
  pushBattlefieldCounterKeywordGrant(specs, source, oracle);
  pushMetalcraftSelfAnimate(specs, source, oracle);
  pushSelfAndEnchantedAllGraveyardCreaturePump(specs, source, perm, oracle);
  pushMenaceMinBlockersGrant(specs, source, oracle);
}
