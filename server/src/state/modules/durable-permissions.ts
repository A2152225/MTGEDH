import type { DurablePermission, DurablePermissionZone, PlayerID } from "../../../../shared/src";

export type DurableLandPlayZone = 'graveyard' | 'exile';
export type DurableGraveyardPermissionAction = 'play' | 'cast';
export type DurablePlayableFromExileAction = 'play' | 'cast';
export type DurableLibraryPermissionAction = 'play' | 'cast';
export type DurableCommandZonePermissionAction = 'cast';

const LAND_PLAY_KIND = 'land_play';
const GRAVEYARD_PERMISSION_KIND = 'graveyard_permission';
const PLAYABLE_FROM_EXILE_KIND = 'playable_from_exile';
const LIBRARY_PERMISSION_KIND = 'library_permission';
const COMMAND_ZONE_PERMISSION_KIND = 'command_zone_permission';

function sanitizeIdPart(value: unknown): string {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown';
}

function getCurrentTurn(state: any): number {
  return Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
}

function permissionMatchesPlayer(permission: DurablePermission, playerId?: PlayerID): boolean {
  return !playerId || String(permission.grantedTo || '') === String(playerId || '');
}

function permissionMatchesKind(permission: DurablePermission, kind?: string): boolean {
  return !kind || String(permission.kind || '') === String(kind || '');
}

