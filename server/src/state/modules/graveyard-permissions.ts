import type { GameContext } from "../context";
import type { DurablePermission, PlayerID } from "../../../../shared/src";
import { isActivatableStationThresholdEffect } from "../../../../rules-engine/src/stationPermanentUtils.js";
import { collectStaticEffectSources } from "./static-effect-sources";
import { buildDurableGraveyardPermission, clearTemporaryDurableGraveyardPermissions, getActiveDurablePermissions, getDurableGraveyardActivationPermissionForCard, upsertDurablePermission } from "./durable-permissions";

import type {
  GrantedFlashbackInfo,
  GrantedUnearthInfo,
  GrantedGraveyardKeywordInfo,
  PrintedSelfCastPermissionInfo,
  TemporaryGraveyardKeywordGrant,
  TemporaryPlayableFromGraveyardPermission,
  GraveyardCastingPermissionKind,
  GraveyardCastingPermissionDuration,
  GraveyardCastingPermissionCostMode,
  GraveyardCastingPermissionCardFilter,
  GraveyardCastingPermissionUsageLimit,
  GraveyardCastingPermissionReplacement,
  GraveyardCastingPermissionAdditionalCost,
  GraveyardCastingPermission,
  GraveyardGrantKeyword,
} from "./graveyard-permissions-handlers/graveyardPermissionsTypes.js";
export type {
  GrantedFlashbackInfo,
  GrantedUnearthInfo,
  GrantedGraveyardKeywordInfo,
  PrintedSelfCastPermissionInfo,
  TemporaryGraveyardKeywordGrant,
  TemporaryPlayableFromGraveyardPermission,
  GraveyardCastingPermissionKind,
  GraveyardCastingPermissionDuration,
  GraveyardCastingPermissionCostMode,
  GraveyardCastingPermissionCardFilter,
  GraveyardCastingPermissionUsageLimit,
  GraveyardCastingPermissionReplacement,
  GraveyardCastingPermissionAdditionalCost,
  GraveyardCastingPermission,
  GraveyardGrantKeyword,
} from "./graveyard-permissions-handlers/graveyardPermissionsTypes.js";


import {
  escapeRegExp,
  getCardId,
  getCurrentTurn,
  getManaCost,
  getTypeLine,
  isPlayersTurn,
  normalizeText,
  parseSmallNumber,
  sanitizePermissionIdPart,
} from "./graveyard-permissions-handlers/graveyardPermissionsCardUtils.js";
import { qualifierMatchesCard } from "./graveyard-permissions-handlers/graveyardPermissionsQualifierMatch.js";
import { setGraveyardPermissionsHandlerDeps } from "./graveyard-permissions-handlers/graveyardPermissionsHandlerDeps.js";
import {
  normalizeGraveyardPermissionCostMode,
  normalizeGraveyardPermissionDuration,
} from "./graveyard-permissions-handlers/graveyardPermissionsNormalize.js";
import { applyPlayableFromGraveyardPermissionFromText } from "./graveyard-permissions-handlers/graveyardPermissionsPlayableFromText.js";
export { applyPlayableFromGraveyardPermissionFromText } from "./graveyard-permissions-handlers/graveyardPermissionsPlayableFromText.js";
import {
  extractAdditionalEscapeExileCount,
  extractEscapeEntryCounterCount,
  extractGrantedKeywordCost,
} from "./graveyard-permissions-handlers/graveyardPermissionsKeywordCost.js";
import { findTemporaryGrantedKeywordInfo } from "./graveyard-permissions-handlers/graveyardPermissionsKeywordGrantHelpers.js";
import { stripGenericGraveyardCastPermissionForCard } from "./graveyard-permissions-handlers/graveyardPermissionsStripGenericCast.js";
import { applyTemporaryGraveyardKeywordGrantFromText } from "./graveyard-permissions-handlers/graveyardPermissionsKeywordGrantFromText.js";
export { applyTemporaryGraveyardKeywordGrantFromText } from "./graveyard-permissions-handlers/graveyardPermissionsKeywordGrantFromText.js";


function getGraveyardCastingPermissions(state: any): GraveyardCastingPermission[] {
  return Array.isArray(state?.graveyardCastingPermissions)
    ? state.graveyardCastingPermissions
    : [];
}

export function buildGraveyardCastingPermissionId(permission: Omit<GraveyardCastingPermission, 'id'> & { id?: string }): string {
  const sourcePart = sanitizePermissionIdPart(permission.sourceId || permission.sourceName || 'source');
  const qualifierPart = sanitizePermissionIdPart(
    permission.cardFilter?.qualifier || permission.cardFilter?.cardIds?.join('_') || 'cards'
  );
  const turnPart = Number(permission.turnApplied ?? 0) || 0;
  return [
    'graveyard-permission',
    permission.playerId,
    permission.permission,
    sourcePart || 'source',
    qualifierPart || 'cards',
    turnPart,
  ].map(sanitizePermissionIdPart).filter(Boolean).join(':');
}

