// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster: move_zone to exile when the referent is it / that spell / this spell
// and that object is still a spell on the stack (Possibility Storm "that player
// exiles it", generic). Does not guess by source name — the trigger source is
// often a different permanent.
// Public entry symbol: tryApplyMoveZoneStackSpellToExile.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getControllerId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  annotateExiledCardsWithSource,
  buildAppliedResult,
} from './oracleIRExecutorMoveZoneStepResultBuilders';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';

const STACK_SPELL_WHAT = /^(?:it|that spell|this spell|this card)$/i;

function isStackSpellEntry(entry: any): boolean {
  const type = String(entry?.type || '').trim().toLowerCase();
  if (type === 'triggered_ability' || type === 'activated_ability' || type === 'ability') {
    return false;
  }
  if (type === 'spell') return true;
  return Boolean(entry?.card);
}

function stackEntryMatchesId(entry: any, wantedId: string): boolean {
  if (!wantedId) return false;
  const id = String(entry?.id || '').trim();
  const cardId = String(entry?.card?.id || '').trim();
  return id === wantedId || cardId === wantedId;
}

function findStackSpellToExile(
  state: GameState,
  ctx: OracleIRExecutionContext,
): { readonly index: number; readonly entry: any } | null {
  const stack = Array.isArray((state as any).stack) ? ((state as any).stack as any[]) : [];
  if (stack.length === 0) return null;

  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (targetSpellId) {
    const byTarget = stack.findIndex(
      (entry) => isStackSpellEntry(entry) && stackEntryMatchesId(entry, targetSpellId),
    );
    if (byTarget >= 0) return { index: byTarget, entry: stack[byTarget] };
  }

  if (String(ctx.sourceObjectType || '').trim() === 'spell') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      const bySource = stack.findIndex(
        (entry) => isStackSpellEntry(entry) && stackEntryMatchesId(entry, sourceId),
      );
      if (bySource >= 0) return { index: bySource, entry: stack[bySource] };
    }
  }

  return null;
}

function snapshotExiledStackCard(entry: any, ownerId: PlayerID): any {
  const cardFromSpell = entry?.card && typeof entry.card === 'object' ? entry.card : null;
  const id = String(cardFromSpell?.id || entry?.id || '').trim();
  const name = String(cardFromSpell?.name || entry?.name || '').trim();
  const typeLine = String(cardFromSpell?.type_line || entry?.type_line || '').trim();
  return {
    ...(cardFromSpell || {}),
    id,
    name,
    ...(typeLine ? { type_line: typeLine } : {}),
    owner: ownerId,
    zone: 'exile',
    ...(String(entry?.id || '').trim() ? { copiedFromStackItemId: String(entry.id).trim() } : {}),
  };
}

export function tryApplyMoveZoneStackSpellToExile(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): MoveZoneStepHandlerResult | undefined {
  if (step.to !== 'exile') return undefined;
  const whatText = String(
    (step.what as { text?: string; raw?: string } | undefined)?.text
      || (step.what as { raw?: string } | undefined)?.raw
      || '',
  ).trim();
  if (!STACK_SPELL_WHAT.test(whatText)) return undefined;

  const found = findStackSpellToExile(state, ctx);
  if (!found) return undefined;

  const controllerId = getControllerId(ctx);
  const ownerId = String(
    found.entry?.owner
      || found.entry?.ownerId
      || found.entry?.card?.owner
      || found.entry?.controller
      || controllerId,
  ).trim() as PlayerID;
  if (!ownerId) return undefined;

  const card = snapshotExiledStackCard(found.entry, ownerId);
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === ownerId) as any;
  const exile = Array.isArray(player?.exile) ? [...player.exile, card] : [card];
  const updatedPlayers = (state.players || []).map((entry: any) =>
    String(entry?.id || '').trim() === ownerId ? { ...entry, exile } : entry,
  );
  const updatedStack = (Array.isArray((state as any).stack) ? [...(state as any).stack] : [])
    .filter((_, index) => index !== found.index);

  const annotated = annotateExiledCardsWithSource({
    state: { ...(state as any), stack: updatedStack, players: updatedPlayers } as GameState,
    movedCards: [card],
    ctx,
  });

  return buildAppliedResult({
    state: annotated.state,
    log: [`Exiled ${card.id || card.name || 'that spell'} from the stack`],
    movedCards: annotated.movedCards || [card],
    toZone: 'exile',
  }, ctx);
}
