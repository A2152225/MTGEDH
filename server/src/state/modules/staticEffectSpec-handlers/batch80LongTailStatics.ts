// server/src/state/modules/staticEffectSpec-handlers/batch80LongTailStatics.ts
// B80 static long-tail:
//   Watchdog — untapped source: creatures attacking you get ±N/±N
//   Rielle — ±N/±N for each instant and sorcery card in your graveyard
//   Warden of the Beyond — pump while an opponent owns a card in exile
//   Woolly Mammoths — keyword while you control a snow land
//   Okoye — attacking creature tokens you control have keywords
//   Teferi's Curse — enchanted permanent has phasing
//   Anti-Magic Aura — enchanted can't be targeted by spells / enchanted by other Auras
//   Shanna — can't be the target of abilities opponents control
// Public: pushBatch80LongTailStaticSpecs.
// Sibling: Winter Soldier via countedPT him/her attach; Konda via conditionalSelfGrants
//   legendary+type; Dáin enduring-story attack-you tax; Winged Hive ability-word strip;
//   Hazoret max-speed combat lock condition; casting/combat classifiers.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

function pushUntappedAttackingYouPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /as long as (?:this creature|this permanent|~|it) is untapped, all creatures attacking you get ([+-]\d+\s*\/\s*[+-]\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const spec = buildSpec(
    source,
    'untapped-creatures-attacking-you-pt',
    { kind: 'all_creatures' },
    { power: buff.power, toughness: buff.toughness },
  );
  spec.conditions = [
    { kind: 'source_is_untapped' } as StaticEffectCondition,
    { kind: 'target_is_attacking_source_controller' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushInstantSorceryGyPump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z][a-z' ,.-]{0,40}?) gets ([+-]\d+\s*\/\s*[+-]\d+) for each instant and sorcery cards? in your graveyard/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'instant-sorcery-gy-pump',
    { kind: 'self' },
    {
      power: buff.power,
      toughness: buff.toughness,
      countBasis: 'controller_graveyard_cards_of_type',
      countCardType: 'instant_or_sorcery',
    },
  ));
}

function pushOpponentOwnsExilePump(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) gets ([+-]\d+\s*\/\s*[+-]\d+) as long as an opponent owns a cards? in exile/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  specs.push(buildSpec(
    source,
    'opponent-owns-exile-pump',
    { kind: 'self' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'opponent_owns_card_in_exile' } as StaticEffectCondition,
  ));
}

function pushSnowLandSelfKeyword(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~) has ([a-z][a-z -]*) as long as you control an? snow lands?/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'snow-land-self-keyword',
    { kind: 'self' },
    { abilities },
    {
      kind: 'source_controller_controls_matching',
      cardType: 'snow',
      count: 1,
    } as StaticEffectCondition,
  ));
}

function pushAttackingCreatureTokensKeywords(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(/attacking creature tokens you control have ([^.]+)/);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  const spec = buildSpec(
    source,
    'attacking-creature-tokens-keywords',
    { kind: 'creatures_you_control' },
    { abilities },
  );
  spec.conditions = [
    { kind: 'target_is_token' } as StaticEffectCondition,
    { kind: 'target_is_attacking' } as StaticEffectCondition,
  ];
  specs.push(spec);
}

function pushEnchantedPhasing(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/enchanted permanent has phasing/.test(text)) return;
  specs.push({
    ...buildSpec(source, 'enchanted-phasing', { kind: 'self' }, { abilities: ['phasing'] }),
    sourcePermanentId: hostId,
    scope: { kind: 'self' },
  });
}

function pushEnchantedSpellTargetLock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/enchanted creature can(?:not|'t) be the target of spells/.test(text)) return;
  const abilities = ["can't be the target of spells"];
  if (/can(?:not|'t) be enchanted by other auras/.test(text)) {
    abilities.push("can't be enchanted by other Auras");
  }
  specs.push({
    ...buildSpec(source, 'enchanted-spell-target-lock', { kind: 'self' }, { abilities }),
    sourcePermanentId: hostId,
    scope: { kind: 'self' },
  });
}

function pushSelfAbilityTargetLock(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(
    /(?:this creature|~|[a-z][a-z' ,.-]{0,40}?) can(?:not|'t) be the target of abilities your opponents control/,
  );
  if (!m) return;
  specs.push(buildSpec(
    source,
    'self-ability-target-lock',
    { kind: 'self' },
    { abilities: ["can't be the target of abilities your opponents control"] },
  ));
}

export function pushBatch80LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushUntappedAttackingYouPump(specs, source, oracle);
  pushInstantSorceryGyPump(specs, source, oracle);
  pushOpponentOwnsExilePump(specs, source, oracle);
  pushSnowLandSelfKeyword(specs, source, oracle);
  pushAttackingCreatureTokensKeywords(specs, source, oracle);
  pushEnchantedPhasing(specs, source, perm, oracle);
  pushEnchantedSpellTargetLock(specs, source, perm, oracle);
  pushSelfAbilityTargetLock(specs, source, oracle);
}
