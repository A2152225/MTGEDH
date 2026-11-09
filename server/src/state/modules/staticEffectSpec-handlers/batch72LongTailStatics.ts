// server/src/state/modules/staticEffectSpec-handlers/batch72LongTailStatics.ts
// B72 static long-tail:
//   Kolodin — Mounts and Vehicles you control have haste (any turn)
//   Rohgahh of Kher Keep — creatures you control named <Name> get ±N/±N
//   Aeve — isn't legendary if it's a token
// Public: pushBatch72LongTailStaticSpecs.
// Sibling extensions (same batch, not this file):
//   SelfCounterThreshold or-fewer + otherwise (Spinoderm)
//   SelfStateGrants combat-damage hexproof (Ruric Thar, Magecrusher)
//   R35 noncreature spells cast (Lyse Hext)
//   ExtraConditions battlefield-has (Glacial Crasher)
//   attachmentKeywordGrants enchanted land (Consecrate Land)
//   variablePowerOnlyCalculator CDAs (Dauthi / Wilderness)
//   landsEnterUntappedOverride Gates (Gond Gate)
//   combatDefenderAttackPermission modified (Guardians of Oboro)

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

function pushMountsVehiclesHaste(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  // Batch62 owns "During your turn, Mounts and Vehicles…"; skip those lines here.
  if (/during your turn[, ].*(?:mounts? and vehicles?|vehicles? and mounts?)/i.test(text)
    && !/(?:^|[.\n;])\s*(?:mounts? and vehicles?|vehicles? and mounts?) you control have /i.test(text)) {
    return;
  }
  const m = text.match(
    /(?:^|[.\n;])\s*(?!during your turn)(mounts? and vehicles?|vehicles? and mounts?) you control have ([^.]+)/i,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[2] || '');
  if (!abilities.length) return;
  const id = 'mounts-vehicles-haste';
  if (specs.some((s) => String(s.id || '').endsWith(id))) return;
  const spec = buildSpec(source, id, { kind: 'permanents_you_control' }, { abilities });
  spec.conditions = [{ kind: 'target_has_any_subtype', subtypes: ['mount', 'vehicle'] } as StaticEffectCondition];
  specs.push(spec);
}

function pushNamedCreatureAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*creatures you control named ([a-z0-9' ,.-]+?) get\s+([+-]\d+\s*\/\s*[+-]\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[2] || '');
  const cardName = String(m[1] || '').trim();
  if (!buff || !cardName) return;
  specs.push(buildSpec(
    source,
    `named-creature-anthem:${cardName.replace(/\s+/g, '-')}`,
    { kind: 'creatures_you_control' },
    { power: buff.power, toughness: buff.toughness },
    { kind: 'target_has_name', cardName } as StaticEffectCondition,
  ));
}

function pushTokenNotLegendary(
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
  const re = new RegExp(`(?:${alts.join('|')}) isn'?t legendary if it'?s a token`);
  if (!re.test(text)) return;
  specs.push({
    ...buildSpec(
      source,
      'token-not-legendary',
      { kind: 'self' },
      { notLegendary: true },
      { kind: 'target_is_token' } as StaticEffectCondition,
    ),
    layer: 4,
  });
}

export function pushBatch72LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushMountsVehiclesHaste(specs, source, oracle);
  pushNamedCreatureAnthem(specs, source, oracle);
  pushTokenNotLegendary(specs, source, oracle);
}
