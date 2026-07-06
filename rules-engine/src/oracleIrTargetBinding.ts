import type { PlayerID } from '../../shared/src';
import type { OracleIRExecutionEventHint } from './oracleIRExecutionTypes';

export interface OracleIrTargetBinding {
  readonly targetPermanentId?: string;
  readonly targetCreatureId?: string;
  readonly targetPlayerId?: PlayerID;
  readonly targetOpponentId?: PlayerID;
  readonly targetSpellId?: string;
  readonly chosenObjectIds?: readonly string[];
}

export function normalizeOracleIrTargetIds(targetIds: readonly unknown[]): string[] {
  return (Array.isArray(targetIds) ? targetIds : [])
    .map((targetRef) =>
      typeof targetRef === 'string'
        ? targetRef
        : String((targetRef as any)?.id || (targetRef as any)?.targetId || '')
    )
    .map((id) => String(id || '').trim())
    .filter(Boolean);
}

function isCreatureObject(obj: any): boolean {
  const typeLine = String(obj?.card?.type_line || obj?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

function findCardInPlayerZones(state: any, cardId: string): any | null {
  const normalizedId = String(cardId || '').trim();
  if (!normalizedId) return null;
  for (const player of state?.players || []) {
    for (const zone of ['hand', 'graveyard', 'exile', 'library'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      const found = cards.find((card: any) => String(card?.id || '').trim() === normalizedId);
      if (found) return found;
    }
  }
  return null;
}

function extractPermanentController(permanent: any): string {
  return String(
    permanent?.controller
    || permanent?.controllerId
    || permanent?.owner
    || permanent?.ownerId
    || permanent?.card?.controller
    || permanent?.card?.controllerId
    || permanent?.card?.owner
    || permanent?.card?.ownerId
    || '',
  ).trim();
}

/**
 * Infer IR execution bindings from stack/spell/ability target ids.
 * Covers battlefield permanents, players, stack spells, and cards in player zones
 * (graveyard/hand/exile/library) so pronoun selectors can resolve via chosenObjectIds.
 */
export function inferOracleIrTargetBinding(
  state: any,
  targetIds: readonly unknown[],
  controllerId?: PlayerID
): OracleIrTargetBinding {
  const ids = normalizeOracleIrTargetIds(targetIds);
  if (ids.length === 0) return {};

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const controller = String(controllerId || '').trim();

  const battlefieldPermanents = ids
    .map((id) => {
      const permanent = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
      return permanent ? { id, permanent } : null;
    })
    .filter((entry): entry is { id: string; permanent: any } => entry !== null);

  if (battlefieldPermanents.length > 0 && battlefieldPermanents.length === ids.length) {
    const controllers = new Set(
      battlefieldPermanents
        .map(({ permanent }) => extractPermanentController(permanent))
        .filter(Boolean),
    );
    const first = battlefieldPermanents[0];
    const sharedController = controllers.size === 1 ? [...controllers][0] : '';
    const isOpponent = Boolean(controller) && sharedController && sharedController !== controller;
    return {
      targetPermanentId: first.id,
      ...(isCreatureObject(first.permanent) ? { targetCreatureId: first.id } : {}),
      ...(sharedController ? { targetPlayerId: sharedController as PlayerID } : {}),
      ...(isOpponent ? { targetOpponentId: sharedController as PlayerID } : {}),
      chosenObjectIds: ids,
    };
  }

  for (const id of ids) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
    if (permanent) {
      const permanentController = extractPermanentController(permanent) as PlayerID;
      const isOpponent = Boolean(controller) && permanentController && permanentController !== controller;
      return {
        targetPermanentId: id,
        ...(isCreatureObject(permanent) ? { targetCreatureId: id } : {}),
        ...(permanentController ? { targetPlayerId: permanentController } : {}),
        ...(isOpponent ? { targetOpponentId: permanentController } : {}),
        chosenObjectIds: ids,
      };
    }
    if (players.some((player: any) => String(player?.id || '').trim() === id)) {
      const isOpponent = Boolean(controller) && id !== controller;
      return {
        targetPlayerId: id as PlayerID,
        ...(isOpponent ? { targetOpponentId: id as PlayerID } : {}),
        chosenObjectIds: ids,
      };
    }
    if (stack.some((stackItem: any) => String(stackItem?.id || '').trim() === id)) {
      return { targetSpellId: id, chosenObjectIds: ids };
    }
    if (findCardInPlayerZones(state, id)) {
      return { chosenObjectIds: ids };
    }
  }

  return { chosenObjectIds: ids };
}

export function oracleIrTargetBindingToBaseContext(
  binding: OracleIrTargetBinding
): Pick<
  import('./oracleIRExecutionTypes').OracleIRExecutionContext,
  'targetPermanentId' | 'targetCreatureId' | 'targetPlayerId' | 'targetSpellId' | 'selectorContext'
> {
  return {
    ...(binding.targetPermanentId ? { targetPermanentId: binding.targetPermanentId } : {}),
    ...(binding.targetCreatureId ? { targetCreatureId: binding.targetCreatureId } : {}),
    ...(binding.targetPlayerId ? { targetPlayerId: binding.targetPlayerId } : {}),
    ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
    selectorContext: {
      ...(binding.chosenObjectIds ? { chosenObjectIds: binding.chosenObjectIds } : {}),
      ...(binding.targetPlayerId ? { targetPlayerId: binding.targetPlayerId } : {}),
      ...(binding.targetOpponentId ? { targetOpponentId: binding.targetOpponentId } : {}),
      ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
      ...(binding.targetPermanentId ? { targetPermanentId: binding.targetPermanentId } : {}),
      ...(binding.targetCreatureId ? { targetCreatureId: binding.targetCreatureId } : {}),
    },
  };
}

export function oracleIrTargetBindingToEventHint(binding: OracleIrTargetBinding): OracleIRExecutionEventHint {
  return {
    ...(binding.targetPermanentId ? { targetPermanentId: binding.targetPermanentId } : {}),
    ...(binding.targetCreatureId ? { targetCreatureId: binding.targetCreatureId } : {}),
    ...(binding.targetPlayerId ? { targetPlayerId: binding.targetPlayerId } : {}),
    ...(binding.targetOpponentId ? { targetOpponentId: binding.targetOpponentId } : {}),
    ...(binding.targetSpellId ? { targetSpellId: binding.targetSpellId } : {}),
    ...(binding.chosenObjectIds ? { chosenObjectIds: binding.chosenObjectIds } : {}),
  };
}

/** Read bound stack-spell id from top-level ctx or selectorContext (server queue bridges use this). */
export function resolveOracleIrBoundTargetSpellId(
  ctx: Pick<import('./oracleIRExecutionTypes').OracleIRExecutionContext, 'targetSpellId' | 'selectorContext'> | undefined,
): string {
  return String(ctx?.targetSpellId || ctx?.selectorContext?.targetSpellId || '').trim();
}