function graveyardCastingPermissionIsActive(state: any, permission: GraveyardCastingPermission): boolean {
  if (!permission || permission.sourceZone !== 'graveyard') return false;
  const duration = normalizeGraveyardPermissionDuration(permission.duration);
  if (duration === 'static') return true;

  const turnApplied = Number(permission.turnApplied ?? getCurrentTurn(state)) || 0;
  const currentTurn = getCurrentTurn(state);
  if (duration === 'until_end_of_next_turn') {
    return currentTurn <= turnApplied + 1;
  }

  return turnApplied >= currentTurn;
}

function readDurableGraveyardPermissionAdditionalCost(
  permission: DurablePermission,
): GraveyardCastingPermissionAdditionalCost | undefined {
  const raw = permission.metadata?.additionalCost;
  if (!raw || typeof raw !== 'object') return undefined;

  const type = String((raw as GraveyardCastingPermissionAdditionalCost).type || '').trim();
  const amount = Number((raw as GraveyardCastingPermissionAdditionalCost).amount || 0);
  if (!type || !Number.isFinite(amount) || amount <= 0) return undefined;

  switch (type) {
    case 'discard':
    case 'sacrifice':
    case 'remove_counters':
    case 'exile_from_graveyard':
      return {
        type,
        amount,
        ...((raw as GraveyardCastingPermissionAdditionalCost).filter
          ? { filter: String((raw as GraveyardCastingPermissionAdditionalCost).filter) }
          : {}),
        ...((raw as GraveyardCastingPermissionAdditionalCost).counterType
          ? { counterType: String((raw as GraveyardCastingPermissionAdditionalCost).counterType) }
          : {}),
        ...((raw as GraveyardCastingPermissionAdditionalCost).distributed
          ? { distributed: true }
          : {}),
      };
    default:
      return undefined;
  }
}

function durablePermissionToGraveyardCastingPermission(permission: DurablePermission): GraveyardCastingPermission | undefined {
  if (!permission || String(permission.kind || '') !== 'graveyard_permission') return undefined;
  if (permission.allowedAction !== 'play' && permission.allowedAction !== 'cast') return undefined;

  const allowedSourceZones = Array.isArray(permission.allowedSourceZones)
    ? permission.allowedSourceZones.map((zone) => String(zone || '').trim().toLowerCase())
    : [];
  if (allowedSourceZones.length > 0 && !allowedSourceZones.includes('graveyard')) return undefined;

  const cardIds = Array.isArray(permission.cardFilter?.affectedCardIds)
    ? permission.cardFilter.affectedCardIds.map((cardId) => String(cardId || '').trim()).filter(Boolean)
    : [];
  const qualifier = String(permission.cardFilter?.qualifier || '').trim();
  if (cardIds.length === 0 && !qualifier) return undefined;

  const leaveBattlefieldDestination = permission.replacement?.leaveBattlefieldDestination === 'exile'
    ? 'exile'
    : undefined;
  const sourceText = String(permission.debug?.sourceText || '').trim();
  const additionalCost = readDurableGraveyardPermissionAdditionalCost(permission);

  return {
    id: String(permission.id || '').trim(),
    playerId: String(permission.grantedTo || '').trim(),
    permission: permission.allowedAction,
    sourceZone: 'graveyard',
    cardFilter: {
      ...(qualifier ? { qualifier } : {}),
      ...(cardIds.length > 0 ? { cardIds } : {}),
    },
    costMode: normalizeGraveyardPermissionCostMode(permission.costMode),
    duration: normalizeGraveyardPermissionDuration(permission.duration),
    ...(typeof permission.turnApplied === 'number' ? { turnApplied: permission.turnApplied } : {}),
    ...(permission.sourceId ? { sourceId: String(permission.sourceId) } : {}),
    ...(permission.sourceName ? { sourceName: String(permission.sourceName) } : {}),
    ...(sourceText ? { sourceText } : {}),
    ...(additionalCost ? { additionalCost: { ...additionalCost } } : {}),
    ...(permission.usageLimit ? { usageLimit: { ...permission.usageLimit } as GraveyardCastingPermissionUsageLimit } : {}),
    ...(permission.replacement ? {
      replacement: {
        ...(permission.replacement.exileAfterResolution ? { exileAfterResolution: true } : {}),
        ...(leaveBattlefieldDestination ? { leaveBattlefieldDestination } : {}),
        ...(typeof permission.replacement.leaveBattlefieldLifeGain === 'number' ? { leaveBattlefieldLifeGain: permission.replacement.leaveBattlefieldLifeGain } : {}),
        ...(permission.replacement.sourceName ? { sourceName: permission.replacement.sourceName } : {}),
      },
    } : {}),
    ...((permission.metadata as any)?.castAsAdventureOnly === true ? { castAsAdventureOnly: true } : {}),
  };
}

