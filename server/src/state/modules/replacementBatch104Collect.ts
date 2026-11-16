// server/src/state/modules/replacementBatch104Collect.ts
// B104 replacement collect: as-though combat permissions, Uncivil Unrest
// damage double, and Hostility spell-damage prevention. Wired through
// collectReplacementEffectSpecsFromState and applyBatch104DamageSideEffects
// / combat hooks. Public: collectBatch104ReplacementSpecs,
// collectBatch104ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  parseTappedCreaturesYouControlCanBlockAsThoughUntapped,
  parseCanAttackAsThoughNoDefenderIfScriedOrSurveilled,
  parseCanAttackAsThoughNoDefenderIfNoCardsInHand,
  parseCreatureWithP1P1DealsDoubleDamage,
  parseSpellYouControlDamageToOpponentPrevent,
} from './batch104Parsers.js';

export function collectBatch104ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const asSpec = (spec: object) => (spec as unknown) as ReplacementEffectSpec;
  if (parseTappedCreaturesYouControlCanBlockAsThoughUntapped(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:block-as-though-untapped`,
      event: 'combat' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { controllerCreatures: true } as any,
      instead: { asThough: 'untapped_for_block' } as any,
      effectId: 'block-as-though-untapped',
      reason: 'block_as_though_untapped',
    }));
  }
  if (parseCanAttackAsThoughNoDefenderIfScriedOrSurveilled(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:attack-as-though-no-defender-scried-surveilled`,
      event: 'combat' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { self: true, scriedOrSurveilledThisTurn: true } as any,
      instead: { asThough: 'no_defender' } as any,
      effectId: 'attack-as-though-no-defender-scried-surveilled',
      reason: 'attack_as_though_no_defender_scried_surveilled',
    }));
  }
  if (parseCanAttackAsThoughNoDefenderIfNoCardsInHand(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:attack-as-though-no-defender-empty-hand`,
      event: 'combat' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { self: true, emptyHand: true } as any,
      instead: { asThough: 'no_defender' } as any,
      effectId: 'attack-as-though-no-defender-empty-hand',
      reason: 'attack_as_though_no_defender_empty_hand',
    }));
  }
  if (parseCreatureWithP1P1DealsDoubleDamage(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:p1p1-creature-deals-double`,
      event: 'damage',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { dealingPlayerIsSourceController: true, sourceHasP1P1Counter: true } as any,
      instead: { modify: 'double' },
      effectId: 'p1p1-creature-deals-double',
      reason: 'p1p1_creature_deals_double',
    }));
  }
  if (parseSpellYouControlDamageToOpponentPrevent(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:spell-you-control-damage-to-opponent-prevent`,
      event: 'damage',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { dealingPlayerIsSourceController: true, damageIsFromSpell: true, receiverIsOpponent: true } as any,
      instead: { prevent: true },
      effectId: 'spell-you-control-damage-to-opponent-prevent',
      reason: 'spell_you_control_damage_to_opponent_prevent',
    }));
  }
  return specs;
}

export function collectBatch104ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch104ReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
