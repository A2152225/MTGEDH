// server/src/state/modules/staticEffectSpec-handlers/batch70LongTailStatics.ts
// B70 static long-tail:
//   Gargantuan Slabhorn — other transformed permanents you control have keywords
//   Koll — creature tokens you control that are enchanted or equipped get +N/+N
//   Animate Artifact — enchanted artifact (if not a creature) is an artifact creature with P/T = MV
// Public: pushBatch70LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import {
  buildSpec,
  parseBuffSegment,
  parseLordAbilitiesFromTail,
  type StaticEffectSpecSource,
} from './staticEffectSpecOracleParseHelpers.js';

function pushOtherTransformedKeywordLord(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*other transformed permanents you control have\s+([^.]+)/,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'other-transformed-keyword-lord',
    { kind: 'other_permanents_you_control', qualifier: { transformed: true } } as any,
    { abilities },
  ));
}

function pushEnchantedOrEquippedTokenAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /(?:^|[.\n;])\s*creature tokens you control that are enchanted or equipped get\s+(\+\d+\s*\/\s*\+\d+)/,
  );
  if (!m) return;
  const buff = parseBuffSegment(m[1] || '');
  if (!buff) return;
  const spec = buildSpec(
    source,
    'enchanted-or-equipped-token-anthem',
    { kind: 'creatures_you_control', qualifier: { token: true } } as any,
    { power: buff.power, toughness: buff.toughness },
  );
  spec.conditions = [{ kind: 'target_is_enchanted_or_equipped' } as StaticEffectCondition];
  specs.push(spec);
}

/**
 * Animate Artifact:
 * "As long as enchanted artifact isn't a creature, it's an artifact creature with
 * power and toughness each equal to its mana value."
 */
function pushAnimateArtifactHost(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  if (!hostId) return;
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/as long as enchanted artifact isn'?t a creature, it'?s an artifact creature with power and toughness each equal to its mana value/.test(text)) {
    return;
  }
  const cond = { kind: 'target_lacks_type', cardType: 'creature' } as StaticEffectCondition;
  const toHost = (id: string, grant: Record<string, unknown>, layer?: 4 | 7) => {
    if (specs.some((s) => s.id.endsWith(id))) return;
    const spec = {
      ...buildSpec(source, id, { kind: 'self' }, grant as any, cond),
      sourcePermanentId: hostId,
      effectSourcePermanentId: source.sourcePermanentId,
      scope: { kind: 'self' as const },
      ...(layer ? { layer } : {}),
    };
    specs.push(spec);
  };
  toHost('animate-artifact-type', { typeAdditions: ['Creature'] }, 4);
  toHost('animate-artifact-mv-pt', { setPowerToughnessFromManaValue: true });
}

export function pushBatch70LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushOtherTransformedKeywordLord(specs, source, oracle);
  pushEnchantedOrEquippedTokenAnthem(specs, source, oracle);
  pushAnimateArtifactHost(specs, source, perm, oracle);
}
