// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: isNamedSelfSacrificeReference, exileSourceStackObject,
// isStackSpellExileTarget, exileSpellFromStackById.
// Public entries: those four helpers.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { normalizeExileTargetReferenceText } from './oracleIRExecutorBattlefieldExileZoneHelpers';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';

export function isNamedSelfSacrificeReference(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  ctx: OracleIRExecutionContext
): boolean {
  if (what.kind !== 'raw') return false;
  const normalizedWhat = normalizeSelfReferenceText(String((what as any).text || ''));
  if (!normalizedWhat) return false;

  const sourceCandidates = [
    String(ctx.sourceName || ''),
    String((ctx as any).cardName || ''),
  ]
    .map(normalizeSelfReferenceText)
    .filter(Boolean);

  return sourceCandidates.includes(normalizedWhat);
}

export function exileSourceStackObject(
  state: GameState,
  ctx: OracleIRExecutionContext
): { readonly state: GameState; readonly log: readonly string[] } | null {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return null;

  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  const stackIndex = stack.findIndex(item => String((item as any)?.id || '').trim() === sourceId);
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
    state: { ...(state as any), players: updatedPlayers as any, stack: stack as any } as any,
    log: [`${playerId} exiles ${stackCard.name} from the stack`],
  };
}

export function isStackSpellExileTarget(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string }
): boolean {
  if (target.kind !== 'raw') return false;
  const normalized = normalizeExileTargetReferenceText(String((target as any).text || '')).toLowerCase();
  return /^(?:it|that spell|that card|the spell|the card)$/.test(normalized);
}

export function exileSpellFromStackById(
  state: GameState,
  spellId: string,
  ctx: OracleIRExecutionContext
): { readonly state: GameState; readonly log: readonly string[] } | null {
  const targetSpellId = String(spellId || '').trim();
  if (!targetSpellId) return null;

  const stack = Array.isArray((state as any).stack) ? [...((state as any).stack as any[])] : [];
  const spellIndex = stack.findIndex(item => String((item as any)?.id || '').trim() === targetSpellId);
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
    state: { ...(state as any), stack: stack as any, players: updatedPlayers as any } as GameState,
    log: [`${ownerId} exiles ${exiledSpellCard.name} from the stack`],
  };
}

