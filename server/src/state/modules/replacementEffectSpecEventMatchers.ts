// Origin parent: replacementEffectSpec.ts
// Per-event declarative replacement matchers (draw, token, zone change, library search, mill, counters).
// Public entry symbols: overlaySpecsMatchTokenCreation, overlaySpecsMatchLibrarySearch, overlaySpecsMatchMill, overlaySpecsMatchCounterPlacement.

import type { ReplacementEffect } from './game-state-effects.js';
import { readScopedReplacementSpecs } from './replacementEffectSpecScopedCache.js';
import {
  extractOracleCardLookupKeys,
  resolveCompiledOverlayForCard,
} from './oracleIrCompiledOverlayLookup.js';
import type {
  CardDrawReplacementEvent,
  LifeGainReplacementEvent,
  ReplacementEffectResult,
  ReplacementEvent,
  TokenCreationReplacementEvent,
  ZoneChangeReplacementEvent,
} from './replacement-effects.js';

import type {
  ReplacementEffectSpec,
  ReplacementEffectSpecEvent,
  ReplacementZoneChangeMatch,
} from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { inferLeaveBattlefieldExileReplacement } from './leaveBattlefieldReplacementStamp.js';
import { collectOraclePatternLifeGainReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLifeGainOracleTemplates.js';
import { overlaySpecsMatchLifeGain, matchesLifeGainSpec } from './replacementEffectSpec-handlers/replacementEffectSpecLifeGainMatch.js';
import { collectOraclePatternLifeLossReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLifeLossOracleTemplates.js';
import { collectOraclePatternCounterReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecCounterOracleTemplates.js';
import { collectOraclePatternLibrarySearchReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLibrarySearchOracleTemplates.js';
import { collectOraclePatternDamageReplacementSpecsFromState, overlaySpecsMatchDamage } from './replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { collectOraclePatternDrawReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecDrawOracleTemplates.js';
import { collectOraclePatternTokenReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecTokenOracleTemplates.js';
import { collectOraclePatternMillReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecMillOracleTemplates.js';
import { collectOraclePatternZoneChangeReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecZoneChangeOracleTemplates.js';
import { matchesZoneChangeOwnershipExtras } from './replacementEffectSpec-handlers/replacementEffectSpecZoneChangeDiesExileTemplates.js';
import { collectOraclePatternLoseGameReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLoseGameOracleTemplates.js';
import { collectOraclePatternLifeFloorDamageReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLifeFloorDamageOracleTemplates.js';

export function matchesDrawSpec(spec: ReplacementEffectSpec, event: CardDrawReplacementEvent): boolean {
  const match = spec.match;
  if (!match) return true;

  if (match.skipWhenEventMetadataTrue
    && event.metadata?.[match.skipWhenEventMetadataTrue] === true) {
    return false;
  }

  if (match.requireEventMetadataTrue
    && event.metadata?.[match.requireEventMetadataTrue] !== true) {
    return false;
  }

  if (match.exactDrawCount !== undefined) {
    const count = Math.max(0, Math.floor(Number(event.count || 0)));
    if (count !== match.exactDrawCount) return false;
  }

  if (match.drawingPlayerIsOpponentOfSource === true
    && String(event.playerId || '') === String(spec.sourceController || '')) {
    return false;
  }

  if (match.drawingPlayerIsSourceController === true
    && String(event.playerId || '') !== String(spec.sourceController || '')) {
    return false;
  }

  if (match.minimumDrawCount !== undefined) {
    const count = Math.max(0, Math.floor(Number(event.count || 0)));
    if (count < match.minimumDrawCount) return false;
  }

  return true;
}

export const NONCREATURE_TOKEN_NAMES = new Set([
  'treasure',
  'food',
  'clue',
  'blood',
  'gold',
  'map',
  'junk',
  'powerstone',
  'shard',
]);

export function tokenCreationEventLooksLikeCreature(event: TokenCreationReplacementEvent): boolean {
  const typeLine = String(
    event.tokenTypeLine
    || event.metadata?.typeLine
    || event.metadata?.type_line
    || '',
  ).toLowerCase();
  if (typeLine.includes('creature')) return true;
  if (typeLine) return false;
  const name = String(event.tokenName || '').trim().toLowerCase();
  if (NONCREATURE_TOKEN_NAMES.has(name)) return false;
  return true;
}

export function matchesTokenSpec(spec: ReplacementEffectSpec, event: TokenCreationReplacementEvent): boolean {
  const match = spec.match;
  if (!match) return true;

  const controllerId = String(event.controllerId || '');
  const sourceController = String(spec.sourceController || '');

  if (match.creatingPlayerIsSourceController === true
    && controllerId !== sourceController) {
    return false;
  }

  if (match.tokenIsCreature === true && !tokenCreationEventLooksLikeCreature(event)) {
    return false;
  }

  const nameIs = String(spec.metadata?.tokenNameIs || '').toLowerCase();
  if (nameIs) {
    const hay = `${event.tokenName || ''} ${event.tokenTypeLine || ''}`.toLowerCase();
    if (!hay.includes(nameIs)) return false;
  }

  return true;
}

export function overlaySpecsMatchTokenCreation(
  spec: ReplacementEffectSpec,
  event: { controllerId: string; state?: unknown; tokenName?: string; tokenTypeLine?: string; count?: number },
): boolean {
  return matchesTokenSpec(spec, {
    type: 'token-creation',
    state: event.state,
    controllerId: event.controllerId,
    count: event.count ?? 1,
    tokenName: event.tokenName,
    tokenTypeLine: event.tokenTypeLine,
  });
}

export function normalizeReplacementToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function readStackCastWithAbility(stackItem: any): string {
  return normalizeReplacementToken(
    stackItem?.card?.castWithAbility
      || stackItem?.castWithAbility
      || stackItem?.alternativeCost
      || '',
  );
}

export function stackItemExilesAfterResolution(stackItem: any): boolean {
  return stackItem?.exileAfterResolution === true
    || stackItem?.card?.exileAfterResolution === true
    || stackItem?.card?.card?.exileAfterResolution === true;
}

export function getObjectCardId(object: any): string {
  return String(object?.card?.id || object?.id || '').trim();
}

export function objectIsTokenPermanent(object: any): boolean {
  return object?.isToken === true || object?.card?.isToken === true;
}

export function normalizeCounterName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ counters?$/i, '')
    .replace(/^an?\s+/i, '')
    .trim();
}

export function permanentHasCounter(permanent: any, counterName: string): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return false;
  const target = normalizeCounterName(counterName);
  for (const [name, amountRaw] of Object.entries(counters as Record<string, unknown>)) {
    if (normalizeCounterName(name) === target && Number(amountRaw || 0) > 0) {
      return true;
    }
  }
  return false;
}

export function readLeaveBattlefieldReplacementDestination(permanent: any, state?: any): string {
  const explicit = normalizeReplacementToken(
    permanent?.leaveBattlefieldReplacementDestination
      || permanent?.card?.leaveBattlefieldReplacementDestination
      || '',
  );
  if (explicit === 'exile') return explicit;
  const inferred = inferLeaveBattlefieldExileReplacement(permanent, state);
  return inferred?.leaveBattlefieldReplacementDestination === 'exile' ? 'exile' : explicit;
}

export function readReplacementSourceName(permanent: any): string | undefined {
  const value = String(
    permanent?.leaveBattlefieldReplacementSourceName
      || permanent?.card?.leaveBattlefieldReplacementSourceName
      || '',
  ).trim();
  return value || undefined;
}

export function readReplacementLifeGain(permanent: any): number | undefined {
  const value = Number(
    permanent?.leaveBattlefieldReplacementLifeGain
      || permanent?.card?.leaveBattlefieldReplacementLifeGain
      || 0,
  );
  return value > 0 ? value : undefined;
}

export function objectIsCommander(event: ZoneChangeReplacementEvent): boolean {
  const object = event.object;
  if (object?.isCommander === true || object?.card?.isCommander === true) return true;

  const commanderIds = Array.isArray(event.metadata?.commanderIds) ? event.metadata?.commanderIds : [];
  const cardId = getObjectCardId(object);
  return Boolean(cardId && commanderIds.some((id) => String(id || '') === cardId));
}

export function matchesZoneChangeSpec(event: ZoneChangeReplacementEvent, match: ReplacementZoneChangeMatch): boolean {
  if (match.sourceZone && event.sourceZone !== match.sourceZone) return false;
  if (match.destinationZone && event.destinationZone !== match.destinationZone) return false;
  if (match.destinationZoneIn && match.destinationZoneIn.length > 0
    && !match.destinationZoneIn.includes(event.destinationZone)) {
    return false;
  }
  if (match.objectIsCommander === true && !objectIsCommander(event)) return false;
  if (match.destinationZoneNot && event.destinationZone === match.destinationZoneNot) return false;

  const permanent = event.object;
  if (match.leaveBattlefieldExileInstead === true
    && readLeaveBattlefieldReplacementDestination(permanent, event.state) !== 'exile') {
    return false;
  }
  if (match.objectIsToken === true && !objectIsTokenPermanent(permanent)) return false;
  if (match.objectHasCounter
    && !permanentHasCounter(permanent, match.objectHasCounter)) {
    return false;
  }
  if (match.objectTypeLineIncludes) {
    const typeLine = normalizeReplacementToken(permanent?.card?.type_line || permanent?.type_line || '');
    if (!typeLine.includes(normalizeReplacementToken(match.objectTypeLineIncludes))) return false;
  }

  const stackItem = event.object;
  const castWithAbility = readStackCastWithAbility(stackItem);
  const explicitExileAfterResolution = match.exileAfterResolution === true && stackItemExilesAfterResolution(stackItem);
  const castWithListedAbility = Array.isArray(match.castWithAbilityIn)
    && match.castWithAbilityIn.length > 0
    && match.castWithAbilityIn.some((ability) => normalizeReplacementToken(ability) === castWithAbility);

  if (match.exileAfterResolution === true || (match.castWithAbilityIn && match.castWithAbilityIn.length > 0)) {
    return explicitExileAfterResolution || castWithListedAbility;
  }

  return true;
}

export function overlaySpecsMatchLibrarySearch(
  spec: ReplacementEffectSpec,
  event: { searchingPlayerId: string },
): boolean {
  const match = spec.match;
  if (!match) return true;
  const searching = String(event.searchingPlayerId || '');
  const sourceController = String(spec.sourceController || '');
  if (match.searchingPlayerIsOpponentOfSource === true && searching === sourceController) {
    return false;
  }
  if (match.searchingPlayerIsSourceController === true && searching !== sourceController) {
    return false;
  }
  return true;
}

export function overlaySpecsMatchMill(
  spec: ReplacementEffectSpec,
  event: { millingPlayerId: string; targetPlayerId: string },
): boolean {
  const match = spec.match;
  if (!match) return true;
  if (match.millingPlayerIsSourceController === true
    && String(event.millingPlayerId) !== String(spec.sourceController || '')) {
    return false;
  }
  if (match.targetIsOpponent === true
    && String(event.targetPlayerId) === String(event.millingPlayerId)) {
    return false;
  }
  return true;
}

export function overlaySpecsMatchCounterPlacement(
  spec: ReplacementEffectSpec,
  input: { counterType: string; targetController: string },
): boolean {
  const match = spec.match;
  if (!match) return true;
  if (match.counterTypeIncludes
    && !String(input.counterType || '').includes(String(match.counterTypeIncludes))) {
    return false;
  }
  if (typeof match.targetControllerIsSourceController === 'boolean') {
    const sameController = String(input.targetController) === String(spec.sourceController || '');
    if (match.targetControllerIsSourceController !== sameController) return false;
  }
  return true;
}

