import type { Server } from 'socket.io';
import { ResolutionQueueManager } from '../state/resolution/index.js';
import { ResolutionStepType } from '../state/resolution/types.js';
import { getPlayerName } from './util.js';

export function enqueueEdictCreatureSacrificeStep(
  io: Server,
  game: any,
  gameId: string,
  targetPlayerId: string,
  params: {
    sourceName: string;
    sourceControllerId?: string;
    reason?: string;
    sourceId?: string;
  }
): number {
  const battlefield = game.state?.battlefield || [];

  const creatures = battlefield
    .filter((p: any) =>
      p &&
      p.controller === targetPlayerId &&
      String(p.card?.type_line || '').toLowerCase().includes('creature')
    )
    .map((p: any) => ({
      id: p.id,
      name: p.card?.name || p.id,
      imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      typeLine: p.card?.type_line,
      power: p.basePower,
      toughness: p.baseToughness,
    }));

  if (creatures.length === 0) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}_nosac_${targetPlayerId}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, targetPlayerId)} has no creatures to sacrifice.`,
      ts: Date.now(),
    });
    return 0;
  }

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.UPKEEP_SACRIFICE,
    playerId: targetPlayerId as any,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    description: params.reason
      ? `${params.sourceName}: ${params.reason}`
      : `${params.sourceName}: Choose a creature to sacrifice`,
    mandatory: true,
    hasCreatures: true,
    creatures,
    allowSourceSacrifice: false,
    edictSacrifice: true,
    sourceController: params.sourceControllerId,
  } as any);

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}_sac_${targetPlayerId}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, targetPlayerId)} must sacrifice a creature.`,
    ts: Date.now(),
  });

  return 1;
}
