// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster: move_zone destination “owner’s library seventh from the top” when
// the source is this spell / this card / it and that object is still on the
// stack (Approach of the Second Sun otherwise-clause family, generic).
// Public entry symbol: tryApplyMoveZoneSeventhFromTop.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getControllerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';

const THIS_SPELL_OR_CARD_OR_IT = /^(?:this spell|this card|it)$/i;

function isSeventhFromTopLibraryDestination(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
): boolean {
  if (step.to !== 'library') return false;
  const combined = `${String((step as { toRaw?: string }).toRaw || '')} ${String(step.raw || '')}`.toLowerCase();
  return /seventh from the top/.test(combined);
}

function isThisSpellThisCardOrIt(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): boolean {
  const whatText = String((step.what as { text?: string; raw?: string } | undefined)?.text
    || (step.what as { raw?: string } | undefined)?.raw
    || '').trim();
  return THIS_SPELL_OR_CARD_OR_IT.test(whatText);
}

function stackEntryMatchesSourceId(entry: any, sourceId: string): boolean {
  if (!sourceId) return false;
  const id = String(entry?.id || '').trim();
  const cardId = String(entry?.card?.id || '').trim();
  return id === sourceId || cardId === sourceId;
}

function findResolvingStackSpell(
  state: GameState,
  ctx: OracleIRExecutionContext,
): { readonly index: number; readonly entry: any } | null {
  const stack = Array.isArray((state as any).stack) ? ((state as any).stack as any[]) : [];
  if (stack.length === 0) return null;

  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const byId = stack.findIndex((entry) => stackEntryMatchesSourceId(entry, sourceId));
    if (byId >= 0) return { index: byId, entry: stack[byId] };
  }

  const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
  if (!sourceName) return null;
  const named = stack
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const name = String(entry?.card?.name || entry?.name || '').trim().toLowerCase();
      return name === sourceName;
    });
  return named.length === 1 ? named[0] : null;
}

function snapshotStackCard(entry: any, ctx: OracleIRExecutionContext, ownerId: PlayerID): any {
  const cardFromSpell = entry?.card && typeof entry.card === 'object' ? entry.card : null;
  const id = String(cardFromSpell?.id || entry?.id || ctx.sourceId || '').trim();
  const name = String(cardFromSpell?.name || entry?.name || ctx.sourceName || '').trim();
  return {
    ...(cardFromSpell || {}),
    id,
    name,
    owner: ownerId,
    zone: 'library',
  };
}

export function tryApplyMoveZoneSeventhFromTop(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): MoveZoneStepHandlerResult | undefined {
  if (!isSeventhFromTopLibraryDestination(step) || !isThisSpellThisCardOrIt(step)) {
    return undefined;
  }

  const found = findResolvingStackSpell(state, ctx);
  if (!found) return undefined;

  const controllerId = getControllerId(ctx);
  const ownerId = String(
    found.entry?.owner || found.entry?.ownerId || found.entry?.card?.owner || found.entry?.controller || controllerId,
  ).trim() as PlayerID;
  if (!ownerId) return undefined;

  const card = snapshotStackCard(found.entry, ctx, ownerId);
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === ownerId) as any;
  const library = Array.isArray(player?.library) ? [...player.library] : [];
  const insertPosition = Math.min(6, library.length);
  library.splice(insertPosition, 0, card);

  const updatedPlayers = (state.players || []).map((entry: any) =>
    String(entry?.id || '').trim() === ownerId ? { ...entry, library } : entry,
  );
  const updatedStack = (Array.isArray((state as any).stack) ? [...(state as any).stack] : [])
    .filter((_, index) => index !== found.index);

  return buildAppliedResult({
    state: { ...(state as any), stack: updatedStack, players: updatedPlayers } as GameState,
    log: [`Put ${card.id || card.name || 'this card'} into ${ownerId}'s library seventh from the top`],
    movedCards: [card],
    toZone: 'library',
  }, ctx);
}
