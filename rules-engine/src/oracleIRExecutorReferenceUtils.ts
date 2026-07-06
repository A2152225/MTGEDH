import type { GameState, PlayerID } from '../../shared/src';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  collectLedgerCardsAtAntecedent,
  resolveLedgerAntecedentStepIndex,
} from './oracleIRLedgerCardAccess';
import type { OracleEffectStep } from './oracleIR';
import { snapshotToCardLike } from './oracleIRLedgerCardAccess';
export type ReferencedObjectRole = 'controller' | 'owner';

export interface ReferencedObjectRuntime {
  readonly lastMovedCards?: readonly any[];
  readonly lastSacrificedPermanents?: readonly any[];
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim();
}

function getSingleChosenObjectId(ctx: OracleIRExecutionContext): string {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const normalized = chosen.map((id) => String(id || '').trim()).filter(Boolean);
  return normalized.length === 1 ? normalized[0] : '';
}

function collectRecentLedgerObjects(ctx: OracleIRExecutionContext): readonly any[] {
  const ledger = ctx.stepLedger;
  if (!ledger?.size) return [];

  const indexes =
    ctx.currentStepIndex != null
      ? Array.from({ length: ctx.currentStepIndex }, (_, offset) => ctx.currentStepIndex! - 1 - offset)
      : [...ledger.keys()]
          .map((key) => Number(key))
          .filter((index) => Number.isFinite(index))
          .sort((left, right) => right - left);

  for (const index of indexes) {
    const snapshots = ledger.get(index);
    if (!snapshots?.length) continue;
    return snapshots.map((snap) => ({
      id: snap.objectId,
      objectId: snap.objectId,
      controller: snap.controllerId ?? snap.ownerId,
      controllerId: snap.controllerId ?? snap.ownerId,
      owner: snap.ownerId,
      ownerId: snap.ownerId,
      card: snapshotToCardLike(snap),
      name: snap.name,
      type_line: snap.typeLine,
    }));
  }

  return [];
}

function collectMovedSnapshots(
  ctx: OracleIRExecutionContext,
  runtime?: ReferencedObjectRuntime
): readonly any[] {
  return [
    ...collectRecentLedgerObjects(ctx),
    ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
    ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
    ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
    ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
  ];
}

function findSnapshotById(snapshots: readonly any[], id: string): any | null {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return null;
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = snapshots[i];
    if (normalizeId((snapshot as any)?.id) === normalizedId) return snapshot;
  }
  return null;
}

function getPlayerIdFromObject(obj: any, role: ReferencedObjectRole): string {
  if (role === 'owner') {
    return normalizeId(
      obj?.owner ??
        obj?.ownerId ??
        obj?.card?.owner ??
        obj?.card?.ownerId ??
        obj?.controller ??
        obj?.controllerId ??
        obj?.card?.controller ??
        obj?.card?.controllerId
    );
  }
  return normalizeId(
    obj?.controller ??
      obj?.controllerId ??
      obj?.card?.controller ??
      obj?.card?.controllerId ??
      obj?.owner ??
      obj?.ownerId ??
      obj?.card?.owner ??
      obj?.card?.ownerId
  );
}

/**
 * Resolves the game object that pronouns like "it/its/that creature" refer to in the
 * current execution context: bound targets, moved snapshots, source, or stack spell.
 */
