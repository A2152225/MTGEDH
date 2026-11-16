// server/src/state/modules/replacementBatch109Collect.ts
// B109 replacement collect: Bilbo food+treasure, Goldnight doubles,
// Shield of the Realm prevent-N, and census markers for Ojer Axonil and Camel.
// Ojer and Camel change the amount in batch109Apply (floor / desert prevent);
// the marker specs have no modify so they are not applied twice.
// Public: collectBatch109ReplacementSpecs, collectBatch109DamageReplacementSpecsFromState,
// collectBatch109TokenReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  parseDamageToThisCreatureIsDoubled,
  parseDamageToYouIsDoubled,
  parseFoodTokenAlsoCreatesTreasure,
  parsePreventDesertDamageWhileAttacking,
  parsePreventNDamageToEquipped,
  parseColorSourceNoncombatDamageRaisedToPower,
  parseYouHaveProtectionFromEachOpponent,
} from './batch109Parsers.js';

function asSpec(spec: object): ReplacementEffectSpec {
  return spec as unknown as ReplacementEffectSpec;
}

function battlefieldOf(state: unknown): any[] {
  return Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? ((state as { battlefield: unknown[] }).battlefield as any[])
    : [];
}

export function collectBatch109ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const base = {
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
  if (parseDamageToYouIsDoubled(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:damage-to-you-double`,
      event: 'damage',
      match: { receivingIsPlayerOnly: true, receivingPlayerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'damage-to-you-double',
      reason: 'damage_to_you_double',
    }));
  }
  if (parseDamageToThisCreatureIsDoubled(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:damage-to-self-double`,
      event: 'damage',
      match: { receivingPermanentIsSource: true },
      instead: { modify: 'double' },
      effectId: 'damage-to-self-double',
      reason: 'damage_to_self_double',
    }));
  }
  const preventEquipped = parsePreventNDamageToEquipped(text);
  if (preventEquipped) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:prevent-n-to-equipped`,
      event: 'damage',
      match: { receivingPermanentIsEquippedBySource: true },
      instead: { modify: 'add_flat', value: -preventEquipped },
      effectId: 'prevent-n-damage-to-equipped',
      reason: 'prevent_n_damage_to_equipped',
    }));
  }
  if (parseYouHaveProtectionFromEachOpponent(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:protection-from-opponents`,
      event: 'damage',
      match: {
        receivingIsPlayerOnly: true,
        receivingPlayerIsSourceController: true,
        damageSourceControllerIsOpponentOfSource: true,
      },
      instead: { modify: 'cap', value: 0 },
      effectId: 'protection-from-each-opponent',
      reason: 'protection_from_each_opponent',
    }));
  }
  if (parseColorSourceNoncombatDamageRaisedToPower(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:raise-noncombat-to-power`,
      event: 'damage',
      match: {},
      instead: {},
      effectId: 'raise-noncombat-damage-to-source-power',
      reason: 'raise_noncombat_damage_to_source_power',
    }));
  }
  if (parsePreventDesertDamageWhileAttacking(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:prevent-desert-damage-while-attacking`,
      event: 'damage',
      match: {},
      instead: {},
      effectId: 'prevent-desert-damage-while-attacking',
      reason: 'prevent_desert_damage_while_attacking',
    }));
  }
  if (parseFoodTokenAlsoCreatesTreasure(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:food-plus-treasure`,
      event: 'token-creation',
      match: { creatingPlayerIsSourceController: true, tokenNameIs: 'food' },
      instead: { modify: 'add_flat', value: 0 },
      effectId: 'food-token-also-treasure',
      reason: 'food_token_also_treasure',
      metadata: { createAdditionalTokenNamed: 'treasure' },
    }));
  }
  return specs;
}

function collectFromState(state: unknown, event: 'damage' | 'token-creation'): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  for (const perm of battlefieldOf(state)) {
    if (!perm || typeof perm !== 'object' || !perm.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    if (!sourcePermanentId) continue;
    const oracle = readCardOracleText(perm.card) || String(perm.oracle_text || '');
    if (!oracle) continue;
    specs.push(...collectBatch109ReplacementSpecs(oracle, {
      sourcePermanentId,
      sourceController: String(perm.controller || '').trim(),
      sourceName: String(perm.card?.name || 'Unknown').trim(),
    }).filter((spec) => spec.event === event));
  }
  return specs;
}

export function collectBatch109DamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return collectFromState(state, 'damage');
}

export function collectBatch109TokenReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return collectFromState(state, 'token-creation');
}
