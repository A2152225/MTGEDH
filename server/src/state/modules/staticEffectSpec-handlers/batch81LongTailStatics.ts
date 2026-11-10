// server/src/state/modules/staticEffectSpec-handlers/batch81LongTailStatics.ts
// B81 static long-tail:
//   Lovisa Coldeyes — each creature that's A, B, or C gets ±N/±N and has keywords
//   Curse of Death's Hold — creatures enchanted player controls get ±N/±N
//   Raph's Bravado — during your turn, attacking creatures get ±N/±N
//   Ivory Guardians — creatures named X get ±N/±N while opponent controls nontoken COLOR permanent
//   Gwafa Hazid — creatures with <counter> counters can't attack or block
//   Hithlain Rope — this permanent can't be sacrificed
//   Rolling Stones — Wall creatures can attack as though they didn't have defender
//   Piston-Fist Cyclops — can attack as though no defender after casting I/S this turn
// Public: pushBatch81LongTailStaticSpecs.
// Sibling: Dire Wolves / Snarling Warg / Guul Draz / Secretkeeper / Formation Breaker /
//   Rimestag / Faeburrow / Enemy of Enlightenment / Gleam via conditionalSelfGrants + countedPT.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

function pushMultiTypeCreatureAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /each creature that'?s an? ([a-z]+)(?:, an? ([a-z]+))?, or an? ([a-z]+) gets ([+-]\d+\s*\/\s*[+-]\d+)(?: and has ([^.]+))?/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[4] || '');
  if (!buff) return;
  const subtypes = [m[1], m[2], m[3]].filter(Boolean).map((t) => String(t).trim());
  if (subtypes.length < 2) return;
  const abilities = m[5] ? parseLordAbilitiesFromTail(m[5]) : [];
  specs.push(buildSpec(
    source,
    `multi-type-creature-anthem:${subtypes.join('-')}`,
    { kind: 'all_creatures' },
    { power: buff.power, toughness: buff.toughness, ...(abilities.length ? { abilities } : {}) },
    { kind: 'target_has_any_subtype', subtypes } as StaticEffectCondition,
  ));
}

function pushEnchantedPlayerCreaturesAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/creatures enchanted player controls get ([+-]\d+\s*\/\s*[+-]\d+)/);
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'enchanted-player-creatures-anthem',
    { kind: 'all_creatures' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_controller_is_enchanted_player' } as StaticEffectCondition,
  ));
}

function pushYourTurnAttackingCreaturesAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/during your turn, attacking creatures get ([+-]\d+\s*\/\s*[+-]\d+)/);
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const spec = buildSpec(
    source,
    'your-turn-attacking-creatures-anthem',
    { kind: 'all_creatures' },
    { power: buff.power, toughness: buff.toughness },
  );
  spec.conditions = [
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
    { kind: 'target_is_attacking' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushNamedCreaturesConditionalAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /creatures named ([a-z0-9' ,.-]+?) get ([+-]\d+\s*\/\s*[+-]\d+) as long as (.+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[2] || '');
  const cardName = String(m[1] || '').trim();
  if (!buff || !cardName) return;
  // Condition phrases for Ivory Guardians go through parseStaticSelfCondition via ExtraConditions.
  // Parse inline here for the nontoken color permanent clause.
  const condText = String(m[3] || '').replace(/\.$/, '').trim();
  const nontoken = condText.match(/^an opponent controls an? nontoken (white|blue|black|red|green) ([a-z]+)$/);
  if (!nontoken) return;
  const spec = buildSpec(
    source,
    `named-creatures-conditional:${cardName.replace(/\s+/g, '-')}`,
    { kind: 'all_creatures' },
    { power: buff.power, toughness: buff.toughness },
    {
      kind: 'opponent_controls_matching',
      color: nontoken[1],
      cardType: nontoken[2],
      nontoken: true,
    } as StaticEffectCondition,
  );
  spec.conditions = [{ kind: 'target_has_name', cardName } as StaticEffectCondition];
  specs.push(spec);
}

function pushCounterCombatLock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/creatures with ([a-z0-9+/ -]+?) counters on them can(?:not|'t) attack or block/);
  if (!m) return;
  const counter = String(m[1] || '').trim();
  if (!counter) return;
  specs.push(buildSpec(
    source,
    `counter-combat-lock:${counter.replace(/\s+/g, '-')}`,
    { kind: 'all_creatures', qualifier: { counter } },
    { abilities: ["can't attack", "can't block"] },
  ));
}

function pushSelfCantBeSacrificed(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const name = String(source.sourceName || '').toLowerCase();
  const short = name.split(',')[0].trim();
  const alts = ['this artifact', 'this creature', 'this permanent', 'this enchantment', '~'];
  if (name) alts.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (short && short !== name) alts.push(short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?:${alts.join('|')}) can(?:not|'t) be sacrificed`);
  if (!re.test(text)) return;
  specs.push(buildSpec(
    source,
    'self-cant-be-sacrificed',
    { kind: 'self' },
    { abilities: ["can't be sacrificed"] },
  ));
}

function pushTypeIgnoreDefender(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/([a-z]+) creatures can attack as though they didn'?t have defender/);
  if (!m) return;
  const creatureType = String(m[1] || '').trim();
  if (!creatureType) return;
  specs.push(buildSpec(
    source,
    `type-ignore-defender:${creatureType}`,
    { kind: 'all_creatures_of_type', creatureType },
    { asThoughNoAbilities: ['defender'] },
  ));
}

function pushSelfIgnoreDefenderAfterInstantSorcery(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as you(?:'ve| have) cast an? instant or sorcery spells? this turn, (?:this creature|~) can attack as though it didn'?t have defender/,
  );
  if (!m) return;
  specs.push(buildSpec(
    source,
    'self-ignore-defender-after-instant-sorcery',
    { kind: 'self' },
    { asThoughNoAbilities: ['defender'] },
    { kind: 'controller_instant_or_sorcery_cast_this_turn' } as StaticEffectCondition,
  ));
}

export function pushBatch81LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushMultiTypeCreatureAnthem(specs, source, oracle);
  pushEnchantedPlayerCreaturesAnthem(specs, source, oracle);
  pushYourTurnAttackingCreaturesAnthem(specs, source, oracle);
  pushNamedCreaturesConditionalAnthem(specs, source, oracle);
  pushCounterCombatLock(specs, source, oracle);
  pushSelfCantBeSacrificed(specs, source, oracle);
  pushTypeIgnoreDefender(specs, source, oracle);
  pushSelfIgnoreDefenderAfterInstantSorcery(specs, source, oracle);
}
