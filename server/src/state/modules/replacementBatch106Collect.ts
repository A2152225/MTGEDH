// server/src/state/modules/replacementBatch106Collect.ts
// B106 replacement collect: would-die exile with named counters, and
// combat-damage-to-player instead counters + mill (Szadek family).
// Public: collectBatch106ReplacementSpecs, collectBatch106ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  parseWouldDieInsteadExileWithNamedCounters,
  parseWouldDealCombatDamageToPlayerInsteadCountersAndMill,
} from './batch106Parsers.js';

export function collectBatch106ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const asSpec = (spec: object) => (spec as unknown) as ReplacementEffectSpec;

  const dieExile = parseWouldDieInsteadExileWithNamedCounters(text);
  if (dieExile) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:would-die-instead-exile-with-named-counters`,
      event: 'zone-change' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectIsSource: true },
      instead: { redirectZone: 'exile' },
      effectId: 'would-die-instead-exile-with-named-counters',
      reason: 'would_die_instead_exile_with_named_counters',
      metadata: {
        namedCountersOnExile: dieExile,
        sourcePermanentId: source.sourcePermanentId,
      },
    }));
  }

  if (parseWouldDealCombatDamageToPlayerInsteadCountersAndMill(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:combat-damage-to-player-instead-counters-and-mill`,
      event: 'damage' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: {
        combatDamageOnly: true,
        damageSourceIsSource: true,
        receivingIsPlayerOnly: true,
      } as any,
      instead: { countersAndMillEqualToDamage: true } as any,
      effectId: 'combat-damage-to-player-instead-counters-and-mill',
      reason: 'combat_damage_to_player_instead_counters_and_mill',
    }));
  }

  return specs;
}

export function collectBatch106ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; card?: unknown; phasedOut?: boolean };
    if (rec.phasedOut === true) continue;
    const oracle = readCardOracleText(rec.card) || readCardOracleText(perm);
    if (!oracle) continue;
    specs.push(...collectBatch106ReplacementSpecs(oracle, {
      sourcePermanentId: String(rec.id || ''),
      sourceController: String(rec.controller || ''),
      sourceName: String((rec.card as { name?: string } | undefined)?.name || ''),
    }));
  }
  return specs;
}
