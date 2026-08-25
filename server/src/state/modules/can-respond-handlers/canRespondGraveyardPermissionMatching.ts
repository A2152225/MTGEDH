// server/src/state/modules/can-respond-handlers/canRespondGraveyardPermissionMatching.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: first-class graveyard permission matching, qualifiers,
// synthetic permission metadata, and related text helpers used by
// getSpecificSpellFromGraveyardPermission / getSpecificLandFromGraveyardPermission.
// Public entry symbols: normalizeRuleText, buildSyntheticGraveyardPermissionMetadata,
// findMatchingFirstClassGraveyardPermission, firstClassPermissionLeaveBattlefieldDestination,
// firstClassPermissionLeaveBattlefieldLifeGain, getGraveyardPermissionCostModeFromText,
// hasMarkedGraveyardPermission, isPlayersTurnForPermission,
// getGraveyardPermissionTextSources, isStaticGraveyardPermissionLine,
// spellQualifierMatchesCard, firstClassPermissionExilesSpell,
// getGraveyardPermanentTypesCastThisTurn, landQualifierMatchesCard.

import type { PlayerID } from '../../../../../shared/src/index.js';
import {
  buildGraveyardCastingPermissionId,
  getActiveGraveyardCastingPermissions,
  type GraveyardCastingPermission,
  type GraveyardCastingPermissionCostMode,
} from '../graveyard-permissions.js';
import { collectStaticEffectSources } from '../static-effect-sources.js';
import { cardManaValue } from '../../utils.js';
import { isLandTypeLine } from './canRespondSplitSecondLandPredicates.js';
import { isPermanentSpellType } from './canRespondSpellTypePredicates.js';

