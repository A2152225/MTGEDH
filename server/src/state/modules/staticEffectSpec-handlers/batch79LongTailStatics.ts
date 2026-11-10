// server/src/state/modules/staticEffectSpec-handlers/batch79LongTailStatics.ts
// B79 static long-tail:
//   Falthis — commanders you control have keywords
//   Soulcatchers' Aerie — type creatures get ±N/±N for each counter on source
//   Dark Matter Manipulator — ±N/±N for every M cards in your graveyard
//   The Space Family Goblinson — keyword after rolling N+ dice this turn
// Public: pushBatch79LongTailStaticSpecs.
// Sibling: Roc no-counter self, Kumena Merfolk/Island OR, Battlefront counter max-blockers,
//   Shifting Sliver type-except-by, Melting de-snow, Frenzied combat-damage classifier,
//   O-Naginata attach-power gate, Cloak except-Walls grant.

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

function pushCommandersYouControlKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/commanders? you control have ([^.]+)/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'commanders-you-control-keywords',
    { kind: 'creatures_you_control' },
    { abilities },
    { kind: 'target_is_commander' } as StaticEffectCondition,
  ));
}

function pushTypeCreaturesSourceCounterAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /([a-z]+) creatures get ([+-]\d+\s*\/\s*[+-]\d+) for each ([a-z+\/-]+) counters? on (?:this [a-z]+|~)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[2] || '');
  const creatureType = String(m[1] || '').replace(/s$/, '');
  if (!buff || !creatureType) return;
  specs.push(buildSpec(
    source,
    `type-source-counter-anthem:${creatureType}`,
    { kind: 'all_creatures_of_type', creatureType },
    {
      power: buff.power,
      toughness: buff.toughness,
      countBasis: 'source_counters',
      countCounterType: String(m[3] || '').trim(),
    },
  ));
}

function pushEveryNGraveyardPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) gets ([+-]\d+\s*\/\s*[+-]\d+) for every (\d+|[a-z]+) cards? in your graveyard/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  const every = countWord(m[2] || '');
  if (!buff || every === undefined || every < 1) return;
  specs.push(buildSpec(
    source,
    'every-n-graveyard-pump',
    { kind: 'self' },
    {
      power: buff.power,
      toughness: buff.toughness,
      countBasis: 'controller_graveyard_cards_of_type',
      countCardType: '',
      countDivisor: every,
    },
  ));
}

function pushDiceRolledSelfKeyword(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z][a-z' ,.-]{0,40}?) has ([a-z][a-z -]*) as long as you(?:'ve| have) rolled (\d+|[a-z]+) or more dice this turn/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  const amount = countWord(m[2] || '');
  if (!abilities.length || amount === undefined) return;
  specs.push(buildSpec(
    source,
    'dice-rolled-self-keyword',
    { kind: 'self' },
    { abilities },
    {
      kind: 'source_controller_dice_rolled_at_least',
      amount,
    } as StaticEffectCondition,
  ));
}

function pushEnchantedPhasingExceptByType(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /enchanted creature has phasing and can(?:not|'t) be blocked except by ([a-z]+)s?/,
  );
  if (!m) return;
  const typeWord = m[1].replace(/ies$/, 'y').replace(/s$/, '');
  if (!typeWord) return;
  const label = typeWord.charAt(0).toUpperCase() + typeWord.slice(1) + 's';
  specs.push({
    ...buildSpec(
      source,
      'enchanted-phasing-except-by-type',
      { kind: 'self' },
      { abilities: ['phasing', `can't be blocked except by ${label}`] },
    ),
    sourcePermanentId: hostId,
    scope: { kind: 'self' },
  });
}

export function pushBatch79LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushCommandersYouControlKeywords(specs, source, oracle);
  pushTypeCreaturesSourceCounterAnthem(specs, source, oracle);
  pushEveryNGraveyardPump(specs, source, oracle);
  pushDiceRolledSelfKeyword(specs, source, oracle);
  pushEnchantedPhasingExceptByType(specs, source, perm, oracle);
}