function cardIdOf(card: any): string {
  return String(card?.id || card?.name || '').trim();
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function typeLineIncludesAll(card: any, includes: readonly string[] | undefined): boolean {
  if (!Array.isArray(includes) || includes.length === 0) return true;
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return includes.every((entry) => typeLine.includes(String(entry || '').trim().toLowerCase()));
}

function oracleTextIncludesAll(card: any, includes: readonly string[] | undefined): boolean {
  if (!Array.isArray(includes) || includes.length === 0) return true;
  const oracleText = String(card?.oracle_text || card?.oracleText || '').toLowerCase();
  return includes.every((entry) => oracleText.includes(String(entry || '').trim().toLowerCase()));
}

function durablePermissionMatchesCard(permission: DurablePermission, card: any): boolean {
  const filter = permission.cardFilter;
  if (!filter) return true;

  const affectedCardIds = normalizeStringArray(filter.affectedCardIds);
  if (affectedCardIds.length > 0 && !affectedCardIds.includes(cardIdOf(card))) {
    return false;
  }

  return typeLineIncludesAll(card, filter.typeLineIncludes)
    && oracleTextIncludesAll(card, filter.oracleTextIncludes);
}

function durablePlayableFromExilePermissionAllowsAction(
  permission: DurablePermission,
  action?: DurablePlayableFromExileAction,
): boolean {
  if (!Array.isArray(permission.allowedSourceZones) || !permission.allowedSourceZones.map(String).includes('exile')) {
    return false;
  }

  const allowedAction = String(permission.allowedAction || 'play');
  if (!action) {
    return allowedAction === 'play' || allowedAction === 'cast';
  }

  if (action === 'cast') {
    return allowedAction === 'play' || allowedAction === 'cast';
  }

  return allowedAction === 'play';
}

function durableLibraryPermissionAllowsAction(
  permission: DurablePermission,
  action?: DurableLibraryPermissionAction,
): boolean {
  if (!Array.isArray(permission.allowedSourceZones) || !permission.allowedSourceZones.map(String).includes('library')) {
    return false;
  }

  const allowedAction = String(permission.allowedAction || 'play');
  if (!action) {
    return allowedAction === 'play' || allowedAction === 'cast';
  }

  if (action === 'cast') {
    return allowedAction === 'play' || allowedAction === 'cast';
  }

  return allowedAction === 'play';
}

function durableCommandZonePermissionAllowsAction(
  permission: DurablePermission,
  action?: DurableCommandZonePermissionAction,
): boolean {
  if (!Array.isArray(permission.allowedSourceZones) || !permission.allowedSourceZones.map(String).includes('command')) {
    return false;
  }

  const allowedAction = String(permission.allowedAction || 'cast');
  return !action ? allowedAction === 'cast' : allowedAction === action;
}

export function getDurablePermissions(state: any): DurablePermission[] {
  return Array.isArray(state?.durablePermissions) ? [...state.durablePermissions] : [];
}

export function isDurablePermissionActive(state: any, permission: DurablePermission): boolean {
  const duration = String(permission?.duration || 'static');
  if (duration === 'static' || duration === 'while_source_remains') return true;

  const currentTurn = getCurrentTurn(state);
  if (typeof permission.expiresAtTurn === 'number') {
    return currentTurn <= permission.expiresAtTurn;
  }

  const turnApplied = Number(permission.turnApplied ?? currentTurn);
  if (duration === 'until_end_of_next_turn') return currentTurn <= turnApplied + 1;
  if (duration === 'this_turn' || duration === 'end_of_turn' || duration === 'one_shot') return currentTurn <= turnApplied;

  return true;
}

export function getActiveDurablePermissions(state: any, options?: { playerId?: PlayerID; kind?: string }): DurablePermission[] {
  return getDurablePermissions(state).filter((permission) => (
    permissionMatchesPlayer(permission, options?.playerId)
    && permissionMatchesKind(permission, options?.kind)
    && isDurablePermissionActive(state, permission)
  ));
}

export function upsertDurablePermission(state: any, permission: DurablePermission): DurablePermission {
  if (!state) return permission;
  const permissions = getDurablePermissions(state).filter((existing) => existing.id !== permission.id);
  permissions.push(permission);
  state.durablePermissions = permissions;
  return permission;
}

export function removeDurablePermissionsWhere(state: any, predicate: (permission: DurablePermission) => boolean): void {
  if (!state || !Array.isArray(state.durablePermissions)) return;
  state.durablePermissions = state.durablePermissions.filter((permission: DurablePermission) => !predicate(permission));
}

export function buildDurableLandPlayPermission(args: {
  playerId: PlayerID;
  zone: DurableLandPlayZone;
  sourceId?: string;
  sourceObjectId?: string;
  sourceName?: string;
  sourceText?: string;
  turnApplied?: number;
}): DurablePermission {
  const sourcePart = sanitizeIdPart(args.sourceObjectId || args.sourceId || args.sourceName || 'source');
  const playerPart = sanitizeIdPart(args.playerId);
  const zonePart = sanitizeIdPart(args.zone);
  return {
    id: `land_play:${playerPart}:${zonePart}:${sourcePart}`,
    kind: LAND_PLAY_KIND,
    grantedTo: args.playerId,
    allowedAction: 'play',
    origin: 'static_battlefield',
    duration: 'while_source_remains',
    sourceId: args.sourceId || args.sourceObjectId,
    sourceObjectId: args.sourceObjectId,
    sourceName: args.sourceName,
    sourceZone: 'battlefield',
    allowedSourceZones: [args.zone],
    allowedDestination: 'battlefield',
    cardFilter: { typeLineIncludes: ['land'] },
    costMode: 'normal',
    turnApplied: args.turnApplied,
    metadata: { legacyLandPlayZone: args.zone },
    debug: {
      reason: `play_lands_from_${args.zone}`,
      ...(args.sourceText ? { sourceText: args.sourceText } : {}),
    },
  };
}

export function buildDurableGraveyardPermission(args: {
  id: string;
  playerId: PlayerID;
  permission: DurableGraveyardPermissionAction;
  cardFilter?: {
    qualifier?: string;
    cardIds?: readonly string[];
  };
  costMode?: string;
  duration: string;
  turnApplied?: number;
  sourceId?: string;
  sourceName?: string;
  usageLimit?: {
    type: string;
    maxUses?: number;
  };
  replacement?: {
    exileAfterResolution?: boolean;
    leaveBattlefieldDestination?: DurablePermissionZone;
    leaveBattlefieldLifeGain?: number;
    sourceName?: string;
  };
}): DurablePermission {
  const affectedCardIds = Array.isArray(args.cardFilter?.cardIds)
    ? args.cardFilter.cardIds.map((cardId) => String(cardId || '').trim()).filter(Boolean)
    : [];
  const qualifier = String(args.cardFilter?.qualifier || '').trim();

  return {
    id: args.id,
    kind: GRAVEYARD_PERMISSION_KIND,
    grantedTo: args.playerId,
    allowedAction: args.permission,
    origin: args.duration === 'static' ? 'static_battlefield' : 'temporary',
    duration: args.duration,
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(args.sourceName ? { sourceName: args.sourceName } : {}),
    sourceZone: 'graveyard',
    allowedSourceZones: ['graveyard'],
    allowedDestination: args.permission === 'cast' ? 'stack' : 'battlefield',
    cardFilter: {
      ...(affectedCardIds.length > 0 ? { affectedCardIds } : {}),
      ...(qualifier ? { qualifier } : {}),
    },
    costMode: args.costMode || 'normal',
    ...(args.usageLimit ? { usageLimit: { ...args.usageLimit } } : {}),
    ...(args.replacement ? { replacement: { ...args.replacement } } : {}),
    ...(typeof args.turnApplied === 'number' ? { turnApplied: args.turnApplied } : {}),
    metadata: { graveyardPermissionId: args.id },
    debug: {
      reason: `${args.permission}_from_graveyard`,
      ...(args.sourceName ? { notes: [`Granted by ${args.sourceName}`] } : {}),
    },
  };
}

export function buildDurablePlayableFromExilePermission(args: {
  playerId: PlayerID;
  cardIds: readonly string[];
  action?: DurablePlayableFromExileAction;
  duration: string;
  turnApplied?: number;
  expiresAtTurn?: number;
  sourceId?: string;
  sourceName?: string;
  sourceText?: string;
  costMode?: string;
  spendManaAsThoughAnyType?: boolean;
  typeLineIncludes?: readonly string[];
  oracleTextIncludes?: readonly string[];
}): DurablePermission {
  const affectedCardIds = normalizeStringArray(args.cardIds);
  const action = args.action || 'play';
  const sourcePart = sanitizeIdPart(args.sourceId || args.sourceName || 'source');
  const playerPart = sanitizeIdPart(args.playerId);
  const cardsPart = sanitizeIdPart(affectedCardIds.join('_') || 'cards');

  return {
    id: `playable_from_exile:${playerPart}:${cardsPart}:${sourcePart}`,
    kind: PLAYABLE_FROM_EXILE_KIND,
    grantedTo: args.playerId,
    allowedAction: action,
    origin: args.duration === 'static' ? 'static_battlefield' : 'temporary',
    duration: args.duration,
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(args.sourceName ? { sourceName: args.sourceName } : {}),
    sourceZone: 'exile',
    allowedSourceZones: ['exile'],
    ...(action === 'cast' ? { allowedDestination: 'stack' } : {}),
    cardFilter: {
      ...(affectedCardIds.length > 0 ? { affectedCardIds } : {}),
      ...(Array.isArray(args.typeLineIncludes) && args.typeLineIncludes.length > 0 ? { typeLineIncludes: [...args.typeLineIncludes] } : {}),
      ...(Array.isArray(args.oracleTextIncludes) && args.oracleTextIncludes.length > 0 ? { oracleTextIncludes: [...args.oracleTextIncludes] } : {}),
    },
    costMode: args.costMode || 'normal',
    ...(typeof args.turnApplied === 'number' ? { turnApplied: args.turnApplied } : {}),
    ...(typeof args.expiresAtTurn === 'number' ? { expiresAtTurn: args.expiresAtTurn } : {}),
    metadata: {
      legacyPlayableFromExile: true,
      ...(args.spendManaAsThoughAnyType === true ? { spendManaAsThoughAnyType: true } : {}),
    },
    debug: {
      reason: `${action}_from_exile`,
      ...(args.sourceText ? { sourceText: args.sourceText } : {}),
      ...(args.sourceName ? { notes: [`Granted by ${args.sourceName}`] } : {}),
    },
  };
}

export function buildDurableLibraryPermission(args: {
  playerId: PlayerID;
  action?: DurableLibraryPermissionAction;
  duration: string;
  turnApplied?: number;
  expiresAtTurn?: number;
  sourceId?: string;
  sourceObjectId?: string;
  sourceName?: string;
  sourceText?: string;
  costMode?: string;
  spendManaAsThoughAnyType?: boolean;
  grantsFlash?: boolean;
  typeLineIncludes?: readonly string[];
  oracleTextIncludes?: readonly string[];
}): DurablePermission {
  const action = args.action || 'play';
  const sourcePart = sanitizeIdPart(args.sourceObjectId || args.sourceId || args.sourceName || 'source');
  const playerPart = sanitizeIdPart(args.playerId);

  return {
    id: `library_permission:${playerPart}:${action}:${sourcePart}`,
    kind: LIBRARY_PERMISSION_KIND,
    grantedTo: args.playerId,
    allowedAction: action,
    origin: args.duration === 'static' || args.duration === 'while_source_remains' ? 'static_battlefield' : 'temporary',
    duration: args.duration,
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(args.sourceObjectId ? { sourceObjectId: args.sourceObjectId } : {}),
    ...(args.sourceName ? { sourceName: args.sourceName } : {}),
    sourceZone: 'battlefield',
    allowedSourceZones: ['library'],
    ...(action === 'cast' ? { allowedDestination: 'stack' } : {}),
    cardFilter: {
      ...(Array.isArray(args.typeLineIncludes) && args.typeLineIncludes.length > 0 ? { typeLineIncludes: [...args.typeLineIncludes] } : {}),
      ...(Array.isArray(args.oracleTextIncludes) && args.oracleTextIncludes.length > 0 ? { oracleTextIncludes: [...args.oracleTextIncludes] } : {}),
    },
    costMode: args.costMode || 'normal',
    ...(args.grantsFlash === true ? { timingOverride: { asThoughFlash: true } } : {}),
    ...(typeof args.turnApplied === 'number' ? { turnApplied: args.turnApplied } : {}),
    ...(typeof args.expiresAtTurn === 'number' ? { expiresAtTurn: args.expiresAtTurn } : {}),
    metadata: {
      topLibraryPermission: true,
      ...(args.spendManaAsThoughAnyType === true ? { spendManaAsThoughAnyType: true } : {}),
    },
    debug: {
      reason: `${action}_from_library`,
      ...(args.sourceText ? { sourceText: args.sourceText } : {}),
      ...(args.sourceName ? { notes: [`Granted by ${args.sourceName}`] } : {}),
    },
  };
}

export function buildDurableCommandZonePermission(args: {
  playerId: PlayerID;
  action?: DurableCommandZonePermissionAction;
  duration: string;
  turnApplied?: number;
  expiresAtTurn?: number;
  sourceId?: string;
  sourceObjectId?: string;
  sourceName?: string;
  sourceText?: string;
  costMode?: string;
  spendManaAsThoughAnyType?: boolean;
  grantsFlash?: boolean;
  cardIds?: readonly string[];
  typeLineIncludes?: readonly string[];
  oracleTextIncludes?: readonly string[];
}): DurablePermission {
  const action = args.action || 'cast';
  const affectedCardIds = normalizeStringArray(args.cardIds);
  const sourcePart = sanitizeIdPart(args.sourceObjectId || args.sourceId || args.sourceName || 'source');
  const playerPart = sanitizeIdPart(args.playerId);

  return {
    id: `command_zone_permission:${playerPart}:${action}:${sourcePart}`,
    kind: COMMAND_ZONE_PERMISSION_KIND,
    grantedTo: args.playerId,
    allowedAction: action,
    origin: args.duration === 'static' || args.duration === 'while_source_remains' ? 'static_battlefield' : 'temporary',
    duration: args.duration,
    ...(args.sourceId ? { sourceId: args.sourceId } : {}),
    ...(args.sourceObjectId ? { sourceObjectId: args.sourceObjectId } : {}),
    ...(args.sourceName ? { sourceName: args.sourceName } : {}),
    sourceZone: 'command',
    allowedSourceZones: ['command'],
    allowedDestination: 'stack',
    cardFilter: {
      ...(affectedCardIds.length > 0 ? { affectedCardIds } : {}),
      ...(Array.isArray(args.typeLineIncludes) && args.typeLineIncludes.length > 0 ? { typeLineIncludes: [...args.typeLineIncludes] } : {}),
      ...(Array.isArray(args.oracleTextIncludes) && args.oracleTextIncludes.length > 0 ? { oracleTextIncludes: [...args.oracleTextIncludes] } : {}),
    },
    costMode: args.costMode || 'normal',
    ...(args.grantsFlash === true ? { timingOverride: { asThoughFlash: true } } : {}),
    ...(typeof args.turnApplied === 'number' ? { turnApplied: args.turnApplied } : {}),
    ...(typeof args.expiresAtTurn === 'number' ? { expiresAtTurn: args.expiresAtTurn } : {}),
    metadata: {
      commandZonePermission: true,
      ...(args.spendManaAsThoughAnyType === true ? { spendManaAsThoughAnyType: true } : {}),
    },
    debug: {
      reason: `${action}_from_command_zone`,
      ...(args.sourceText ? { sourceText: args.sourceText } : {}),
      ...(args.sourceName ? { notes: [`Granted by ${args.sourceName}`] } : {}),
    },
  };
}

export function clearDurableLandPlayPermissionsForPlayer(state: any, playerId: PlayerID): void {
  removeDurablePermissionsWhere(state, (permission) => (
    String(permission.kind || '') === LAND_PLAY_KIND
    && String(permission.grantedTo || '') === String(playerId || '')
    && String(permission.origin || '') === 'static_battlefield'
  ));
}

export function playerHasDurableLandPlayPermission(state: any, playerId: PlayerID, zone: DurableLandPlayZone): boolean {
  return getActiveDurablePermissions(state, { playerId, kind: LAND_PLAY_KIND }).some((permission) => (
    permission.allowedAction === 'play'
    && Array.isArray(permission.allowedSourceZones)
    && permission.allowedSourceZones.map((entry: DurablePermissionZone) => String(entry)).includes(zone)
  ));
}

export function getDurablePlayableFromExilePermissionForCard(
  state: any,
  playerId: PlayerID,
  card: any,
  action?: DurablePlayableFromExileAction,
): DurablePermission | undefined {
  return getActiveDurablePermissions(state, { playerId, kind: PLAYABLE_FROM_EXILE_KIND }).find((permission) => (
    durablePlayableFromExilePermissionAllowsAction(permission, action)
    && durablePermissionMatchesCard(permission, card)
  ));
}

export function getDurableLibraryPermissionForCard(
  state: any,
  playerId: PlayerID,
  card: any,
  action?: DurableLibraryPermissionAction,
): DurablePermission | undefined {
  return getActiveDurablePermissions(state, { playerId, kind: LIBRARY_PERMISSION_KIND }).find((permission) => (
    durableLibraryPermissionAllowsAction(permission, action)
    && durablePermissionMatchesCard(permission, card)
  ));
}

export function getDurableCommandZonePermissionForCard(
  state: any,
  playerId: PlayerID,
  card: any,
  action?: DurableCommandZonePermissionAction,
): DurablePermission | undefined {
  return getActiveDurablePermissions(state, { playerId, kind: COMMAND_ZONE_PERMISSION_KIND }).find((permission) => (
    durableCommandZonePermissionAllowsAction(permission, action)
    && durablePermissionMatchesCard(permission, card)
  ));
}

export function removeCardIdFromDurablePlayableFromExilePermissions(state: any, cardId: string): void {
  const normalizedCardId = String(cardId || '').trim();
  if (!state || !normalizedCardId || !Array.isArray(state.durablePermissions)) return;

  const updated: DurablePermission[] = [];
  for (const permission of state.durablePermissions as DurablePermission[]) {
    if (String(permission.kind || '') !== PLAYABLE_FROM_EXILE_KIND) {
      updated.push(permission);
      continue;
    }

    const affectedCardIds = normalizeStringArray(permission.cardFilter?.affectedCardIds);
    if (affectedCardIds.length === 0 || !affectedCardIds.includes(normalizedCardId)) {
      updated.push(permission);
      continue;
    }

    const remainingCardIds = affectedCardIds.filter((entry) => entry !== normalizedCardId);
    if (remainingCardIds.length === 0) {
      continue;
    }

    updated.push({
      ...permission,
      cardFilter: {
        ...(permission.cardFilter || {}),
        affectedCardIds: remainingCardIds,
      },
    });
  }

  state.durablePermissions = updated;
}

export function clearTemporaryDurableGraveyardPermissions(state: any): number {
  const before = getDurablePermissions(state).length;
  removeDurablePermissionsWhere(state, (permission) => {
    if (String(permission.kind || '') !== GRAVEYARD_PERMISSION_KIND) return false;
    const duration = String(permission.duration || '').trim().toLowerCase();
    return duration === 'end_of_turn' || duration === 'this_turn';
  });
  return before - getDurablePermissions(state).length;
}