export function resolveReferencedObject(
  state: GameState,
  ctx: OracleIRExecutionContext,
  runtime?: ReferencedObjectRuntime
): any | null {
  const battlefield = [...((state.battlefield || []) as any[])];
  const movedSnapshots = collectMovedSnapshots(ctx, runtime);

  // Per-object iteration (for-each riders) narrows chosenObjectIds; that beats spell-level
  // targetPermanentId left over from multi-target binding.
  const prioritizedIds = [
    ctx.lastReferencedPermanentId,
    getSingleChosenObjectId(ctx),
  ]
    .map((id) => normalizeId(id))
    .filter(Boolean);

  const seenPrioritized = new Set<string>();
  for (const id of prioritizedIds) {
    if (seenPrioritized.has(id)) continue;
    seenPrioritized.add(id);

    const fromSnapshot = findSnapshotById(movedSnapshots, id);
    if (fromSnapshot) return fromSnapshot;

    const fromState = findObjectByIdInState(state, battlefield as any, id);
    if (fromState) return fromState;
  }

  const candidateIds = [
    ctx.targetPermanentId,
    ctx.selectorContext?.targetPermanentId,
    ctx.targetCreatureId,
    ctx.selectorContext?.targetCreatureId,
    ctx.targetSpellId,
    ctx.selectorContext?.targetSpellId,
    ctx.sourceId,
  ]
    .map((id) => normalizeId(id))
    .filter(Boolean);

  const seenIds = new Set<string>();
  for (const id of candidateIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const fromSnapshot = findSnapshotById(movedSnapshots, id);
    if (fromSnapshot) return fromSnapshot;

    const fromState = findObjectByIdInState(state, battlefield as any, id);
    if (fromState) return fromState;
  }

  if (movedSnapshots.length === 1) return movedSnapshots[0];
  if (movedSnapshots.length > 1) return movedSnapshots[movedSnapshots.length - 1];

  return null;
}

export function resolveReferencedObjectPlayerIds(
  state: GameState,
  ctx: OracleIRExecutionContext,
  role: ReferencedObjectRole,
  runtime?: ReferencedObjectRuntime
): readonly PlayerID[] {
  const allPlayerIds = new Set(
    (state.players || [])
      .map((player: any) => normalizeId(player?.id))
      .filter(Boolean)
  );

  const singleChosenId = getSingleChosenObjectId(ctx);
  if (singleChosenId) {
    const referencedObject = resolveReferencedObject(state, ctx, runtime);
    if (referencedObject) {
      const playerId = getPlayerIdFromObject(referencedObject, role);
      if (playerId && allPlayerIds.has(playerId)) return [playerId as PlayerID];
    }
  }

  const boundPlayerId = normalizeId(ctx.selectorContext?.targetPlayerId) || normalizeId(ctx.targetPlayerId);
  if (boundPlayerId && allPlayerIds.has(boundPlayerId)) return [boundPlayerId as PlayerID];

  const referencedObject = resolveReferencedObject(state, ctx, runtime);
  if (referencedObject) {
    const playerId = getPlayerIdFromObject(referencedObject, role);
    if (playerId && allPlayerIds.has(playerId)) return [playerId as PlayerID];
  }

  return [];
}

export type ReferencedPlayerZoneName = 'graveyard' | 'hand' | 'library' | 'exile';

export interface ReferencedPlayerZone {
  readonly playerId: PlayerID;
  readonly zone: ReferencedPlayerZoneName;
}

function normalizeReferencedPossessiveZonePhrase(phrase: string): string {
  return String(phrase || '')
    .replace(/\u2019/g, "'")
    .trim()
    .replace(/\s+/g, ' ');
}

/** Parses zone phrases like "its controller's graveyard" (player zone routing, not a player selector). */
export function parseReferencedPossessiveZonePhrase(
  phrase: string,
): { readonly role: ReferencedObjectRole; readonly zone: ReferencedPlayerZoneName } | null {
  const normalized = normalizeReferencedPossessiveZonePhrase(phrase);
  const match = normalized.match(/^its\s+(controller|owner)(?:'|')s\s+(graveyard|hand|library|exile)$/i);
  if (!match) return null;
  const zone = String(match[2] || '').trim().toLowerCase();
  if (zone !== 'graveyard' && zone !== 'hand' && zone !== 'library' && zone !== 'exile') return null;
  return {
    role: String(match[1] || '').trim().toLowerCase() === 'owner' ? 'owner' : 'controller',
    zone: zone as ReferencedPlayerZoneName,
  };
}

/** Extracts "its controller's graveyard" (etc.) from longer selector text such as move_zone `what`. */
export function parseReferencedPossessiveZoneSuffix(
  text: string,
): { readonly role: ReferencedObjectRole; readonly zone: ReferencedPlayerZoneName } | null {
  const normalized = normalizeReferencedPossessiveZonePhrase(text);
  const match = normalized.match(/\bfrom\s+its\s+(controller|owner)(?:'|')s\s+(graveyard|hand|library|exile)\b/i);
  if (!match) return null;
  const zone = String(match[2] || '').trim().toLowerCase();
  if (zone !== 'graveyard' && zone !== 'hand' && zone !== 'library' && zone !== 'exile') return null;
  return {
    role: String(match[1] || '').trim().toLowerCase() === 'owner' ? 'owner' : 'controller',
    zone: zone as ReferencedPlayerZoneName,
  };
}

