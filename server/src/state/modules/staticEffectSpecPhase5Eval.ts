// server/src/state/modules/staticEffectSpecPhase5Eval.ts
// Phase 5: condition kinds and count bases added for chosen modes, source counters and
// non-creature-type lord words. Kept out of staticEffectSpecConditionEval.ts / staticEffectSpec.ts (size).
// Public entry symbols: evalPhase5StaticCondition, resolvePhase5CountMultiplier, sourceChoseOption.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { resolveExtendedCountMultiplier } from './staticEffectSpecCountBases.js';
import { opponentControlsMatching } from './staticEffectSpecOpponentControlsCondition.js';
import { opponentControlsCreatureWithKeywordExcludingName } from './opponentKeywordMirrorEval.js';
import { evalZoneCountCondition } from './staticEffectSpecZoneCountConditions.js';
import { evalPhase5StateCondition } from './staticEffectSpecPhase5StateEval.js';
import { evalExtraStaticCondition } from './staticEffectSpecExtraConditions.js';
import { isStationPermanentCreatureNow } from '../../../../rules-engine/src/stationPermanentUtils.js';
import { controlsOwnCommander } from './staticEffectSpecCommanderCondition.js';
import { evalEntryLifeCondition } from './staticEffectSpecEntryLifeConditions.js';
import { evalOpponentStateCondition } from './staticEffectSpecOpponentStateConditions.js';
import { evalResourceDesignationCondition } from './staticEffectSpec-handlers/staticEffectSpecResourceDesignationConditions.js';
import { evalTargetControllerChoseOptionOnSource } from './staticEffectSpec-handlers/playerChoseWarPeaceAnthems.js';
import { evalTargetIsAttackingLastChosenPlayerOnSource } from './staticEffectSpec-handlers/batch63AttackChosenPlayerGrants.js';

type SpecLike = { sourcePermanentId?: string; effectSourcePermanentId?: string; sourceController?: string; grant?: { countBasis?: string; countCounterType?: string; countOnEffectSource?: boolean } };
type CondLike = { kind?: string; color?: string; cardType?: string; option?: string; counterType?: string; amount?: number; exact?: boolean };

function findSource(spec: SpecLike, battlefield: readonly BattlefieldPermanent[] | undefined): any {
  const id = String(spec.sourcePermanentId || '').trim();
  return id ? (battlefield || []).find((perm) => String(perm.id || '') === id) : undefined;
}

function counterCount(source: any, counterType: string): number {
  const wanted = String(counterType || '').trim().toLowerCase();
  const counters = (source?.counters || {}) as Record<string, unknown>;
  if (!wanted || wanted === 'any') return Object.values(counters).reduce<number>((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
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
      if (cardType === 'creature' && /\b(?:spacecraft|planet)\b/.test(typeLine) && !/\bcreature\b/.test(typeLine)) {
        return !isStationPermanentCreatureNow(permanent as any, String((permanent.card as any)?.oracle_text || ''));
      }
      return !new RegExp(`\\b${cardType}\\b`).test(typeLine);
    }
    case 'opponent_controls_matching':
      return opponentControlsMatching(condition, String(spec.sourceController || ''), battlefield || [], state);
    case 'opponent_controls_creature_with_keyword_excluding_name':
      return opponentControlsCreatureWithKeywordExcludingName(condition as any, String(spec.sourceController || ''), battlefield || []);
    case 'target_entered_this_turn':
    case 'source_controller_life_at_most_half_starting':
      return evalEntryLifeCondition(condition.kind, permanent, String(spec.sourceController || ''), state);
    case 'controls_your_commander':
      return controlsOwnCommander(String(spec.sourceController || ''), battlefield || [], state);
    case 'source_chose_option':
      return sourceChoseOption(findSource(spec, battlefield), String(condition.option || ''));
    case 'target_controller_chose_option_on_source':
      return evalTargetControllerChoseOptionOnSource(condition as any, permanent, findSource(spec, battlefield));
    case 'target_is_attacking_last_chosen_player_on_source':
      return evalTargetIsAttackingLastChosenPlayerOnSource(condition, permanent, findSource(spec, battlefield));
    case 'target_has_any_subtype': {
      const wanted = Array.isArray((condition as any).subtypes) ? (condition as any).subtypes : [];
      const line = String((permanent.card as any)?.type_line || (permanent as any).type_line || '').toLowerCase();
      return wanted.some((sub: string) => {
        const word = String(sub || '').toLowerCase().trim();
        return !!word && new RegExp('\\b' + word.replace(/[^a-z0-9-]/g, '') + 's?\\b').test(line);
      });
    }
    case 'source_attachment_count': {
      const hostId = String(spec.sourcePermanentId || '');
      const sub = String(condition.cardType || 'aura').toLowerCase();
      const n = (battlefield || []).filter((p: any) => hostId && String(p?.attachedTo || '') === hostId
        && new RegExp('\\b' + sub + '\\b').test(String(p?.card?.type_line || p?.type_line || '').toLowerCase())).length;
      return condition.exact ? n === Number(condition.amount || 0) : n >= Number(condition.amount || 0);
    }
    case 'source_counter_at_least':
      return counterCount(findSource(spec, battlefield), String(condition.counterType || '')) >= Number(condition.amount || 0);
    case 'source_counter_at_most':
      return counterCount(findSource(spec, battlefield), String(condition.counterType || '')) <= Number(condition.amount || 0);
    case 'battlefield_has_matching': {
      const wanted = String(condition.cardType || '').trim().toLowerCase();
      if (!wanted) return false;
      return (battlefield || []).some((p: any) => p && !p.phasedOut
        && new RegExp('\\b' + wanted.replace(/s$/, '') + 's?\\b').test(String(p?.card?.type_line || p?.type_line || '').toLowerCase()));
    }
    default:
      return evalExtraStaticCondition(condition, permanent, battlefield || [], state)
        ?? evalPhase5StateCondition(condition as any, permanent, findSource(spec, battlefield), String(spec.sourceController || ''), battlefield || [], state as any)
        ?? evalResourceDesignationCondition(condition, String(spec.sourceController || ''), state)
        ?? evalOpponentStateCondition(condition, String(spec.sourceController || ''), battlefield || [], state)
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