export function normalizeRuleText(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function singularizeQualifierWord(value: string): string {
  const normalized = normalizeRuleText(value).trim();
  if (normalized.endsWith('ies') && normalized.length > 3) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function getNormalizedTypeLine(card: any): string {
  return normalizeRuleText(card?.type_line || card?.typeLine);
}

function graveyardPermissionCardIds(permission: GraveyardCastingPermission): Set<string> {
  const ids = Array.isArray(permission?.cardFilter?.cardIds)
    ? permission.cardFilter.cardIds
    : [];
  return new Set(ids.map((cardId) => String(cardId || '').trim()).filter(Boolean));
}

function firstClassGraveyardPermissionUseAvailable(
  state: any,
  playerId: PlayerID,
  permission: GraveyardCastingPermission,
  card: any,
): boolean {
  const limitType = String(permission?.usageLimit?.type || '').trim().toLowerCase();
  if (!limitType) return true;

  if (limitType === 'once' || limitType === 'once_per_turn') {
    if (permission.permission === 'play') {
      return !Boolean((state as any)?.playedLandFromGraveyardThisTurn?.[playerId]);
    }
    return !Boolean((state as any)?.castFromGraveyardThisTurn?.[playerId]);
  }

  if (limitType === 'one_per_permanent_type') {
    const usedPermanentTypes = getGraveyardPermanentTypesUsedThisTurn(state, playerId);
    if (permission.permission === 'play') {
      return !usedPermanentTypes.has('land');
    }

    const cardTypes = getPermanentSpellTypes(card);
    if (cardTypes.length === 0) return false;
    return cardTypes.every((typeWord) => !usedPermanentTypes.has(typeWord));
  }

  return true;
}

export function findMatchingFirstClassGraveyardPermission(
  state: any,
  playerId: PlayerID,
  card: any,
  permissionKind: 'play' | 'cast',
  usedPermanentTypes: Set<string> = new Set<string>(),
): GraveyardCastingPermission | undefined {
  if (!state || !card || typeof card === 'string') return undefined;

  const cardId = String(card?.id || '').trim();
  for (const permission of getActiveGraveyardCastingPermissions(state, playerId, { permission: permissionKind })) {
    if (!firstClassGraveyardPermissionUseAvailable(state, playerId, permission, card)) continue;

    const cardIds = graveyardPermissionCardIds(permission);
    if (cardId && cardIds.has(cardId)) {
      return permission;
    }
    if (cardIds.size > 0) {
      continue;
    }

    const qualifier = String(permission?.cardFilter?.qualifier || '').trim();
    if (!qualifier) continue;

    if (permissionKind === 'play') {
      if (landQualifierMatchesCard(card, qualifier)) {
        return permission;
      }
      continue;
    }

    if (spellQualifierMatchesCard(card, qualifier, usedPermanentTypes)) {
      return permission;
    }
  }

  return undefined;
}

export function firstClassPermissionExilesSpell(permission: GraveyardCastingPermission | undefined): boolean {
  return permission?.replacement?.exileAfterResolution === true;
}

export function firstClassPermissionLeaveBattlefieldDestination(permission: GraveyardCastingPermission | undefined): 'exile' | undefined {
  return permission?.replacement?.leaveBattlefieldDestination === 'exile' ? 'exile' : undefined;
}

export function firstClassPermissionLeaveBattlefieldLifeGain(permission: GraveyardCastingPermission | undefined): number | undefined {
  const amount = Number(permission?.replacement?.leaveBattlefieldLifeGain || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

export function getGraveyardPermissionCostModeFromText(text: unknown): GraveyardCastingPermissionCostMode {
  const normalized = normalizeRuleText(text).replace(/\s+/g, ' ').trim();
  return /\bwithout paying (?:its|their|that spell's) mana cost\b/.test(normalized)
    ? 'without_paying_mana_cost'
    : 'normal';
}

export function buildSyntheticGraveyardPermissionMetadata(
  playerId: PlayerID,
  permission: 'play' | 'cast',
  options: {
    sourceId?: string;
    sourceName?: string;
    qualifier?: string;
    cardId?: string;
    costMode?: GraveyardCastingPermissionCostMode;
    replacement?: { exileAfterResolution?: boolean; leaveBattlefieldDestination?: 'exile'; leaveBattlefieldLifeGain?: number; sourceName?: string };
  },
): {
  graveyardPermissionId: string;
  graveyardPermissionSourceName?: string;
  graveyardPermissionCostMode: GraveyardCastingPermissionCostMode;
} {
  const sourceId = String(options.sourceId || options.cardId || options.sourceName || 'graveyard_source').trim();
  const sourceName = String(options.sourceName || '').trim();
  const cardId = String(options.cardId || '').trim();
  const qualifier = String(options.qualifier || '').trim();
  const costMode = options.costMode || 'normal';
  const graveyardPermissionId = buildGraveyardCastingPermissionId({
    playerId: String(playerId || ''),
    permission,
    sourceZone: 'graveyard',
    cardFilter: {
      ...(cardId ? { cardIds: [cardId] } : {}),
      ...(qualifier ? { qualifier } : {}),
    },
    costMode,
    duration: 'static',
    sourceId,
    ...(sourceName ? { sourceName } : {}),
    ...(options.replacement ? { replacement: { ...options.replacement } } : {}),
  });

  return {
    graveyardPermissionId,
    ...(sourceName ? { graveyardPermissionSourceName: sourceName } : {}),
    graveyardPermissionCostMode: costMode,
  };
}

export function hasMarkedGraveyardPermission(state: any, playerId: PlayerID, card: any): boolean {
  const cardId = String(card?.id || '').trim();
  if (!cardId) return false;

  const currentTurn = Number((state as any)?.turnNumber ?? (state as any)?.turn ?? 0) || 0;
  const playableFromGraveyard = (state as any)?.playableFromGraveyard?.[playerId];
  const marker = playableFromGraveyard && typeof playableFromGraveyard === 'object'
    ? playableFromGraveyard[cardId]
    : undefined;
  const stateAllows = typeof marker === 'number'
    ? marker >= currentTurn
    : Boolean(marker);

  const cardAllows = String(card?.canBePlayedBy || '').trim() === String(playerId || '')
    && (
      typeof card?.playableUntilTurn === 'number'
        ? card.playableUntilTurn >= currentTurn
        : Boolean(card?.playableUntilTurn)
    );

  const firstClassSpecificAllows = getActiveGraveyardCastingPermissions(state, playerId).some((permission) =>
    graveyardPermissionCardIds(permission).has(cardId)
    && firstClassGraveyardPermissionUseAvailable(state, playerId, permission, card)
  );

  const temporaryAllows = Array.isArray((state as any)?.temporaryPlayableFromGraveyardPermissions)
    && (state as any).temporaryPlayableFromGraveyardPermissions.some((entry: any) => {
      if (String(entry?.playerId || '') !== String(playerId || '')) return false;

      const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
      const turnApplied = Number(entry?.turnApplied ?? currentTurn) || 0;
      if ((expiresAt === 'end_of_turn' || expiresAt === 'this_turn') && turnApplied < currentTurn) {
        return false;
      }

      const qualifier = String(entry?.qualifier || '').trim();
      if (!qualifier) return false;

      const typeLine = getNormalizedTypeLine(card);
      const permission = String(entry?.permission || '').trim().toLowerCase();
      if (permission === 'play' && /\bland\b/.test(typeLine)) {
        return landQualifierMatchesCard(card, qualifier);
      }

      if ((permission === 'cast' || permission === 'play') && !/\bland\b/.test(typeLine)) {
        return spellQualifierMatchesCard(card, qualifier, new Set<string>());
      }

      return false;
    });

  return stateAllows || cardAllows || firstClassSpecificAllows || temporaryAllows;
}

export function isPlayersTurnForPermission(state: any, playerId: PlayerID): boolean {
  return String(state?.turnPlayer || state?.activePlayer || '') === String(playerId || '');
}

export function getGraveyardPermissionTextSources(state: any, playerId: PlayerID): Array<{ sourceId: string; oracleText: string; typeLine: string; sourceName: string; counters?: any }> {
  return collectStaticEffectSources(state)
    .filter((source) => !source.phasedOut && (source.affectsAllPlayers || source.controller === String(playerId || '')))
    .map((source) => ({
      sourceId: String(source.sourceId || '').trim(),
      oracleText: String(source.oracleText || ''),
      typeLine: normalizeRuleText(source.typeLine || ''),
      sourceName: String(source.sourceName || '').trim(),
      ...(source.counters ? { counters: source.counters } : {}),
    }));
}

function isHistoricCard(card: any): boolean {
  const typeLine = getNormalizedTypeLine(card);
  return /\blegendary\b/.test(typeLine) || /\bartifact\b/.test(typeLine) || /\bsaga\b/.test(typeLine);
}

function typeLineHasWord(card: any, word: string): boolean {
  const normalizedWord = singularizeQualifierWord(word);
  if (!normalizedWord) return false;
  return new RegExp(`\\b${escapeRegExp(normalizedWord)}\\b`, 'i').test(getNormalizedTypeLine(card));
}

function getPermanentSpellTypes(card: any): string[] {
  const typeLine = getNormalizedTypeLine(card);
  return ['artifact', 'creature', 'enchantment', 'planeswalker', 'battle']
    .filter((typeWord) => new RegExp(`\\b${typeWord}\\b`, 'i').test(typeLine));
}

export function getGraveyardPermanentTypesCastThisTurn(state: any, playerId: PlayerID): Set<string> {
  const entry = (state as any)?.graveyardPermanentTypesCastThisTurn?.[playerId];
  if (Array.isArray(entry)) {
    return new Set(entry.map((typeWord: unknown) => String(typeWord || '').toLowerCase()).filter(Boolean));
  }

  if (entry && typeof entry === 'object') {
    return new Set(
      Object.entries(entry)
        .filter(([, used]) => Boolean(used))
        .map(([typeWord]) => String(typeWord || '').toLowerCase())
        .filter(Boolean),
    );
  }

  return new Set<string>();
}

function getGraveyardPermanentTypesUsedThisTurn(state: any, playerId: PlayerID): Set<string> {
  const usedTypes = getGraveyardPermanentTypesCastThisTurn(state, playerId);
  if (Boolean((state as any)?.playedLandFromGraveyardThisTurn?.[playerId])) {
    usedTypes.add('land');
  }
  return usedTypes;
}

function isSelfReferentialGraveyardCastLine(line: string): boolean {
  const normalized = normalizeRuleText(line);
  // Printed self-cast (Gravecrawler, etc.) only applies while the card is in the GY.
  // Battlefield sources must not mint an open "this card" cast permission for other GY cards.
  return /\byou may (?:cast|play) (?:this|that) (?:card|permanent|spell|land)s?\b/.test(normalized);
}

function isSelfReferentialGraveyardQualifier(qualifier: string): boolean {
  const normalized = normalizeRuleText(qualifier)
    .replace(/\s+as long as\b[\s\S]*$/i, '')
    .trim();
  return /^(?:this|that)\s+(?:card|permanent|spell|land)s?$/i.test(normalized)
    || /^(?:it|~)$/i.test(normalized);
}

export function isStaticGraveyardPermissionLine(line: string): boolean {
  const normalized = normalizeRuleText(line);
  if (!normalized.includes('graveyard')) return false;
  if (!normalized.includes('you may play') && !normalized.includes('you may cast') && !normalized.includes(' cast ')) return false;
  if (normalized.includes(':')) return false;
  if (/^\s*(when|whenever|at the beginning)\b/.test(normalized)) return false;
  if (isSelfReferentialGraveyardCastLine(normalized)) return false;
  return true;
}

export function landQualifierMatchesCard(card: any, qualifier: string): boolean {
  if (!isLandTypeLine(getNormalizedTypeLine(card))) return false;

  const normalized = normalizeRuleText(qualifier)
    .split(/\s+(?:and|or)\s+cast\b/i)[0]
    .trim();

  if (isSelfReferentialGraveyardQualifier(normalized)) {
    return false;
  }

  if (/\bpermanent cards? of each permanent type\b/.test(normalized)) {
    return true;
  }

  if (/\bhistoric\b/.test(normalized) && !isHistoricCard(card)) {
    return false;
  }

  const remainder = normalized
    .replace(/\bhistoric\b/g, ' ')
    .replace(/\bland cards?\b/g, ' ')
    .replace(/\blands?\b/g, ' ')
    .replace(/\b(?:a|an|the|this|that)\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .trim();

  if (!remainder) {
    return true;
  }

  return remainder
    .split(/\s+/)
    .map((word) => singularizeQualifierWord(word))
    .filter(Boolean)
    .every((word) => typeLineHasWord(card, word));
}

export function spellQualifierMatchesCard(card: any, qualifier: string, usedPermanentTypes: Set<string>): boolean {
  const typeLine = getNormalizedTypeLine(card);
  if (isLandTypeLine(typeLine)) return false;

  let normalized = normalizeRuleText(qualifier).trim();

  if (isSelfReferentialGraveyardQualifier(normalized)) {
    return false;
  }

  if (/\bhistoric\b/.test(normalized) && !isHistoricCard(card)) {
    return false;
  }

  const manaValueLimitMatch = normalized.match(/\bmana value\s+(\d+)\s+or less\b/);
  if (manaValueLimitMatch && cardManaValue(card) > Number(manaValueLimitMatch[1])) {
    return false;
  }

  if (/\bpermanent (?:spell|card) of each permanent type\b/.test(normalized)
    || /\bpermanent (?:spells|cards) of each permanent type\b/.test(normalized)) {
    if (!isPermanentSpellType(typeLine)) return false;
    const cardTypes = getPermanentSpellTypes(card);
    return cardTypes.length > 0 && cardTypes.every((typeWord) => !usedPermanentTypes.has(typeWord));
  }

  if (/\binstant\s+or\s+sorcery\s+spell\b/.test(normalized) || /\binstant\s+or\s+sorcery\s+spells\b/.test(normalized)) {
    if (!(typeLine.includes('instant') || typeLine.includes('sorcery'))) {
      return false;
    }
    normalized = normalized.replace(/\binstant\b/g, ' ').replace(/\bsorcery\b/g, ' ');
  } else {
    const typeRestrictions: Array<{ marker: RegExp; allowed: boolean; strip: RegExp }> = [
      { marker: /\bpermanent\s+spell\b|\bpermanent\s+spells\b/, allowed: isPermanentSpellType(typeLine), strip: /\bpermanent\b/g },
      { marker: /\bcreature\s+spell\b|\bcreature\s+spells\b/, allowed: typeLine.includes('creature'), strip: /\bcreature\b/g },
      { marker: /\bartifact\s+spell\b|\bartifact\s+spells\b/, allowed: typeLine.includes('artifact'), strip: /\bartifact\b/g },
      { marker: /\benchantment\s+spell\b|\benchantment\s+spells\b/, allowed: typeLine.includes('enchantment'), strip: /\benchantment\b/g },
      { marker: /\bplaneswalker\s+spell\b|\bplaneswalker\s+spells\b/, allowed: typeLine.includes('planeswalker'), strip: /\bplaneswalker\b/g },
      { marker: /\bbattle\s+spell\b|\bbattle\s+spells\b/, allowed: typeLine.includes('battle'), strip: /\bbattle\b/g },
      { marker: /\binstant\s+spell\b|\binstant\s+spells\b/, allowed: typeLine.includes('instant'), strip: /\binstant\b/g },
      { marker: /\bsorcery\s+spell\b|\bsorcery\s+spells\b/, allowed: typeLine.includes('sorcery'), strip: /\bsorcery\b/g },
    ];

    for (const restriction of typeRestrictions) {
      if (!restriction.marker.test(normalized)) continue;
      if (!restriction.allowed) return false;
      normalized = normalized.replace(restriction.strip, ' ');
    }
  }

  const remainder = normalized
    .replace(/\bhistoric\b/g, ' ')
    .replace(/\bmana value\s+\d+\s+or less\b/g, ' ')
    .replace(/\b(?:a|an|the|this|that|spell|spells|card|cards|permanent|permanents|once|during|each|of|your|turn|turns|with|mana|value|or|less)\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .trim();

  if (!remainder) {
    return true;
  }

  return remainder
    .split(/\s+/)
    .map((word) => singularizeQualifierWord(word))
    .filter(Boolean)
    .every((word) => typeLineHasWord(card, word));
}
