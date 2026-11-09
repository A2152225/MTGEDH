// server/src/state/modules/staticEffectSpec-handlers/batch71LongTailStatics.ts
// B71 static long-tail:
//   Living Conundrum — empty library base P/T + keywords
//   Magmatic Channeler — instant/sorcery GY threshold self pump
//   Mirror Box — each legendary creature you control anthem
//   On Wings of Gold — Zombies and/or tokens anthem+keywords
//   Aurification — gold-counter creatures are Walls with defender
//   Boarded Window — creatures attacking you get ±N/±N
//   Champion's Drake — control a creature with N+ level counters
//   Empty-Shrine Kannushi — protection from each color among permanents you control
//   Rimefeather Owl — ice-counter permanents are snow
//   Meishin — all creatures -X/-0 (hand size)
//   Chainsaw — equipped +X/+0 from rev counters on source
// Public: pushBatch71LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
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

function pushEmptyLibraryBasePt(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /as long as there are no cards in your library,?\s*(?:this creature|~) has base power and toughness (\d+)\s*\/\s*(\d+)(?: and has ([^.]+))?/,
  );
  if (!m) return;
  const setPower = Number(m[1]);
  const setToughness = Number(m[2]);
  if (!Number.isFinite(setPower) || !Number.isFinite(setToughness)) return;
  const abilities = m[3] ? parseLordAbilitiesFromTail(m[3]) : [];
  const cond = { kind: 'controller_library_empty' } as StaticEffectCondition;
  specs.push(buildSpec(source, 'empty-library-base-pt', { kind: 'self' }, { setPower, setToughness }, cond));
  if (abilities.length) {
    specs.push(buildSpec(source, 'empty-library-keywords', { kind: 'self' }, { abilities }, cond));
  }
}

function pushLegendaryCreatureAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*each legendary creatures? you control gets?\s+(\+\d+\s*\/\s*\+\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'legendary-creature-anthem',
    { kind: 'creatures_you_control' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_is_legendary_creature' } as StaticEffectCondition,
  ));
}

function pushZombieOrTokenAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*creatures you control that are zombies and\/or tokens get\s+(\+\d+\s*\/\s*\+\d+)(?: and have ([^.]+))?/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const abilities = m[2] ? parseLordAbilitiesFromTail(m[2]) : [];
  specs.push(buildSpec(
    source,
    'zombie-or-token-anthem',
    { kind: 'creatures_you_control' },
    { power: buff.power, toughness: buff.toughness, ...(abilities.length ? { abilities } : {}) },
    { kind: 'target_is_zombie_or_token' } as StaticEffectCondition,
  ));
}

function pushGoldCounterWallDefender(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/each creature with an? gold counter on it is an? wall in addition to its other creature types and has defender/.test(text)) {
    return;
  }
  const cond = { kind: 'target_has_counter', counterType: 'gold' } as StaticEffectCondition;
  specs.push({
    ...buildSpec(source, 'gold-counter-wall-type', { kind: 'all_creatures' }, { typeAdditions: ['Wall'] }, cond),
    layer: 4,
  });
  specs.push(buildSpec(source, 'gold-counter-defender', { kind: 'all_creatures' }, { abilities: ['defender'] }, cond));
}

function pushCreaturesAttackingYouPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*creatures attacking you get\s+([+-]\d+\s*\/\s*[+-]\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'creatures-attacking-you-pt',
    { kind: 'all_creatures' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_is_attacking_source_controller' } as StaticEffectCondition,
  ));
}

function pushLevelCounterControlledPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:this creature|~) gets\s+(\+\d+\s*\/\s*\+\d+)\s+as long as you control an? creature with (\w+) or more level counters on it/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  const amount = readCount(m[2] || '');
  if (!buff || amount == null) return;
  specs.push(buildSpec(
    source,
    'control-level-counter-creature-pump',
    { kind: 'self' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'controller_controls_creature_with_counter_at_least', counterType: 'level', amount } as StaticEffectCondition,
  ));
}

function pushProtectionFromColorsAmongPermanents(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  // Empty-Shrine Kannushi (both wordings)
  if (!/(?:this creature|~) has protection from (?:each color among|the colors of) permanents you control/.test(text)) {
    return;
  }
  specs.push(buildSpec(
    source,
    'protection-from-colors-among-permanents',
    { kind: 'self' },
    { protectionFromColorsAmongPermanentsYouControl: true } as any,
  ));
}

function pushIceCounterSnow(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  if (!/permanents with ice counters on them are snow/.test(String(oracle || '').toLowerCase())) return;
  specs.push({
    ...buildSpec(
      source,
      'ice-counter-snow',
      { kind: 'all_permanents' },
      { typeAdditions: ['Snow'] },
      { kind: 'target_has_counter', counterType: 'ice' } as StaticEffectCondition,
    ),
    layer: 4,
  });
}

function pushHandSizeGlobalPenalty(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*all creatures get -x\/([+-]?\d+),?\s*where x is the number of cards in your hand/,
  );
  if (!m) return;
  const toughness = Number(m[1] || 0);
  if (!Number.isFinite(toughness)) return;
  specs.push(buildSpec(
    source,
    'hand-size-global-minus-x',
    { kind: 'all_creatures' },
    { power: -1, toughness, countBasis: 'controller_hand_size' },
  ));
}

function pushEquippedRevCounterWhereX(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /equipped creature gets \+x\/([+-]?\d+),?\s*where x is the number of ([a-z+\/0-9-]+) counters on (?:this equipment|~)/,
  );
  if (!m) return;
  const toughness = Number(m[1] || 0);
  const counterType = String(m[2] || '').trim();
  if (!counterType || !Number.isFinite(toughness)) return;
  specs.push({
    ...buildSpec(
      source,
      'equipped-source-counter-where-x',
      { kind: 'self' },
      {
        power: 1,
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

export function pushBatch71LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushEmptyLibraryBasePt(specs, source, oracle);
  // Magmatic Channeler rides conditionalSelfGrants + opponent-state instant_or_sorcery GY condition.
  pushLegendaryCreatureAnthem(specs, source, oracle);
  pushZombieOrTokenAnthem(specs, source, oracle);
  pushGoldCounterWallDefender(specs, source, oracle);
  pushCreaturesAttackingYouPump(specs, source, oracle);
  pushLevelCounterControlledPump(specs, source, oracle);
  pushProtectionFromColorsAmongPermanents(specs, source, oracle);
  pushIceCounterSnow(specs, source, oracle);
  pushHandSizeGlobalPenalty(specs, source, oracle);
  pushEquippedRevCounterWhereX(specs, source, perm, oracle);
}
