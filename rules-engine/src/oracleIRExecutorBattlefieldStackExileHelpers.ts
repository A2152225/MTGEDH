// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: isNamedSelfSacrificeReference, exileSourceStackObject,
// isStackSpellExileTarget, exileSpellFromStackById, exileChosenSpellsFromStack.
// Public entries: those five helpers.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getChosenObjectIdsFromContext } from './oracleIRExecutorBattlefieldCardZoneLocation';
import { normalizeExileTargetReferenceText } from './oracleIRExecutorBattlefieldExileZoneHelpers';
import { buildNameReferenceAliases } from './oracleIRExecutorBattlefieldNameAliases';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';
import { getStackItems } from './stackOperations';

function readMutableStackItems(state: GameState): any[] {
  return [...getStackItems((state as any)?.stack)];
}

function withUpdatedStackItems(state: GameState, stackItems: readonly any[]): GameState {
  const stack = (state as any)?.stack;
  if (stack && !Array.isArray(stack) && Array.isArray(stack.objects)) {
    return { ...state, stack: { ...stack, objects: [...stackItems] } } as GameState;
  }
  return { ...state, stack: [...stackItems] } as GameState;
}

export function isNamedSelfSacrificeReference(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  ctx: OracleIRExecutionContext
): boolean {
  if (what.kind !== 'raw') return false;
  const normalizedWhat = normalizeSelfReferenceText(String((what as any).text || ''));
  if (!normalizedWhat) return false;

  const sourceAliases = new Set(
    [
      String(ctx.sourceName || ''),
      String((ctx as any).cardName || ''),
    ].flatMap((name) => buildNameReferenceAliases(name)),
  );
  return buildNameReferenceAliases(normalizedWhat).some((alias) => sourceAliases.has(alias));
}

export function exileSourceStackObject(
  state: GameState,
  ctx: OracleIRExecutionContext
): { readonly state: GameState; readonly log: readonly string[] } | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;

  const stack = readMutableStackItems(state);
  const stackIndex = stack.findIndex(item => {
    const itemId = String((item as any)?.id || '').trim();
    const cardId = String((item as any)?.card?.id || '').trim();
    return itemId === sourceId || cardId === sourceId;
  });
  if (stackIndex < 0) return null;

  const stackObject = stack[stackIndex] as any;
  const playerId = (String(stackObject?.controller || stackObject?.controllerId || ctx.controllerId || '').trim() ||
    ctx.controllerId) as PlayerID;
  const player = (state.players || []).find(p => String((p as any)?.id || '').trim() === String(playerId || '').trim()) as any;
  if (!player) return null;

  const stackCard = {
    ...((stackObject?.card as any) || {}),
    id: String(((stackObject?.card as any)?.id || stackObject?.spellId || stackObject?.id || sourceId)).trim(),
    name: String(((stackObject?.card as any)?.name || stackObject?.cardName || ctx.sourceName || 'Unknown')).trim() || 'Unknown',
    zone: 'exile',
  } as any;

  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? ({
          ...(p as any),
          exile: [...(Array.isArray((p as any)?.exile) ? (p as any).exile : []), stackCard],
        } as any)
      : p
  );
  stack.splice(stackIndex, 1);

  return {
    state: { ...withUpdatedStackItems(state, stack), players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${stackCard.name} from the stack`],
  };
}

export function isStackSpellExileTarget(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): boolean {
  if (target.kind !== 'raw') return false;
  const normalized = normalizeExileTargetReferenceText(String((target as any).text || '')).toLowerCase();
  return /^(?:it|that spell|that card|the spell|the card|any number of target spells|target spells?)$/.test(normalized);
}

export function exileSpellFromStackById(
  state: GameState,
  spellId: string,
  ctx: OracleIRExecutionContext
): { readonly state: GameState; readonly log: readonly string[] } | null {
  const targetSpellId = String(spellId || '').trim();
  if (!targetSpellId) return null;

  const stack = readMutableStackItems(state);
  const spellIndex = stack.findIndex(item => {
    const itemId = String((item as any)?.id || '').trim();
    const cardId = String((item as any)?.card?.id || '').trim();
    return itemId === targetSpellId || cardId === targetSpellId;
  });
  if (spellIndex < 0) return null;

  const targetSpell = stack[spellIndex] as any;
  const ownerId = String(
    targetSpell?.owner || targetSpell?.ownerId || targetSpell?.controller || targetSpell?.controllerId || ''
  ).trim();
  if (!ownerId) return null;

  const sourceId = String(ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(ctx.sourceName || '').trim();
  const baseCard =
    targetSpell?.card && typeof targetSpell.card === 'object' ? { ...targetSpell.card } : { ...targetSpell };
  const exiledSpellCard = {
    ...baseCard,
    id: String((baseCard as any)?.id || targetSpellId).trim() || targetSpellId,
    name: String((baseCard as any)?.name || targetSpell?.name || targetSpellId).trim() || targetSpellId,
    zone: 'exile',
    owner: ownerId,
    ownerId,
    ...(sourceRef ? { exiledBy: sourceRef } : {}),
    ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
  };

  stack.splice(spellIndex, 1);
  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== ownerId) return player;
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    return { ...player, exile: [...exile, exiledSpellCard] };
  });

  return {
    state: { ...withUpdatedStackItems(state, stack), players: updatedPlayers as any } as GameState,
    log: [`${ownerId} exiles ${exiledSpellCard.name} from the stack`],
  };
}

export function exileChosenSpellsFromStack(
  state: GameState,
  ctx: OracleIRExecutionContext,
): { readonly state: GameState; readonly log: readonly string[] } {
  const ids = Array.from(new Set([
    ...getChosenObjectIdsFromContext(ctx),
    String(ctx.targetSpellId || '').trim(),
    String(ctx.selectorContext?.targetSpellId || '').trim(),
  ].filter(Boolean)));

  let working = state;
  const log: string[] = [];
  for (const id of ids) {
    const result = exileSpellFromStackById(working, id, ctx);
    if (!result) continue;
    working = result.state;
    log.push(...result.log);
  }
  return { state: working, log };
}

