// server/src/state/modules/replacementBatch101Collect.ts
// B101 replacement-effect collect for Essence (enter as copy), Esix (first
// tokens), Land Equilibrium, Shield of the Avatar, and Fear of Sleep Paralysis
// (stun-lock is applied at untap, but the replacement-adjacent sentence is
// still collected so census marks it handled).
// Public: collectBatch101ReplacementSpecs, collectBatch101ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  parseEssenceEnterAsCopy,
  parseEsixFirstTokensCopy,
  parseLandEquilibrium,
  parseStunCountersCantBeRemovedFromOpponents,
  parseShieldPreventXCreatures,
} from './batch101Parsers.js';

export function collectBatch101ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  if (parseEssenceEnterAsCopy(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:essence-enter-as-copy`,
      event: 'enters-battlefield',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { controllerIsSourceController: true, enteringIsCreature: true, enteringIsNotSource: true },
      instead: {},
      effectId: 'enter-as-copy-of-source',
      reason: 'essence_enter_as_copy',
    } as unknown as ReplacementEffectSpec);
  }
  if (parseEsixFirstTokensCopy(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:esix-first-tokens`,
      event: 'create-token',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { controllerIsSourceController: true, firstTokensThisTurn: true, duringSourceControllersTurn: true },
      instead: {},
      effectId: 'optional-esix-first-tokens-this-turn',
      reason: 'esix_first_tokens_copy',
    } as unknown as ReplacementEffectSpec);
  }
  if (parseLandEquilibrium(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:land-equilibrium`,
      event: 'land-enters',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { enteringControllerIsOpponent: true, enteringControllerHasAtLeastAsManyLands: true },
      instead: {},
      effectId: 'land-enters-then-sacrifice-a-land',
      reason: 'land_equilibrium_sacrifice',
    } as unknown as ReplacementEffectSpec);
  }
  if (parseStunCountersCantBeRemovedFromOpponents(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:opponent-stun-lock`,
      event: 'remove-counter',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { counterKind: 'stun', permanentControllerIsOpponent: true },
      instead: { skipEvent: true },
      effectId: 'cannot-remove-stun-from-opponents-permanents',
      reason: 'opponent_stun_counters_locked',
    } as unknown as ReplacementEffectSpec);
  }
  if (parseShieldPreventXCreatures(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:shield-prevent-x-creatures`,
      event: 'damage-prevention-cost',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { receivingIsEquippedBySource: true },
      instead: {},
      effectId: 'prevent-x-damage-to-equipped-equal-to-creatures',
      reason: 'prevent_x_damage_to_equipped_creatures_you_control',
      metadata: { preventCountBasis: 'controller_creatures' },
    } as unknown as ReplacementEffectSpec);
  }
  return specs;
}

export function collectBatch101ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string; oracleText?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch101ReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
