// server/src/rules-engine/targeting-handlers/targetingPlayerProtectionKeyword.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster: player hexproof/shroud grants and targeting legality.
// Public entry symbols: canPlayerBeTargetedByPlayer.

import type { GameState, PlayerID } from '../../../../shared/src/index.js';
import {
  collectStaticEffectSpecsFromState,
  readDerivedContinuousEffects,
  readDerivedStaticEffectSpecs,
  type StaticEffectSpec,
} from '../../state/modules/staticEffectSpec.js';
import { protectionKeywordIgnoredForPlayerTargeting } from './targetingProtectionKeywordStaticOverride.js';

type ProtectionKeyword = 'hexproof' | 'shroud';

function readStaticSpecs(state: unknown): readonly StaticEffectSpec[] {
  return readDerivedStaticEffectSpecs(state) ?? collectStaticEffectSpecsFromState(state);
}

function derivedPlayerSetHas(set: unknown, playerId: string): boolean {
  if (!set || typeof (set as { has?: unknown }).has !== 'function') return false;
  const has = (set as Set<string>).has.bind(set);
  return has(playerId);
}

function specGrantsPlayerKeyword(
  spec: StaticEffectSpec,
  targetPlayerId: string,
  keyword: ProtectionKeyword,
): boolean {
  const sourceController = String(spec.sourceController || '');
  if (!sourceController) return false;
  const granted = keyword === 'hexproof' ? spec.grant.playerHexproof : spec.grant.playerShroud;
  if (!granted) return false;
  if (spec.scope.kind === 'player_you') return sourceController === targetPlayerId;
  if (spec.scope.kind === 'player_opponents') return sourceController !== targetPlayerId;
  return false;
}

function leftoverOracleGrantsPlayerKeyword(
  oracleText: string,
  keyword: ProtectionKeyword,
): 'you' | 'opponents' | null {
  const oracle = String(oracleText || '').toLowerCase();
  if (!oracle) return null;
  if (new RegExp(`\\byou have ${keyword}\\b`, 'i').test(oracle)) return 'you';
  if (new RegExp(`\\b(?:your )?opponents have ${keyword}\\b`, 'i').test(oracle)) return 'opponents';
  if (new RegExp(`\\beach opponent has ${keyword}\\b`, 'i').test(oracle)) return 'opponents';
  return null;
}

function playerHasProtectionKeyword(
  targetPlayerId: PlayerID,
  state: unknown,
  keyword: ProtectionKeyword,
): boolean {
  const targetId = String(targetPlayerId || '');
  if (!targetId) return false;

  const derived = readDerivedContinuousEffects(state);
  if (derived) {
    const granted = keyword === 'hexproof' ? derived.playerHexproof : derived.playerShroud;
    if (derivedPlayerSetHas(granted, targetId)) return true;
  }

  for (const spec of readStaticSpecs(state)) {
    if (specGrantsPlayerKeyword(spec, targetId, keyword)) return true;
  }

  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: ReadonlyArray<{ controller?: unknown; card?: { oracle_text?: unknown } }> }).battlefield
    : [];
  for (const permanent of battlefield) {
    const controller = String(permanent?.controller || '');
    if (!controller) continue;
    const grant = leftoverOracleGrantsPlayerKeyword(
      String((permanent.card as { oracle_text?: unknown } | undefined)?.oracle_text || ''),
      keyword,
    );
    if (grant === 'you' && controller === targetId) return true;
    if (grant === 'opponents' && controller !== targetId) return true;
  }

  return false;
}

/**
 * Hexproof blocks opponents only; shroud blocks every targeting player.
 * Kaya-class `player_opponents` as-though / lose specs can ignore the keyword.
 */
export function canPlayerBeTargetedByPlayer(
  targetPlayerId: PlayerID,
  state: Readonly<GameState> | unknown,
  targetingPlayerId: PlayerID,
): boolean {
  if (
    playerHasProtectionKeyword(targetPlayerId, state, 'shroud')
    && !protectionKeywordIgnoredForPlayerTargeting(targetPlayerId, state, targetingPlayerId, 'shroud')
  ) {
    return false;
  }

  if (
    playerHasProtectionKeyword(targetPlayerId, state, 'hexproof')
    && String(targetPlayerId) !== String(targetingPlayerId)
    && !protectionKeywordIgnoredForPlayerTargeting(targetPlayerId, state, targetingPlayerId, 'hexproof')
  ) {
    return false;
  }

  return true;
}