export function resolveReferencedPlayerZoneFromSuffix(
  state: GameState,
  ctx: OracleIRExecutionContext,
  text: string,
  runtime?: ReferencedObjectRuntime,
): ReferencedPlayerZone | null {
  const parsed = parseReferencedPossessiveZoneSuffix(text);
  if (!parsed) return null;
  const phrase = `its ${parsed.role}'s ${parsed.zone}`;
  return resolveReferencedPlayerZone(state, ctx, phrase, runtime);
}

export function resolveReferencedPlayerZone(
  state: GameState,
  ctx: OracleIRExecutionContext,
  phrase: string,
  runtime?: ReferencedObjectRuntime,
): ReferencedPlayerZone | null {
  const parsed = parseReferencedPossessiveZonePhrase(phrase);
  if (!parsed) return null;
  const playerIds = resolveReferencedObjectPlayerIds(state, ctx, parsed.role, runtime);
  const playerId = String(playerIds[0] || '').trim();
  if (!playerId) return null;
  return { playerId: playerId as PlayerID, zone: parsed.zone };
}

function objectMatchesCountedExpression(obj: any, countedExpression: string): boolean {
  const normalized = String(countedExpression || '').trim().toLowerCase();
  const typeLine = String(
    obj?.type_line ?? obj?.card?.type_line ?? obj?.card?.typeLine ?? ''
  ).toLowerCase();
  if (/\bcreature\b/.test(normalized) && !typeLine.includes('creature')) return false;
  if (/\bartifact\b/.test(normalized) && !typeLine.includes('artifact')) return false;
  if (/\bplaneswalker\b/.test(normalized) && !typeLine.includes('planeswalker')) return false;
  if (/\benchantment\b/.test(normalized) && !typeLine.includes('enchantment')) return false;
  if (/\bland\b/.test(normalized) && !typeLine.includes('land')) return false;
  return true;
}

function ledgerCardToReferencedObject(
  card: Record<string, unknown>,
  snap?: { controllerId?: string; ownerId?: string },
): any {
  const id = String(card?.id || '').trim();
  return {
    id,
    objectId: id,
    controller: snap?.controllerId,
    controllerId: snap?.controllerId,
    owner: snap?.ownerId,
    ownerId: snap?.ownerId,
    card,
    type_line: card?.type_line,
  };
}

function dedupeObjectsById(objects: readonly any[]): any[] {
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const obj of objects) {
    const id = normalizeId((obj as any)?.id ?? (obj as any)?.objectId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(obj);
  }
  return deduped;
}

/**
 * Objects from a prior destroy (or move) step for "for each X destroyed this way" riders.
 * Prefers step ledger; falls back to moved snapshots on dry-run paths.
 */
export function collectThisWayDestroyedObjects(
  ctx: OracleIRExecutionContext,
  countedExpression: string,
  runtime?: ReferencedObjectRuntime,
  step?: OracleEffectStep,
): readonly any[] {
  const antecedentIndex = resolveLedgerAntecedentStepIndex(ctx, step, ['destroy', 'move_zone']);
  if (antecedentIndex !== null && ctx.stepLedger?.has(antecedentIndex)) {
    const snapshots = ctx.stepLedger.get(antecedentIndex) ?? [];
    return dedupeObjectsById(
      snapshots
        .filter((snap) => objectMatchesCountedExpression(snapshotToCardLike(snap), countedExpression))
        .map((snap) => ledgerCardToReferencedObject(snapshotToCardLike(snap), snap)),
    );
  }

  const movedSnapshots = dedupeObjectsById(collectMovedSnapshots(ctx, runtime));
  return movedSnapshots.filter((obj) => objectMatchesCountedExpression(obj, countedExpression));
}
