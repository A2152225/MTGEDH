// server/src/rules-engine/targeting-handlers/targetingProtectionKeywordStaticOverride.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster: hexproof/shroud lose vs as-though overrides (controller-only vs global)
//   plus until-EOT lastingEffects.protectionKeywordOverride.
// Public entry symbols: protectionKeywordIgnoredForTargeting,
//   protectionKeywordIgnoredForPlayerTargeting, asThoughAbilitySuppressedForTarget.

import type { BattlefieldPermanent, PlayerID } from '../../../../shared/src/index.js';
import {
  collectStaticEffectSpecsFromState,
  readDerivedStaticEffectSpecs,
  type StaticEffectSpec,
} from '../../state/modules/staticEffectSpec.js';

type ProtectionKeyword = 'hexproof' | 'shroud';

function grantListIncludesToken(values: readonly string[] | undefined, token: string): boolean {
  if (!Array.isArray(values)) return false;
  const needle = String(token || '').trim().toLowerCase();
  if (!needle) return false;
  return values.some((value) => String(value || '').trim().toLowerCase() === needle);
}

function grantListIncludesKeyword(values: readonly string[] | undefined, keyword: ProtectionKeyword): boolean {
  return grantListIncludesToken(values, keyword);
}

function isCreaturePermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('creature') || typeLine.includes('kindred') || typeLine.includes('tribal');
}

/** Lose / as-though leftover specs scoped to opponent creatures or permanents. */
function specAppliesToOpponentSubject(spec: StaticEffectSpec, permanent: BattlefieldPermanent): boolean {
  const sourceController = String(spec.sourceController || '');
  if (!sourceController) return false;
  if (String(permanent.controller || '') === sourceController) return false;
  if (spec.scope.kind === 'opponent_permanents') return true;
  if (spec.scope.kind === 'opponent_creatures') return isCreaturePermanent(permanent);
  return false;
}

function readStaticSpecs(state: unknown): readonly StaticEffectSpec[] {
  return readDerivedStaticEffectSpecs(state) ?? collectStaticEffectSpecsFromState(state);
}

type ProtectionOverrideMode = 'asThoughController' | 'asThoughAll' | 'remove';

type ProtectionKeywordOverrideEffect = {
  type?: string;
  duration?: string;
  sourceController?: string;
  mode?: ProtectionOverrideMode | string;
  abilities?: readonly string[];
  scopes?: readonly string[];
};

function readProtectionKeywordOverrides(state: unknown): readonly ProtectionKeywordOverrideEffect[] {
  const lasting = (state as { lastingEffects?: unknown[] } | undefined)?.lastingEffects;
  if (!Array.isArray(lasting)) return [];
  return lasting.filter((entry): entry is ProtectionKeywordOverrideEffect => (
    !!entry
    && typeof entry === 'object'
    && String((entry as ProtectionKeywordOverrideEffect).type || '') === 'protectionKeywordOverride'
  ));
}

function overrideListsKeyword(effect: ProtectionKeywordOverrideEffect, keyword: string): boolean {
  const needle = String(keyword || '').trim().toLowerCase();
  if (!needle || !Array.isArray(effect.abilities)) return false;
  return effect.abilities.some((ability) => String(ability || '').trim().toLowerCase() === needle);
}

function overrideAppliesToOpponentPermanent(
  effect: ProtectionKeywordOverrideEffect,
  permanent: BattlefieldPermanent,
): boolean {
  const sourceController = String(effect.sourceController || '');
  if (!sourceController) return false;
  if (String(permanent.controller || '') === sourceController) return false;
  const scopes = Array.isArray(effect.scopes) ? effect.scopes : [];
  if (scopes.includes('opponent_permanents')) return true;
  if (scopes.includes('opponent_creatures') && isCreaturePermanent(permanent)) return true;
  return false;
}

function overrideAppliesToOpponentPlayer(
  effect: ProtectionKeywordOverrideEffect,
  targetPlayerId: string,
): boolean {
  const sourceController = String(effect.sourceController || '');
  if (!sourceController) return false;
  if (targetPlayerId === sourceController) return false;
  const scopes = Array.isArray(effect.scopes) ? effect.scopes : [];
  return scopes.includes('player_opponents');
}

function overrideIgnoresForTargetingPlayer(
  effect: ProtectionKeywordOverrideEffect,
  targetingPlayerId: string,
): boolean {
  const mode = String(effect.mode || '');
  if (mode === 'remove' || mode === 'asThoughAll') return true;
  if (mode === 'asThoughController') {
    return String(effect.sourceController || '') === targetingPlayerId;
  }
  return false;
}

