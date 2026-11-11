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

type SpecLike = { sourcePermanentId?: string; effectSourcePermanentId?: string; sourceController?: string; grant?: { countBasis?: string; countCounterType?: string; countOnEffectSource?: boolean; countDivisor?: number } };
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
    case 'target_has_counter_at_least': {
      // B85: Runadi — creatures you control with three or more +1/+1 counters.
      const amount = Number(condition.amount || 0);
      if (!(amount > 0)) return false;
      return counterCount(permanent, String(condition.counterType || '')) >= amount;
    }
    case 'source_controller_sacrificed_artifact_this_turn': {
      // B85: Furtive Courier.
      const controller = String(spec.sourceController || '');
      if (!controller) return false;
      return Number((state as any)?.artifactsSacrificedThisTurn?.[controller] || 0) > 0;
    }
    case 'target_is_attacking_or_blocking': {
      // B86: Tromokratis.
      const attacking = (permanent as any)?.attacking != null && (permanent as any)?.attacking !== false;
      const blocking = (permanent as any)?.blocking != null && (permanent as any)?.blocking !== false
        || (permanent as any)?.isBlocking === true
        || Array.isArray((permanent as any)?.blockedAttackerIds) && (permanent as any).blockedAttackerIds.length > 0;
      return attacking || blocking;
    }
    case 'defending_player_controls_most_creatures': {
      // B86: Hooded Horror — while attacking, defending player has >= max creature count.
      const attacking = (permanent as any)?.attacking;
      if (attacking == null || attacking === false) return false;
      const bf = battlefield || [];
      const defendingId = (() => {
        const t = String(attacking);
        if (bf.some((p: any) => p && String(p.id) === t)) {
          return String(bf.find((p: any) => p && String(p.id) === t)?.controller || '');
        }
        return t;
      })();
      if (!defendingId) return false;
      const counts = new Map<string, number>();
      for (const p of bf) {
        if (!p || p.phasedOut) continue;
        if (!/\bcreature\b/i.test(String(p?.card?.type_line || ''))) continue;
        const c = String(p.controller || '');
        if (!c) continue;
        counts.set(c, (counts.get(c) || 0) + 1);
      }
      const defCount = counts.get(defendingId) || 0;
      let max = 0;
      for (const n of counts.values()) if (n > max) max = n;
      return defCount >= max && defCount > 0;
    }
    case 'opponent_dealt_damage_this_turn': {
      // B87: Bloodcrazed Goblin — proxy via lifeLostThisTurn on any other player.
      const controller = String(spec.sourceController || '');
      const lost = (state as any)?.lifeLostThisTurn || {};
      return Object.keys(lost).some((id) => id !== controller && Number(lost[id] || 0) > 0);
    }
    case 'target_is_paired_with_soulbond': {
      // B87: Flowering Lumberknot.
      const partnerId = String((permanent as any)?.pairedWith || (permanent as any)?.pairedTo || '').trim();
      if (!partnerId) return false;
      const partner = (battlefield || []).find((p: any) => p && String(p.id) === partnerId);
      if (!partner) return false;
      const text = String(partner?.card?.oracle_text || partner?.oracle_text || '').toLowerCase();
      const kws = Array.isArray(partner?.keywords) ? partner.keywords : Array.isArray(partner?.card?.keywords) ? partner.card.keywords : [];
      return /\bsoulbond\b/.test(text) || kws.some((k: any) => String(k).toLowerCase() === 'soulbond');
    }
    case 'source_controller_controls_artifact_creature_or_subtype': {
      // B87: Doctor Doom — artifact creature OR a Plan (subtype).
      const controller = String(spec.sourceController || '');
      const sub = String((condition as any).creatureType || '').toLowerCase();
      if (!controller) return false;
      return (battlefield || []).some((p: any) => {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) return false;
        const tl = String(p?.card?.type_line || '').toLowerCase();
        if (/\bartifact\b/.test(tl) && /\bcreature\b/.test(tl)) return true;
        return !!sub && new RegExp('\\b' + sub + 's?\\b').test(tl);
      });
    }
    case 'controller_creatures_distinct_counter_kinds_at_least': {
      // B87: Hundred-Battle Veteran.
      const controller = String(spec.sourceController || '');
      const amount = Number(condition.amount || 0);
      if (!controller || !(amount > 0)) return false;
      const kinds = new Set<string>();
      for (const p of battlefield || []) {
        if (!p || p.phasedOut || String(p.controller || '') !== controller) continue;
        if (!/\bcreature\b/i.test(String(p?.card?.type_line || ''))) continue;
        const counters = (p.counters || {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(counters)) {
          if (Number(value) > 0) kinds.add(String(key).toLowerCase());
        }
      }
      return kinds.size >= amount;
    }
    case 'source_controller_creatures_died_this_turn_at_least': {
      // B87: Gimli.
      const controller = String(spec.sourceController || '');
      const amount = Number(condition.amount || 0);
      if (!controller || !(amount > 0)) return false;
      return Number((state as any)?.creaturesDiedThisTurnByController?.[controller] || 0) >= amount;
    }
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

function applyCountDivisor(raw: number, grant: { countDivisor?: number } | undefined): number {
  const n = Math.max(0, Math.floor(Number(raw) || 0));
  const div = Number(grant?.countDivisor);
  if (Number.isFinite(div) && div > 1) return Math.floor(n / div);
  return n;
}

export function resolvePhase5CountMultiplier(
  spec: SpecLike,
  battlefield: readonly BattlefieldPermanent[],
  state?: unknown,
): number {
  const grant = spec.grant || {};
  const extended = resolveExtendedCountMultiplier(spec, battlefield, state);
  if (extended !== undefined) return applyCountDivisor(extended, grant);
  if (grant.countBasis === 'controller_commander_casts') {
    const zone = (state as any)?.commandZone?.[String(spec.sourceController || '')];
    return applyCountDivisor(Math.max(0, Math.floor(Number(zone?.tax || 0) / 2)), grant);
  }
  if (grant.countBasis !== 'source_counters') return 1;
  const holder = grant.countOnEffectSource && spec.effectSourcePermanentId
    ? { sourcePermanentId: spec.effectSourcePermanentId }
    : spec;
  return applyCountDivisor(
    counterCount(findSource(holder, battlefield), String(grant.countCounterType || '')),
    grant,
  );
}