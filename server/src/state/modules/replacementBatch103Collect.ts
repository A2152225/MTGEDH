// server/src/state/modules/replacementBatch103Collect.ts
// B103 replacement collect: Blood Scrivener empty-hand draw, Rollercrusher
// delirium noncombat double, Swans prevent-and-draw, Jared monarch prevent
// plus counters, Rock Hydra damage-for-counters, and Vedalken dice exchange.
// Wired through collectReplacementEffectSpecsFromState and the live draw /
// damage apply hooks in batch103Apply. Public: collectBatch103ReplacementSpecs,
// collectBatch103ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  parseEmptyHandDrawTwoLoseLife,
  parseDeliriumDoubleNoncombatDamage,
  parsePreventDamageControllerDraws,
  parsePreventDamageWhileMonarchPlusCounters,
  parseDamageRemovesP1P1AndPrevents,
} from './batch102Parsers.js';
import { parseDiceExchangeWithBasePT } from './batch103Parsers.js';

export function collectBatch103ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const asSpec = (spec: object) => (spec as unknown) as ReplacementEffectSpec;
  if (parseEmptyHandDrawTwoLoseLife(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:empty-hand-draw-two-lose-life`,
      event: 'draw',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { drawingPlayerIsSourceController: true, playerHasNoCardsInHand: true } as any,
      instead: { modify: 'add_flat', value: 1, loseLife: 1 },
      effectId: 'empty-hand-draw-two-lose-life',
      reason: 'empty_hand_draw_two_lose_life',
      metadata: { loseLife: 1, requiresEmptyHand: true },
    }));
  }
  if (parseDeliriumDoubleNoncombatDamage(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:delirium-double-noncombat`,
      event: 'damage',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { dealingPlayerIsSourceController: true, noncombatDamageOnly: true, requiresDelirium: true } as any,
      instead: { modify: 'double' },
      effectId: 'delirium-double-noncombat',
      reason: 'delirium_double_noncombat',
    }));
  }
  if (parsePreventDamageControllerDraws(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:prevent-damage-controller-draws`,
      event: 'damage-prevention-cost',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { damageTargetIsSource: true } as any,
      instead: { prevent: true, sourceControllerDrawsPrevented: true },
      effectId: 'prevent-damage-controller-draws',
      reason: 'prevent_damage_controller_draws',
      metadata: { sourceControllerDrawsPrevented: true },
    }));
  }
  if (parsePreventDamageWhileMonarchPlusCounters(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:prevent-damage-monarch-plus-counters`,
      event: 'damage-prevention-cost',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { damageTargetIsSource: true, sourceControllerIsMonarch: true } as any,
      instead: { prevent: true, addCountersInstead: true },
      effectId: 'prevent-damage-monarch-plus-counters',
      reason: 'prevent_damage_monarch_plus_counters',
      metadata: { addCountersInstead: true, counter: '+1/+1', requiresMonarch: true },
    }));
  }
  if (parseDamageRemovesP1P1AndPrevents(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:damage-removes-p1p1-prevents`,
      event: 'damage-prevention-cost',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { damageTargetIsSource: true } as any,
      instead: { preventPerCounter: true },
      effectId: 'damage-removes-p1p1-prevents',
      reason: 'damage_removes_p1p1_prevents',
      metadata: { requiresCounter: true, removeMode: 'each', counter: '+1/+1' },
    }));
  }
  if (parseDiceExchangeWithBasePT(text)) {
    const parsed = parseDiceExchangeWithBasePT(text)!;
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:dice-exchange-base-pt`,
      event: 'die-roll' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { sides: parsed.sides, affectedPlayerIsSourceController: true } as any,
      instead: { modify: 'exchange_one_with_base_pt' } as any,
      effectId: 'dice-exchange-base-pt',
      reason: 'dice_exchange_base_pt',
      metadata: { sides: parsed.sides, choiceRequired: true },
    }));
  }
  return specs;
}

export function collectBatch103ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch103ReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