/**
 * True lose (Archetype of Endurance): every player ignores the stripped keyword.
 * Global as-though (Nowhere to Run): every player ignores hexproof; keyword stays.
 * Controller as-though (Glaring Spotlight / Kaya): only the source controller ignores it.
 */
export function protectionKeywordIgnoredForTargeting(
  permanent: BattlefieldPermanent,
  state: unknown,
  targetingPlayerId: PlayerID,
  keyword: ProtectionKeyword,
): boolean {
  const targetingId = String(targetingPlayerId || '');
  if (!targetingId) return false;

  for (const spec of readStaticSpecs(state)) {
    if (!specAppliesToOpponentSubject(spec, permanent)) continue;
    if (grantListIncludesKeyword(spec.grant.removeAbilities, keyword)) {
      return true;
    }
    if (grantListIncludesKeyword(spec.grant.asThoughNoAbilities, keyword)) {
      return true;
    }
    if (
      grantListIncludesKeyword(spec.grant.asThoughNoAbilitiesForController, keyword)
      && String(spec.sourceController || '') === targetingId
    ) {
      return true;
    }
  }

  for (const effect of readProtectionKeywordOverrides(state)) {
    if (!overrideListsKeyword(effect, keyword)) continue;
    if (!overrideAppliesToOpponentPermanent(effect, permanent)) continue;
    if (overrideIgnoresForTargetingPlayer(effect, targetingId)) return true;
  }
  return false;
}

/**
 * True when a leftover as-though grant lists `ability` for this opponent subject.
 * Global asThoughNoAbilities applies to every caster; ForController only when the
 * targeting player is the spec source controller. Does not consult removeAbilities
 * and does not change hexproof/shroud matching.
 */
export function asThoughAbilitySuppressedForTarget(
  permanent: BattlefieldPermanent,
  state: unknown,
  targetingPlayerId: PlayerID,
  ability: string,
): boolean {
  const targetingId = String(targetingPlayerId || '');
  const token = String(ability || '').trim().toLowerCase();
  if (!targetingId || !token) return false;

  for (const spec of readStaticSpecs(state)) {
    if (!specAppliesToOpponentSubject(spec, permanent)) continue;
    if (grantListIncludesToken(spec.grant.asThoughNoAbilities, token)) {
      return true;
    }
    if (
      grantListIncludesToken(spec.grant.asThoughNoAbilitiesForController, token)
      && String(spec.sourceController || '') === targetingId
    ) {
      return true;
    }
  }
  return false;
}

/** Lose / as-though leftover specs scoped to opponent players (Kaya, not Spotlight). */
function specAppliesToOpponentPlayer(spec: StaticEffectSpec, targetPlayerId: string): boolean {
  if (spec.scope.kind !== 'player_opponents') return false;
  const sourceController = String(spec.sourceController || '');
  if (!sourceController) return false;
  return targetPlayerId !== sourceController;
}

/**
 * Same lose / as-though rules as permanents, but only `player_opponents` specs apply.
 * Glaring Spotlight / Nowhere to Run stay creature-scoped and do not pierce player hexproof.
 */
export function protectionKeywordIgnoredForPlayerTargeting(
  targetPlayerId: PlayerID,
  state: unknown,
  targetingPlayerId: PlayerID,
  keyword: ProtectionKeyword,
): boolean {
  const targetingId = String(targetingPlayerId || '');
  const targetId = String(targetPlayerId || '');
  if (!targetingId || !targetId) return false;

  for (const spec of readStaticSpecs(state)) {
    if (!specAppliesToOpponentPlayer(spec, targetId)) continue;
    if (grantListIncludesKeyword(spec.grant.removeAbilities, keyword)) {
      return true;
    }
    if (grantListIncludesKeyword(spec.grant.asThoughNoAbilities, keyword)) {
      return true;
    }
    if (
      grantListIncludesKeyword(spec.grant.asThoughNoAbilitiesForController, keyword)
      && String(spec.sourceController || '') === targetingId
    ) {
      return true;
    }
  }

  for (const effect of readProtectionKeywordOverrides(state)) {
    if (!overrideListsKeyword(effect, keyword)) continue;
    if (!overrideAppliesToOpponentPlayer(effect, targetId)) continue;
    if (overrideIgnoresForTargetingPlayer(effect, targetingId)) return true;
  }
  return false;
}
