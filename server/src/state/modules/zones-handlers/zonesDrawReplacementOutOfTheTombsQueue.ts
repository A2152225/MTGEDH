// server/src/state/modules/zones-handlers/zonesDrawReplacementOutOfTheTombsQueue.ts
// Queue Out of the Tombs empty-library draw as a GRAVEYARD_SELECTION step.
// Public: queueOutOfTheTombsDrawReplacementStep, processPendingOutOfTheTombsDraw.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';

function idOf(card: any): string {
  return String(card?.id || card?.card?.id || card?.oracle_id || '').trim();
}

function asValidTarget(card: any, ownerId: string): { id: string; name: string; typeLine?: string; imageUrl?: string; zoneOwnerId?: string } | null {
  const id = idOf(card);
  if (!id) return null;
  const rec = card?.card || card;
  const imageUrl = rec?.image_uris?.normal || rec?.image_uris?.small || rec?.image_uri || undefined;
  return {
    id,
    name: String(rec?.name || card?.name || 'Creature'),
    typeLine: String(rec?.type_line || rec?.typeLine || card?.type_line || ''),
    imageUrl,
    zoneOwnerId: ownerId,
  };
}

export function queueOutOfTheTombsDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  candidates: any[],
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const validTargets = (Array.isArray(candidates) ? candidates : [])
    .map((card) => asValidTarget(card, playerId))
    .filter(Boolean) as { id: string; name: string; typeLine?: string; imageUrl?: string; zoneOwnerId?: string }[];
  if (validTargets.length < 2) return false;

  (ctx as any).state = (ctx as any).state || {};
  (ctx as any).state.pendingOutOfTheTombsDraw = {
    playerId,
    candidates: validTargets.map((t) => ({ id: t.id, name: t.name })),
    remaining: Math.max(0, Math.floor(Number(remainingDrawCountAfterChoice) || 0)),
    queued: true,
  };

  ResolutionQueueManager.addStep(gameId, {
    id: uid('tombs_draw'),
    type: ResolutionStepType.GRAVEYARD_SELECTION,
    playerId: playerId as PlayerID,
    sourceId: 'out-of-the-tombs',
    sourceName: 'Out of the Tombs',
    description: 'Return a creature card from your graveyard to the battlefield (Out of the Tombs).',
    mandatory: true,
    effectId: 'out-of-the-tombs-draw',
    cardName: 'Out of the Tombs',
    title: 'Out of the Tombs — return a creature',
    targetPlayerId: playerId,
    filter: { types: ['creature'] },
    minTargets: 1,
    maxTargets: 1,
    destination: 'battlefield',
    purpose: 'outOfTheTombsDraw',
    outOfTheTombsDraw: true,
    remainingDrawCountAfterChoice: Math.max(0, Math.floor(Number(remainingDrawCountAfterChoice) || 0)),
    validTargets,
  } as any);
  return true;
}

export function processPendingOutOfTheTombsDraw(_io: unknown, game: any, gameId: string): void {
  const pending = (game as any)?.state?.pendingOutOfTheTombsDraw;
  if (!pending || typeof pending !== 'object') return;
  if (pending.queued === true) return;
  const playerId = String(pending.playerId || '').trim();
  if (!playerId) return;
  const gy: any[] = (game as any)?.state?.zones?.[playerId]?.graveyard;
  const candidates = Array.isArray(pending.candidates) && pending.candidates.length
    ? pending.candidates
    : (Array.isArray(gy) ? gy : []);
  const queued = queueOutOfTheTombsDrawReplacementStep(
    game,
    playerId,
    candidates,
    Math.max(0, Math.floor(Number(pending.remaining || 0))),
  );
  if (queued) pending.queued = true;
}
