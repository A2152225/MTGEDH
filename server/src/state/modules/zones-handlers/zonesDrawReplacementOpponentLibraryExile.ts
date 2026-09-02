// Origin parent: server/src/state/modules/zones.ts
// Cluster: Shared Fate-family draw replacement — exile the top card of a chosen
//   opponent's library face down instead of drawing, with look/play linked to
//   the source remaining on the battlefield.
// Public entry symbols: exileTopOfOpponentLibraryFaceDown,
//   applyOrQueueOpponentLibraryDrawReplacement.
// Leaf must not import zones.ts or zones-handlers/index.ts.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { getOpponentsForPlayer } from './zonesDrawReplacementZursQueue.js';

function getLibraryArray(ctx: GameContext, playerId: string): any[] {
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  } as any);
  let lib = ctx.libraries.get(playerId as PlayerID);
  const zoneLib = Array.isArray((z as any).library) ? (z as any).library : undefined;
  if (!Array.isArray(lib) || lib.length === 0) {
    lib = (Array.isArray(zoneLib) && zoneLib.length > 0)
      ? zoneLib
      : (Array.isArray(lib) ? lib : []);
  }
  return lib;
}

function persistLibrary(ctx: GameContext, playerId: string, lib: any[]): void {
  const z = ctx.state.zones[playerId];
  ctx.libraries.set(playerId as PlayerID, lib);
  (z as any).library = lib;
  z.libraryCount = lib.length;
}

function libraryHasCards(ctx: GameContext, playerId: string): boolean {
  return getLibraryArray(ctx, playerId).length > 0;
}

function getPlayerNameFromState(state: any, playerId: string): string {
  const players = Array.isArray(state?.players) ? state.players : [];
  const player = players.find((entry: any) => String(entry?.id || '') === String(playerId || ''));
  return String(player?.name || playerId || 'Player');
}

export function exileTopOfOpponentLibraryFaceDown(
  ctx: GameContext,
  drawingPlayerId: string,
  opponentId: string,
  metadata: any,
): any | undefined {
  const lib = getLibraryArray(ctx, opponentId);
  if (lib.length === 0) return undefined;

  const card = lib.shift();
  persistLibrary(ctx, opponentId, lib);

  const sourcePermanentId = String(metadata?.sourcePermanentId || '').trim();
  const sourceName = String(metadata?.sourceName || 'this enchantment').trim() || 'this enchantment';
  const stamped = {
    ...card,
    zone: 'exile',
    faceDown: true,
    exiledBy: drawingPlayerId,
    exiledWithSourceId: sourcePermanentId,
    exiledWithSourceName: sourceName,
    canBeExaminedBy: [drawingPlayerId],
    canBePlayedBy: drawingPlayerId,
    playableUntilTurn: Number.MAX_SAFE_INTEGER,
    playFromExileRequiresSourcePermanentId: sourcePermanentId,
  };

  const z = ctx.state.zones[opponentId];
  z.exile = Array.isArray(z.exile) ? z.exile : [];
  z.exile.push(stamped);
  z.exileCount = z.exile.length;

  const stateAny = ctx.state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};
  const entry = (stateAny.playableFromExile[drawingPlayerId] = stateAny.playableFromExile[drawingPlayerId] || {});
  const cardId = String(stamped?.id || '').trim();
  if (cardId) {
    entry[cardId] = Number.MAX_SAFE_INTEGER;
  }

  return stamped;
}

export function applyOrQueueOpponentLibraryDrawReplacement(
  ctx: GameContext,
  drawingPlayerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): boolean {
  const opponentsWithCards = getOpponentsForPlayer(ctx.state, drawingPlayerId)
    .filter((id) => libraryHasCards(ctx, id));
  const opponents = opponentsWithCards.length > 0
    ? opponentsWithCards
    : getOpponentsForPlayer(ctx.state, drawingPlayerId);

  if (opponents.length <= 1) {
    const targetId = String(opponents[0] || '').trim();
    if (targetId) {
      exileTopOfOpponentLibraryFaceDown(ctx, drawingPlayerId, targetId, metadata);
    }
    return false;
  }

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const sourceName = String(metadata?.sourceName || 'this enchantment').trim() || 'this enchantment';
  const sourcePermanentId = String(metadata?.sourcePermanentId || '').trim();
  ResolutionQueueManager.addStep(gameId, {
    id: uid('opp_lib_draw_replace'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: drawingPlayerId as PlayerID,
    sourceId: sourcePermanentId || sourceName,
    sourceName,
    description: `${sourceName}: Exile the top card of one opponent's library face down instead of drawing.`,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    opponentLibraryDrawReplacement: true,
    remainingDrawCountAfterChoice,
    sourcePermanentId,
    options: opponents.map((id) => ({
      id,
      label: getPlayerNameFromState(ctx.state, id),
    })),
  } as any);
  return true;
}
