// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingPhase5Supplement.ts
// Phase 5: supplemental declarative parsers that run after the core oracle parser
// (which has early returns). Each pusher must dedupe against specs already present.
// Public entry symbols: pushPhase5SupplementalSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpec.js';
import { sanitizeOracleTextForStaticEffectScan } from '../../../../../rules-engine/src/staticEffectOracleSanitize.js';
import { pushSubtypeListLordSpecs } from './staticEffectSpecOracleParsingSubtypeListLords.js';
import { pushGlobalTypeAdditionSpecs } from './staticEffectSpecOracleParsingGlobalTypeAdditions.js';
import { pushChosenModeSpecs } from './staticEffectSpecOracleParsingChosenModes.js';
import { parsePhase5LordCondition, pushConditionalSelfBecomesSpecs } from './staticEffectSpecOracleParsingPhase5Conditions.js';

export function pushPhase5SupplementalSpecs(
  specs: StaticEffectSpec[],
  perm: BattlefieldPermanent,
  parse?: (perm: BattlefieldPermanent) => StaticEffectSpec[],
): StaticEffectSpec[] {
  const oracleText = String((perm as any)?.card?.oracle_text || (perm as any)?.oracle_text || '').trim();
  const sourcePermanentId = String(perm?.id || '').trim();
  const sourceController = String(perm?.controller || '').trim();
  if (!oracleText || !sourcePermanentId || !sourceController) return specs;
  const source = {
    sourcePermanentId,
    sourceController,
    sourceName: String((perm as any)?.card?.name || (perm as any)?.name || 'Unknown').trim(),
  };
  const oracle = sanitizeOracleTextForStaticEffectScan(oracleText).toLowerCase();
  pushSubtypeListLordSpecs(specs, source, oracle);
  pushGlobalTypeAdditionSpecs(specs, source, oracle);
  pushConditionalSelfBecomesSpecs(specs, source, oracle, (raw) => parsePhase5LordCondition(raw, source.sourceName));
  if (parse) pushChosenModeSpecs(specs, perm, oracle, parse);
  return specs;
}