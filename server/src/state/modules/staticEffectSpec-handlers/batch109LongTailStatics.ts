// server/src/state/modules/staticEffectSpec-handlers/batch109LongTailStatics.ts
// B109 long-tail static specs. Public: parseBatch109LongTailStaticKind,
// pushBatch109LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseAttackAsThoughNoDefenderIfCastNoncreature,
  parseCantAttackUnlessNOtherCreaturesAttack,
  parseCantBlockUnlessNOtherCreaturesBlock,
  parseControlEitherColorSelfPTAndFirstStrike,
  parseHexproofIfYouHaventCastASpell,
  parseIfThisAttacksAllYouControlAttackIfAble,
  parseNonartifactCreaturesShareAColorPT,
  parseSnowPermanentsDontUntap,
  parseTypalYouControlCantBeBlockedExceptBySameTypal,
  parseYouHaveProtectionFromEachOpponent,
} from '../batch109Parsers.js';

export function parseBatch109LongTailStaticKind(oracle: string): string | null {
  if (parseNonartifactCreaturesShareAColorPT(oracle)) return 'share_a_color_pt';
  if (parseControlEitherColorSelfPTAndFirstStrike(oracle)) return 'either_color_first_strike';
  if (parseHexproofIfYouHaventCastASpell(oracle)) return 'hexproof_no_spell';
  if (parseAttackAsThoughNoDefenderIfCastNoncreature(oracle)) return 'defender_if_noncreature_spell';
  if (parseYouHaveProtectionFromEachOpponent(oracle)) return 'protection_from_opponents';
  if (parseTypalYouControlCantBeBlockedExceptBySameTypal(oracle)) return 'typal_except_same';
  if (parseCantAttackUnlessNOtherCreaturesAttack(oracle)) return 'attack_unless_n_others';
  if (parseCantBlockUnlessNOtherCreaturesBlock(oracle)) return 'block_unless_n_others';
  if (parseIfThisAttacksAllYouControlAttackIfAble(oracle)) return 'attacks_forces_all';
  if (parseSnowPermanentsDontUntap(oracle)) return 'snow_dont_untap';
  return null;
}

export function pushBatch109LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: BattlefieldPermanent,
  oracle: string,
): void {
  const text = String(oracle || '');
  if (!text.trim()) return;
  const kind = parseBatch109LongTailStaticKind(text);
  if (!kind) return;
  specs.push(buildSpec(source, `batch109-${kind}`, { kind: 'self' }, { abilities: [kind] } as any));
}
