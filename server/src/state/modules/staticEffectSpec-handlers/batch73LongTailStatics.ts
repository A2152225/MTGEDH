// server/src/state/modules/staticEffectSpec-handlers/batch73LongTailStatics.ts
// B73 static long-tail:
//   Jodah — legendary creatures you control get +X/+X (count legendary creatures)
//   Sheltering Prayers — basic lands have shroud while that player controls ≤N lands
//   Rakdos Riteknife — equipped +N/+M for each counter on this Equipment (ignore quoted grant)
//   Rootpath Purifier — lands you control are basic
//   Shifting Sky — all nonland permanents are the chosen color (layer-5 set)
//   Keen-Eyed Curator — self pump when N+ card types among cards exiled with source
//   Goblin Brawler — ~ can't be equipped
// Public: pushBatch73LongTailStaticSpecs.
// Sibling extensions (same batch): variablePowerOnlyCalculator CDAs (Vile Aggregate / Katilda),
//   staticCastingRestrictionsOracleExtras (Basandra), batch31 zone-enter lock (Weathered Runestone).

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { colorSetEntry } from '../colorSettingMarker.js';
import {
  buildSpec,
  parseBuffSegment,
  parseCardCountWord,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function readCount(raw: string): number | null {
  const s = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  if (NUM[s] != null) return NUM[s];
  try {
    const n = parseCardCountWord(s);
    return n && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pushLegendaryWhereXAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*legendary creatures you control get \+x\/\+x,? where x is the number of legendary creatures you control/,
  );
  if (!m) return;
  specs.push(buildSpec(
    source,
    'legendary-where-x-anthem',
    { kind: 'creatures_you_control' },
    {
      power: 1,
      toughness: 1,
      countBasis: 'controller_permanents_of_type',
      countCardType: 'creature',
      countQualifier: { legendary: true },
    } as any,
    { kind: 'target_is_legendary_creature' } as StaticEffectCondition,
  ));
}

function pushBasicLandControllerShroud(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*basic lands each player controls have shroud as long as that player controls (\w+) or fewer lands/,
  );
  if (!m) return;
  const amount = readCount(m[1] || '');
  if (amount == null) return;
  specs.push(buildSpec(
    source,
    'basic-land-controller-shroud',
    { kind: 'all_permanents', qualifier: { basic: true } } as any,
    { abilities: ['shroud'] },
    { kind: 'target_controller_controls_at_most', cardType: 'land', amount } as StaticEffectCondition,
  ));
}

function pushEquippedForEachSourceCounter(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  // Strip quoted grants so an embedded period does not break the PT parse (Rakdos Riteknife).
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'")
    .replace(/"[^"]*"/g, ' ')
    .replace(/\u201c[^\u201d]*\u201d/g, ' ');
  const m = text.match(
    /equipped creature gets ([+-]\d+)\s*\/\s*([+-]\d+) for each ([a-z+\/0-9-]+) counters? on (?:this equipment|~)/,
  );
  if (!m) return;
  const power = Number(m[1]);
  const toughness = Number(m[2]);
  const counterType = String(m[3] || '').trim();
  if (!counterType || !Number.isFinite(power) || !Number.isFinite(toughness)) return;
  specs.push({
    ...buildSpec(
      source,
      'equipped-for-each-source-counter',
      { kind: 'self' },
      {
        power,
        toughness,
        countBasis: 'source_counters',
        countCounterType: counterType,
        countOnEffectSource: true,
      } as any,
    ),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushLandsYouControlAreBasic(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/lands you control(?: and land cards in your library)? are basic/.test(text)) return;
  specs.push({
    ...buildSpec(
      source,
      'lands-you-control-are-basic',
      { kind: 'lands_you_control' },
      { typeAdditions: ['Basic'] },
    ),
    layer: 4,
  });
}

function pushNonlandChosenColorSet(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const chosen = String((perm as any)?.chosenColor || (perm as any)?.card?.chosenColor || '').trim();
  if (!chosen) return;
  if (!/all nonland permanents are the chosen colou?r/.test(String(oracle || '').toLowerCase())) return;
  const set = colorSetEntry(chosen);
  if (!set) return;
  specs.push({
    ...buildSpec(
      source,
      'nonland-chosen-color-set',
      { kind: 'all_permanents', qualifier: { nonType: 'land' } } as any,
      { colorAdditions: [set] },
    ),
    layer: 5,
  });
}

function pushExiledCardTypesPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /as long as there are (\w+) or more card types among cards exiled with (?:this creature|~|it), (?:it|this creature|~) gets ([+-]\d+\s*\/\s*[+-]\d+)(?: and has ([^.]+))?/,
  );
  if (!m) return;
  const amount = readCount(m[1] || '');
  const buff = parseBuffSegment(m[2] || '');
  if (amount == null || !buff) return;
  const abilities = m[3] ? parseLordAbilitiesFromTail(m[3]) : [];
  const cond = { kind: 'source_exiled_card_types_at_least', amount } as StaticEffectCondition;
  specs.push(buildSpec(
    source,
    'exiled-card-types-pump',
    { kind: 'self' },
    { power: buff.power, toughness: buff.toughness, ...(abilities.length ? { abilities } : {}) },
    cond,
  ));
}

function pushCantBeEquipped(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const subject = String(source.sourceName || '').toLowerCase();
  const short = subject.split(',')[0].trim();
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const alts = ['this creature', '~'];
  if (subject) alts.push(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (short && short !== subject) alts.push(short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?:${alts.join('|')}) can(?:not|'t) be equipped`);
  if (!re.test(text)) return;
  specs.push(buildSpec(source, 'cant-be-equipped', { kind: 'self' }, { abilities: ["can't be equipped"] }));
}

export function pushBatch73LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushLegendaryWhereXAnthem(specs, source, oracle);
  pushBasicLandControllerShroud(specs, source, oracle);
  pushEquippedForEachSourceCounter(specs, source, perm, oracle);
  pushLandsYouControlAreBasic(specs, source, oracle);
  pushNonlandChosenColorSet(specs, source, perm, oracle);
  pushExiledCardTypesPump(specs, source, oracle);
  pushCantBeEquipped(specs, source, oracle);
}
