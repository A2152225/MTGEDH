// server/src/state/modules/staticEffectSpecPhase5Eval.ts
// Phase 5: condition kinds and count bases added for chosen modes, source counters and
// non-creature-type lord words. Kept out of staticEffectSpecConditionEval.ts / staticEffectSpec.ts (size).
// Public entry symbols: evalPhase5StaticCondition, resolvePhase5CountMultiplier, sourceChoseOption.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { resolveExtendedCountMultiplier } from './staticEffectSpecCountBases.js';
import { opponentControlsMatching } from './staticEffectSpecOpponentControlsCondition.js';
import { evalZoneCountCondition } from './staticEffectSpecZoneCountConditions.js';
import { evalPhase5StateCondition } from './staticEffectSpecPhase5StateEval.js';
import { evalExtraStaticCondition } from './staticEffectSpecExtraConditions.js';
import { controlsOwnCommander } from './staticEffectSpecCommanderCondition.js';
import { evalEntryLifeCondition } from './staticEffectSpecEntryLifeConditions.js';
import { evalResourceDesignationCondition } from './staticEffectSpec-handlers/staticEffectSpecResourceDesignationConditions.js';

type SpecLike = { sourcePermanentId?: string; effectSourcePermanentId?: string; sourceController?: string; grant?: { countBasis?: string; countCounterType?: string; countOnEffectSource?: boolean } };
type CondLike = { kind?: string; color?: string; cardType?: string; option?: string; counterType?: string; amount?: number };

function findSource(spec: SpecLike, battlefield: readonly BattlefieldPermanent[] | undefined): any {
  const id = String(spec.sourcePermanentId || '').trim();
  return id ? (battlefield || []).find((perm) => String(perm.id || '') === id) : undefined;
}

function counterCount(source: any, counterType: string): number {
  const wanted = String(counterType || '').trim().toLowerCase();
  const counters = (source?.counters || {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(counters)) {
    if (key.toLowerCase().replace(/_/g, ' ') === wanted) return Math.max(0, Number(value) || 0);
  }
  return 0;
}

/** Chosen-mode match: "As this enters, choose Jeskai or Temur" / "choose two abilities" (Ano'thr). */
export function sourceChoseOption(source: any, option: string): boolean {
  const wanted = String(option || '').trim().toLowerCase().replace(/[.\s]+$/, '');
  if (!wanted || !source) return false;
  const raw = Array.isArray(source.chosenOptions) ? source.chosenOptions : [source.chosenOption, source.chosenMode];
  return raw.some((value: unknown) => {
    const chosen = String(value || '').trim().toLowerCase().replace(/^\u2022\s*/, '').replace(/[.\s]+$/, '');
    if (!chosen) return false;
    return chosen === wanted || (chosen.length >= 4 && (wanted.startsWith(chosen) || chosen.startsWith(wanted)));
  });
}

/** Returns undefined for kinds this module does not own. */
export function evalPhase5StaticCondition(
  condition: CondLike,
  permanent: BattlefieldPermanent,
  spec: SpecLike,
  battlefield: readonly BattlefieldPermanent[] | undefined,
  state?: unknown,
): boolean | undefined {
  switch (condition.kind) {
    case 'target_lacks_type': {
      const cardType = String(condition.cardType || '').trim().toLowerCase().replace(/[^a-z]/g, '');
      if (!cardType) return false;
      const typeLine = String((permanent.card as any)?.type_line || (permanent as any).type_line || '').toLowerCase();
      return !new RegExp(`\\b${cardType}\\b`).test(typeLine);
    }
    case 'opponent_controls_matching':
      return opponentControlsMatching(condition, String(spec.sourceController || ''), battlefield || [], state);
    case 'target_entered_this_turn':
    case 'source_controller_life_at_most_half_starting':
      return evalEntryLifeCondition(condition.kind, permanent, String(spec.sourceController || ''), state);
    case 'controls_your_commander':
      return controlsOwnCommander(String(spec.sourceController || ''), battlefield || [], state);
    case 'source_chose_option':
      return sourceChoseOption(findSource(spec, battlefield), String(condition.option || ''));
    case 'source_counter_at_least':
      return counterCount(findSource(spec, battlefield), String(condition.counterType || '')) >= Number(condition.amount || 0);
    default:
      return evalExtraStaticCondition(condition, permanent, battlefield || [], state)
        ?? evalPhase5StateCondition(condition as any, permanent, findSource(spec, battlefield), String(spec.sourceController || ''), battlefield || [], state as any)
        ?? evalResourceDesignationCondition(condition, String(spec.sourceController || ''), state)
        ?? evalZoneCountCondition(condition, String(spec.sourceController || ''), battlefield || [], state);
  }
}

export function resolvePhase5CountMultiplier(
  spec: SpecLike,
  battlefield: readonly BattlefieldPermanent[],
  state?: unknown,
): number {
  const extended = resolveExtendedCountMultiplier(spec, battlefield, state);
  if (extended !== undefined) return extended;
  if (spec.grant?.countBasis === 'controller_commander_casts') {
    const zone = (state as any)?.commandZone?.[String(spec.sourceController || '')];
    return Math.max(0, Math.floor(Number(zone?.tax || 0) / 2));
  }
  if (spec.grant?.countBasis !== 'source_counters') return 1;
  const holder = spec.grant.countOnEffectSource && spec.effectSourcePermanentId
    ? { sourcePermanentId: spec.effectSourcePermanentId }
    : spec;
  return counterCount(findSource(holder, battlefield), String(spec.grant.countCounterType || ''));
}