function getDurableGraveyardCastingPermissions(state: any, playerId: PlayerID): GraveyardCastingPermission[] {
  return getActiveDurablePermissions(state, { playerId, kind: 'graveyard_permission' })
    .map((permission) => durablePermissionToGraveyardCastingPermission(permission))
    .filter((permission): permission is GraveyardCastingPermission => Boolean(permission));
}

function normalizeRuleText(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

function isSelfReferentialGraveyardCastLine(line: string): boolean {
  const normalized = normalizeRuleText(line);
  // Printed self-cast (Gravecrawler, etc.) only applies while the card is in the GY.
  // Battlefield sources must not mint an open "this card" cast permission for other GY cards.
  return /\byou may (?:cast|play) (?:this|that) (?:card|permanent|spell|land)s?\b/.test(normalized);
}

function isStaticGraveyardPermissionLine(line: string): boolean {
  const normalized = normalizeRuleText(line);
  if (!normalized.includes('graveyard')) return false;
  if (!normalized.includes('you may play') && !normalized.includes('you may cast') && !normalized.includes(' cast ')) return false;
  if (normalized.includes(':')) return false;
  if (/^\s*(when|whenever|at the beginning)\b/.test(normalized)) return false;
  if (isSelfReferentialGraveyardCastLine(normalized)) return false;
  return true;
}

export function isActivatableStationGraveyardPermissionLine(
  sourceText: string,
  oracleText: string,
  typeLine: string,
): boolean {
  const effectWithoutThreshold = String(sourceText || '').replace(/^\d+\+\s*\|\s*/i, '').trim();
  const hadThresholdPrefix = effectWithoutThreshold !== String(sourceText || '').trim();
  if (!isActivatableStationThresholdEffect(effectWithoutThreshold)) {
    return false;
  }

  const normalizedTypeLine = String(typeLine || '').toLowerCase();
  const isStationPermanent = normalizedTypeLine.includes('spacecraft')
    || normalizedTypeLine.includes('planet')
    || /station\s*\(/i.test(String(oracleText || ''));
  return hadThresholdPrefix || isStationPermanent;
}

function getGraveyardPermissionCostModeFromText(text: unknown): GraveyardCastingPermissionCostMode {
  const normalized = normalizeRuleText(text);
  return /\bwithout paying (?:its|their|that spell's) mana cost\b/.test(normalized)
    ? 'without_paying_mana_cost'
    : 'normal';
}

function sourceExilesSpellCastThisWay(oracleText: string): boolean {
  const normalized = normalizeRuleText(oracleText);
  return /\bif\s+(?:a|that|this)\s+(?:card|spell)\s+cast\s+this\s+way\s+would\s+be\s+put\s+into\s+your\s+graveyard\s*,?\s*exile\s+it\s+instead\b/.test(normalized);
}

function sourceLeaveBattlefieldReplacementDestination(oracleText: string): 'exile' | undefined {
  const normalized = normalizeRuleText(oracleText).replace(/["“”]/g, ' ');

  if (/\bit\s+gains\b.*\bif\s+this\s+permanent\s+would\s+leave\s+the\s+battlefield,\s*exile\s+it\s+instead\s+of\s+putting\s+it\s+anywhere\s+else\b/.test(normalized)) {
    return 'exile';
  }

  if (/\bit\s+gains\b.*\bwhen\s+this\s+(?:creature\s+dies|permanent\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield),\s*exile\s+it\b/.test(normalized)) {
    return 'exile';
  }

  return undefined;
}

function sourceLeaveBattlefieldLifeGain(oracleText: string): number | undefined {
  const normalized = normalizeRuleText(oracleText).replace(/["“”]/g, ' ');
  const match = normalized.match(/\bit\s+gains\b.*\bwhen\s+this\s+permanent\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield,\s*exile\s+it\s+and\s+you\s+gain\s+(\d+)\s+life\b/);
  if (!match) return undefined;

  const amount = Number.parseInt(match[1], 10);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function getStaticGraveyardPermissionUsageLimit(
  line: string,
  permission: GraveyardCastingPermissionKind,
  qualifier: string,
): GraveyardCastingPermissionUsageLimit | undefined {
  const normalizedLine = normalizeRuleText(line);
  const normalizedQualifier = normalizeRuleText(qualifier);

  if (/\bpermanent (?:cards?|spells?) of each permanent type\b/.test(normalizedQualifier)) {
    return { type: 'one_per_permanent_type' };
  }

  if (/\bonce during each of your turns\b/.test(normalizedLine) || /\bup to one\b/.test(normalizedQualifier)) {
    return { type: 'once_per_turn', maxUses: 1 };
  }

  if (permission === 'play' && /^\s*(?:a|an)\b/i.test(String(qualifier || '').trim())) {
    return { type: 'once_per_turn', maxUses: 1 };
  }

  return undefined;
}

function getStaticSourceGraveyardCastingPermissions(state: any, playerId: PlayerID): GraveyardCastingPermission[] {
  const permissionsById = new Map<string, GraveyardCastingPermission>();
  const normalizedPlayerId = String(playerId || '');

  const pushPermission = (
    source: any,
    permission: GraveyardCastingPermissionKind,
    qualifier: string,
    sourceText: string,
    replacement?: GraveyardCastingPermissionReplacement,
  ) => {
    const normalizedQualifier = String(qualifier || '').trim();
    if (!normalizedQualifier) return;
    // Self-referential qualifiers are printed self-cast only (bound by cardId elsewhere).
    if (/^(?:this|that)\s+(?:card|permanent|spell|land)s?$/i.test(normalizeRuleText(normalizedQualifier))
      || /^(?:it|~)$/i.test(normalizeRuleText(normalizedQualifier))) {
      return;
    }

    const entry: GraveyardCastingPermission = {
      id: '',
      playerId: normalizedPlayerId,
      permission,
      sourceZone: 'graveyard',
      cardFilter: { qualifier: normalizedQualifier },
      costMode: getGraveyardPermissionCostModeFromText(sourceText),
      duration: 'static',
      turnApplied: 0,
      ...(source?.sourceId ? { sourceId: String(source.sourceId) } : {}),
      ...(source?.sourceName ? { sourceName: String(source.sourceName) } : {}),
      ...(sourceText ? { sourceText } : {}),
      ...(replacement ? { replacement } : {}),
    };

    const usageLimit = getStaticGraveyardPermissionUsageLimit(sourceText, permission, normalizedQualifier);
    if (usageLimit) {
      entry.usageLimit = usageLimit;
    }

    entry.id = buildGraveyardCastingPermissionId(entry);
    if (!permissionsById.has(entry.id)) {
      permissionsById.set(entry.id, entry);
    }
  };

  for (const source of collectStaticEffectSources(state)) {
    if (source?.phasedOut) continue;
    if (!source?.affectsAllPlayers && String(source?.controller || '') !== normalizedPlayerId) continue;

    const oracleText = String(source?.oracleText || '').trim();
    if (!oracleText || !/graveyard/i.test(oracleText)) continue;

    const leaveBattlefieldDestination = sourceLeaveBattlefieldReplacementDestination(oracleText);
    const leaveBattlefieldLifeGain = sourceLeaveBattlefieldLifeGain(oracleText);
    const replacementBase: GraveyardCastingPermissionReplacement | undefined = (
      sourceExilesSpellCastThisWay(oracleText)
      || leaveBattlefieldDestination
      || leaveBattlefieldLifeGain
    )
      ? {
          ...(sourceExilesSpellCastThisWay(oracleText) ? { exileAfterResolution: true } : {}),
          ...(leaveBattlefieldDestination ? { leaveBattlefieldDestination } : {}),
          ...(leaveBattlefieldLifeGain ? { leaveBattlefieldLifeGain } : {}),
          ...(leaveBattlefieldDestination && source?.sourceName ? { sourceName: String(source.sourceName) } : {}),
        }
      : undefined;

    for (const rawLine of oracleText.split(/\r?\n/)) {
      const sourceText = String(rawLine || '').trim();
      const line = normalizeRuleText(sourceText);
      if (!isStaticGraveyardPermissionLine(line)) continue;

      const effectWithoutThreshold = sourceText.replace(/^\d+\+\s*\|\s*/i, '').trim();
      if (isActivatableStationGraveyardPermissionLine(sourceText, oracleText, String(source?.typeLine || ''))) {
        continue;
      }

      if (/\bduring(?:\s+each\s+of)?\s+your\s+turns?\b/.test(line) && !isPlayersTurn(state, playerId)) continue;

      const combinedPlayCastMatch = line.match(/you may play ([^.]+?) and cast ([^.]+?) from your graveyard/i);
      if (combinedPlayCastMatch) {
        pushPermission(source, 'play', String(combinedPlayCastMatch[1] || '').trim(), sourceText, replacementBase);
        pushPermission(source, 'cast', String(combinedPlayCastMatch[2] || '').trim(), sourceText, replacementBase);
        continue;
      }

      for (const match of line.matchAll(/\b(?:you may|or|and) play ([^.]+?) from your graveyard\b/gi)) {
        pushPermission(source, 'play', String(match[1] || '').trim(), sourceText, replacementBase);
      }

      for (const match of line.matchAll(/\b(?:you may|or|and) cast ([^.]+?) from your graveyard\b/gi)) {
        pushPermission(source, 'cast', String(match[1] || '').trim(), sourceText, replacementBase);
      }
    }
  }

  return [...permissionsById.values()];
}

export function addGraveyardCastingPermission(
  state: any,
  permission: Omit<GraveyardCastingPermission, 'id' | 'sourceZone'> & { id?: string; sourceZone?: 'graveyard' },
): GraveyardCastingPermission | undefined {
  if (!state || !permission?.playerId || !permission.permission) return undefined;

  const cardIds = Array.isArray(permission.cardFilter?.cardIds)
    ? permission.cardFilter.cardIds.map((cardId) => String(cardId || '').trim()).filter(Boolean)
    : [];
  const qualifier = String(permission.cardFilter?.qualifier || '').trim();
  if (cardIds.length === 0 && !qualifier) return undefined;

  const turnApplied = Number(permission.turnApplied ?? getCurrentTurn(state)) || 0;
  const entry: GraveyardCastingPermission = {
    id: String(permission.id || buildGraveyardCastingPermissionId({
      ...permission,
      id: undefined,
      sourceZone: 'graveyard',
      cardFilter: {
        ...(qualifier ? { qualifier } : {}),
        ...(cardIds.length > 0 ? { cardIds } : {}),
      },
      turnApplied,
    } as any)).trim(),
    playerId: String(permission.playerId),
    permission: permission.permission === 'play' ? 'play' : 'cast',
    sourceZone: 'graveyard',
    cardFilter: {
      ...(qualifier ? { qualifier } : {}),
      ...(cardIds.length > 0 ? { cardIds } : {}),
    },
    costMode: permission.costMode || 'normal',
    duration: normalizeGraveyardPermissionDuration(permission.duration),
    turnApplied,
    ...(permission.sourceId ? { sourceId: String(permission.sourceId) } : {}),
    ...(permission.sourceName ? { sourceName: String(permission.sourceName) } : {}),
    ...(permission.sourceText ? { sourceText: String(permission.sourceText) } : {}),
    ...(permission.additionalCost ? { additionalCost: { ...permission.additionalCost } } : {}),
    ...(permission.usageLimit ? { usageLimit: { ...permission.usageLimit } } : {}),
    ...(permission.replacement ? { replacement: { ...permission.replacement } } : {}),
    ...(permission.castAsAdventureOnly === true ? { castAsAdventureOnly: true } : {}),
  };

  state.graveyardCastingPermissions = getGraveyardCastingPermissions(state).filter((existing) => existing?.id !== entry.id);
  state.graveyardCastingPermissions.push(entry);
  upsertDurablePermission(state, buildDurableGraveyardPermission({
    id: entry.id,
    playerId: entry.playerId,
    permission: entry.permission,
    cardFilter: entry.cardFilter,
    costMode: entry.costMode,
    duration: entry.duration,
    turnApplied: entry.turnApplied,
    sourceId: entry.sourceId,
    sourceName: entry.sourceName,
    sourceText: entry.sourceText,
    additionalCost: entry.additionalCost,
    usageLimit: entry.usageLimit,
    replacement: entry.replacement,
    castAsAdventureOnly: entry.castAsAdventureOnly === true,
  }));
  return entry;
}

export function mirrorGraveyardCastingPermissionsToDurable(state: any): void {
  if (!state) return;

  for (const permission of getGraveyardCastingPermissions(state)) {
    if (!permission?.id || !permission.playerId || !permission.permission) continue;

    upsertDurablePermission(state, buildDurableGraveyardPermission({
      id: permission.id,
      playerId: permission.playerId as PlayerID,
      permission: permission.permission,
      cardFilter: permission.cardFilter,
      costMode: permission.costMode,
      duration: permission.duration,
      turnApplied: permission.turnApplied,
      sourceId: permission.sourceId,
      sourceName: permission.sourceName,
      sourceText: permission.sourceText,
      additionalCost: permission.additionalCost,
      usageLimit: permission.usageLimit,
      replacement: permission.replacement,
      castAsAdventureOnly: permission.castAsAdventureOnly === true,
    }));
  }
}

export function getActiveGraveyardCastingPermissions(
  state: any,
  playerId: PlayerID,
  options?: { permission?: GraveyardCastingPermissionKind },
): GraveyardCastingPermission[] {
  const expectedPermission = options?.permission;
  const permissionsById = new Map<string, GraveyardCastingPermission>();
  for (const permission of [
    ...getGraveyardCastingPermissions(state),
    ...getDurableGraveyardCastingPermissions(state, playerId),
    ...getStaticSourceGraveyardCastingPermissions(state, playerId),
  ]) {
    const permissionId = String(permission?.id || '').trim();
    if (!permissionId || permissionsById.has(permissionId)) continue;
    permissionsById.set(permissionId, permission);
  }

  return [...permissionsById.values()].filter((permission) => {
    if (String(permission?.playerId || '') !== String(playerId || '')) return false;
    if (expectedPermission && permission.permission !== expectedPermission) return false;
    return graveyardCastingPermissionIsActive(state, permission);
  });
}

export function getMatchingGraveyardCastingPermission(
  state: any,
  playerId: PlayerID,
  card: any,
  permissionKind?: GraveyardCastingPermissionKind,
): GraveyardCastingPermission | undefined {
  const cardId = getCardId(card);
  return getActiveGraveyardCastingPermissions(state, playerId, permissionKind ? { permission: permissionKind } : undefined)
    .find((permission) => {
      const cardIds = Array.isArray(permission.cardFilter?.cardIds)
        ? permission.cardFilter.cardIds.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
      if (cardIds.length > 0 && !cardIds.includes(cardId)) {
        return false;
      }

      const qualifier = String(permission.cardFilter?.qualifier || '').trim();
      return !qualifier || qualifierMatchesCard(qualifier, card);
    });
}

function getCollapsedOracleText(card: any): string {
  return normalizeText(card?.oracle_text || card?.oracleText || '').replace(/\s+/g, ' ').trim();
}

function getSelfReferenceNames(card: any): string[] {
  const names = new Set<string>();
  const fullName = normalizeText(card?.name || '').trim();
  if (fullName) {
    names.add(fullName);
    const shortName = fullName.split(',')[0]?.trim();
    if (shortName) {
      names.add(shortName);
    }
  }

  return [...names];
}

function hasSelfCastReference(text: string, selfNames: string[]): boolean {
  if (text.includes('you may cast this card') || text.includes('you may play this card')) {
    return true;
  }

  return selfNames.some((name) => name && (
    text.includes(`you may cast ${name}`)
    || text.includes(`you may play ${name}`)
  ));
}

function singularizeTypeWord(value: string): string {
  const normalized = normalizeText(value).trim();
  if (normalized.endsWith('ies') && normalized.length > 3) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function getTypeQualifierWords(value: string): string[] {
  return normalizeText(value)
    .replace(/\band\/or\b/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\bor\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .split(/\s+/)
    .map((word) => singularizeTypeWord(word))
    .filter(Boolean);
}

function countControlledPermanentsMatchingQualifier(
  state: any,
  playerId: PlayerID,
  qualifier: string,
  options?: { tappedOnly?: boolean },
): number {
  const typeWords = getTypeQualifierWords(qualifier);
  if (typeWords.length === 0) {
    return 0;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (!permanent || permanent.phasedOut) return false;
    if (String(permanent.controller || permanent.owner || '') !== String(playerId || '')) {
      return false;
    }
    if (options?.tappedOnly && permanent.tapped !== true) {
      return false;
    }

    const permanentTypeWords = getTypeQualifierWords(getTypeLine(permanent?.card || permanent));
    return typeWords.some((word) => permanentTypeWords.includes(word));
  }).length;
}

function playerControlsTypeLineWord(state: any, playerId: PlayerID, word: string): boolean {
  const normalizedWord = normalizeText(word).trim();
  if (!normalizedWord) return false;

  return countControlledPermanentsMatchingQualifier(state, playerId, normalizedWord) > 0;
}

export function getPrintedSelfCastPermissionInfo(
  state: any,
  playerId: PlayerID,
  card: any,
  sourceZone: 'graveyard' | 'exile' = 'graveyard',
): PrintedSelfCastPermissionInfo {
  const oracleText = getCollapsedOracleText(card);
  if (!oracleText.includes('you may cast') && !oracleText.includes('you may play')) {
    return { hasIt: false };
  }

  const selfNames = getSelfReferenceNames(card);
  if (!hasSelfCastReference(oracleText, selfNames)) {
    return { hasIt: false };
  }

  const canCastFromGraveyard = oracleText.includes('from your graveyard');
  const canCastFromExile = oracleText.includes('from exile');
  if ((sourceZone === 'graveyard' && !canCastFromGraveyard) || (sourceZone === 'exile' && !canCastFromExile)) {
    return { hasIt: false };
  }

  if (/\bif you discarded it this turn\b/.test(oracleText)) {
    const currentTurn = getCurrentTurn(state);
    const discardedOnTurn = Number((card as any)?.discardedOnTurn ?? (card as any)?.discardedTurnNumber ?? 0) || 0;
    const discardedByPlayerId = String((card as any)?.discardedByPlayerId || '').trim();
    if (discardedOnTurn !== currentTurn || discardedByPlayerId !== String(playerId || '')) {
      return { hasIt: false };
    }
  }

  if (/\bduring your turn\b/.test(oracleText) && !isPlayersTurn(state, playerId)) {
    return { hasIt: false };
  }

  const multiTappedControlMatch = oracleText.match(/\bas long as you control (one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more tapped ([a-z0-9'/ -]+?)(?:[.,]|$)/i);
  if (multiTappedControlMatch) {
    const requiredCount = parseSmallNumber(multiTappedControlMatch[1]);
    const availableCount = countControlledPermanentsMatchingQualifier(state, playerId, multiTappedControlMatch[2], { tappedOnly: true });
    if (requiredCount > 0 && availableCount < requiredCount) {
      return { hasIt: false };
    }
  }

  const controlMatch = oracleText.match(/\bas long as you control (?:a|an)\s+([a-z0-9'-]+)/i);
  if (controlMatch && !playerControlsTypeLineWord(state, playerId, controlMatch[1])) {
    return { hasIt: false };
  }

  return {
    hasIt: true,
    ...(getManaCost(card) ? { cost: getManaCost(card) } : {}),
    ...(canCastFromExile ? { fromExile: true } : {}),
  };
}







export function buildCastFromGraveyardCard(card: any, abilityId: string): any {
  const normalizedAbilityId = String(abilityId || '').trim().toLowerCase();
  const nextCard: any = {
    ...card,
    zone: 'stack',
    castWithAbility: abilityId,
    castFromGraveyard: true,
    castSourceZone: 'graveyard',
  };

  if (normalizedAbilityId === 'escape') {
    nextCard.escapedFrom = 'graveyard';
    const escapeCounterCount = extractEscapeEntryCounterCount(String(card?.oracle_text || ''));
    if (escapeCounterCount > 0) {
      const existingCounters = nextCard.entersBattlefieldWithCounters && typeof nextCard.entersBattlefieldWithCounters === 'object'
        ? { ...(nextCard.entersBattlefieldWithCounters as Record<string, number>) }
        : {};
      existingCounters['+1/+1'] = Number(existingCounters['+1/+1'] || 0) + escapeCounterCount;
      nextCard.entersBattlefieldWithCounters = existingCounters;
    }
  }

  return nextCard;
}







export function clearTemporaryGraveyardKeywordGrants(state: any): number {
  if (!state || !Array.isArray(state.temporaryGraveyardKeywordGrants)) return 0;

  const remaining: TemporaryGraveyardKeywordGrant[] = [];
  const cleared: TemporaryGraveyardKeywordGrant[] = [];
  for (const entry of state.temporaryGraveyardKeywordGrants as TemporaryGraveyardKeywordGrant[]) {
    const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
    if (expiresAt === 'end_of_turn' || expiresAt === 'this_turn') {
      cleared.push(entry);
    } else {
      remaining.push(entry);
    }
  }

  if (remaining.length === 0) {
    delete state.temporaryGraveyardKeywordGrants;
  } else {
    state.temporaryGraveyardKeywordGrants = remaining;
  }

  for (const entry of cleared) {
    if (String(entry?.keyword || '') !== 'escape') continue;
    const cardId = String(entry?.cardId || '').trim();
    const playerId = String(entry?.playerId || '').trim() as PlayerID;
    if (!cardId || !playerId) continue;
    stripGenericGraveyardCastPermissionForCard(state, playerId, cardId, {
      sourceId: entry.sourceId,
      sourceName: entry.sourceName,
    });
  }

  return cleared.length;
}

export function clearTemporaryPlayableFromGraveyardPermissions(state: any): number {
  if (!state) return 0;

  let cleared = 0;

  if (Array.isArray(state.temporaryPlayableFromGraveyardPermissions)) {
    const before = state.temporaryPlayableFromGraveyardPermissions.length;
    state.temporaryPlayableFromGraveyardPermissions = state.temporaryPlayableFromGraveyardPermissions.filter((entry: any) => {
      const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
      return expiresAt !== 'end_of_turn' && expiresAt !== 'this_turn';
    });

    if (state.temporaryPlayableFromGraveyardPermissions.length === 0) {
      delete state.temporaryPlayableFromGraveyardPermissions;
    }

    cleared += before - (Array.isArray(state.temporaryPlayableFromGraveyardPermissions) ? state.temporaryPlayableFromGraveyardPermissions.length : 0);
  }

  if (Array.isArray(state.graveyardCastingPermissions)) {
    const before = state.graveyardCastingPermissions.length;
    state.graveyardCastingPermissions = state.graveyardCastingPermissions.filter((permission: GraveyardCastingPermission) => {
      const duration = normalizeGraveyardPermissionDuration(permission?.duration);
      return duration !== 'end_of_turn' && duration !== 'this_turn';
    });

    if (state.graveyardCastingPermissions.length === 0) {
      delete state.graveyardCastingPermissions;
    }

    cleared += before - (Array.isArray(state.graveyardCastingPermissions) ? state.graveyardCastingPermissions.length : 0);
  }

  clearTemporaryDurableGraveyardPermissions(state);

  return cleared;
}


export function applyGraveyardPermissionEffectsFromText(
  ctx: GameContext,
  playerId: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
): number {
  return (
    applyTemporaryGraveyardKeywordGrantFromText(ctx, playerId, sourceName, description, triggerItem)
    + applyPlayableFromGraveyardPermissionFromText(ctx, playerId, sourceName, description, triggerItem)
  );
}

function findGrantedKeywordInfo(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  keyword: GraveyardGrantKeyword,
): GrantedGraveyardKeywordInfo {
  try {
    const state = (ctx as any)?.state;
    if (!state || !card || typeof card === 'string') return { hasIt: false };

    const temporaryGrant = findTemporaryGrantedKeywordInfo(state, playerId, card, keyword);
    if (temporaryGrant.hasIt) return temporaryGrant;

    if (keyword === 'unearth' || keyword === 'embalm') {
      const durableGrant = getDurableGraveyardActivationPermissionForCard(state, playerId, card, keyword);
      if (durableGrant) {
        const metadata = durableGrant.metadata || {};
        const cost = String((metadata as any).cost || '').trim();
        const additionalExileCount = Number((metadata as any).additionalExileCount || 0) || 0;
        return {
          hasIt: true,
          ...(cost ? { cost } : {}),
          ...(additionalExileCount > 0 ? { additionalExileCount } : {}),
          ...(durableGrant.sourceId ? { sourceId: durableGrant.sourceId } : {}),
          ...(durableGrant.sourceName ? { sourceName: durableGrant.sourceName } : {}),
        };
      }
    }

    const keywordPattern = escapeRegExp(keyword);
    for (const source of collectStaticEffectSources(state)) {
      if (source.phasedOut) continue;
      if (!source.affectsAllPlayers && source.controller !== String(playerId || '')) continue;

      const oracleText = source.oracleText;
      if (!new RegExp(keywordPattern, 'i').test(oracleText) || !/graveyard/i.test(oracleText)) continue;
      if (/\bduring your turn\b/i.test(oracleText) && !isPlayersTurn(state, playerId)) continue;

      const lines = oracleText.split(/\r?\n/);
      for (const line of lines) {
        const normalizedLine = line.replace(/^\s*during\s+your\s+turn,\s*/i, '').trim();
        if (/\bgains?\b/i.test(normalizedLine)) continue;

        const grantPatterns = [
          new RegExp(`\\beach\\s+(.+?)\\s+cards?\\s+in\\s+(?:your\\s+)?graveyards?(?:\\s+that(?:'s| is)\\s+(.+?))?\\s+ha(?:s|ve)\\s+${keywordPattern}\\b([^.]*)`, 'i'),
          new RegExp(`^\\s*(.+?)\\s+cards?\\s+in\\s+(?:your\\s+)?graveyards?(?:\\s+that(?:'s| is)\\s+(.+?))?\\s+ha(?:s|ve)\\s+${keywordPattern}\\b([^.]*)`, 'i'),
        ];
        const grantMatch = grantPatterns.map((pattern) => normalizedLine.match(pattern)).find(Boolean);
        if (!grantMatch) continue;

        const qualifier = grantMatch[2]
          ? `${grantMatch[1]} that's ${grantMatch[2]}`
          : grantMatch[1];
        if (!qualifierMatchesCard(qualifier, card)) continue;

        const cost = extractGrantedKeywordCost(keyword, grantMatch[3] || '', oracleText, card);
        if (!cost) continue;

        return {
          hasIt: true,
          cost,
          ...(keyword === 'escape' ? { additionalExileCount: extractAdditionalEscapeExileCount(oracleText) } : {}),
          sourceId: source.sourceId,
            sourceName: source.sourceName || `${keyword} grant`,
        };
      }
    }

    return { hasIt: false };
  } catch {
    return { hasIt: false };
  }
}

export function getPrintedUnearthInfo(card: any): GrantedUnearthInfo {
  if (!card || typeof card === 'string') return { hasIt: false };

  const oracleText = String(card?.oracle_text || card?.oracleText || '');
  if (!/\bunearth\b/i.test(oracleText)) return { hasIt: false };

  const costMatch = oracleText.match(/unearth\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  return {
    hasIt: true,
    ...(costMatch?.[1] ? { cost: costMatch[1].trim() } : {}),
  };
}

export function getGrantedFlashbackInfo(ctx: GameContext, playerId: PlayerID, card: any): GrantedFlashbackInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, 'flashback') as GrantedFlashbackInfo;
}

export function getGrantedUnearthInfo(ctx: GameContext, playerId: PlayerID, card: any): GrantedUnearthInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, 'unearth') as GrantedUnearthInfo;
}

export function getGrantedEmbalmInfo(ctx: GameContext, playerId: PlayerID, card: any): GrantedUnearthInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, 'embalm') as GrantedUnearthInfo;
}

export function getGrantedCastFromGraveyardKeywordInfo(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  keyword: 'flashback' | 'jump-start' | 'retrace' | 'escape' | 'harmonize',
): GrantedGraveyardKeywordInfo {
  return findGrantedKeywordInfo(ctx, playerId, card, keyword);
}

setGraveyardPermissionsHandlerDeps({
  addGraveyardCastingPermission,
});
