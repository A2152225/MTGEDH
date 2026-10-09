// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerSecretEachPlayerNumberPrompts.ts
// Origin parent: oracleIrServerChooseDestroyRestSecretDamagePrompts.ts
// Cluster: queue one secret X_VALUE_SELECTION per player for
//   secret_each_player_number (Wheel of Misfortune family).
// Public: queueSecretEachPlayerNumberPrompts
// Leaf must not import oracleIrServerZoneSync.ts or the handlers index.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { debug, debugWarn } from '../../../utils/debug.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import {
  clearSecretEachPlayerNumberBatch,
  createSecretEachPlayerNumberBatch,
} from '../secretEachPlayerNumberBatch.js';

const SECRET_NUMBER_MAX = 999;

export function queueSecretEachPlayerNumberPrompts(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    gameId: string;
    minNumber: number;
    drawCount: number;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const gameId = options.gameId;
  const minNumber = Math.max(0, Math.floor(Number(options.minNumber || 0)));
  const drawCount = Math.max(0, Math.floor(Number(options.drawCount || 0)));
  const players = Array.isArray(state.players) ? state.players : [];
  const turnOrder: PlayerID[] = players
    .map((player: any) => player?.id)
    .filter((playerId: any) => typeof playerId === 'string') as PlayerID[];
  const activePlayerId: PlayerID =
    state?.turnPlayer ||
    state?.activePlayerId ||
    state?.activePlayer ||
    players[state?.activePlayerIndex || 0]?.id ||
    controller;
  const batchId = `${String(item?.id || card?.id || effectiveCard?.id || uid('secret_number'))}:secret_each_player_number`;
  const sourceId = String(item?.id || card?.id || effectiveCard?.id || '').trim() || undefined;
  const sourceName = String(effectiveCard?.name || card?.name || 'Spell');
  const stepConfigs: any[] = [];
  const expectedPlayerIds: string[] = [];

  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId || player?.hasLost) continue;
    expectedPlayerIds.push(playerId);
    stepConfigs.push({
      type: ResolutionStepType.X_VALUE_SELECTION,
      playerId,
      description: `${sourceName}: secretly choose a number ${minNumber} or greater.`,
      mandatory: true,
      sourceId,
      sourceName,
      sourceImage: effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
      minValue: minNumber,
      maxValue: SECRET_NUMBER_MAX,
      priority: 0,
      secretEachPlayerNumberChoice: true,
      secretEachPlayerNumberBatchId: batchId,
      secretEachPlayerNumberExpectedPlayerIds: expectedPlayerIds,
      secretEachPlayerNumberController: String(controller),
      secretEachPlayerNumberSourceId: sourceId,
      secretEachPlayerNumberSourceName: sourceName,
      secretEachPlayerNumberDrawCount: drawCount,
      secretEachPlayerNumberMin: minNumber,
    });
  }

  if (stepConfigs.length === 0 || !gameId || gameId === 'unknown' || drawCount <= 0) {
    clearSecretEachPlayerNumberBatch(state, batchId);
    debug(2, `[queueSecretEachPlayerNumberPrompts] ${sourceName} had no players to choose`);
    return;
  }

  for (const config of stepConfigs) {
    config.secretEachPlayerNumberExpectedPlayerIds = [...expectedPlayerIds];
  }

  createSecretEachPlayerNumberBatch(state, {
    id: batchId,
    controller: String(controller),
    sourceId,
    sourceName,
    expectedPlayerIds,
    drawCount,
    minNumber,
  });

  try {
    const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, stepConfigs as any, turnOrder as any, activePlayerId as any);
    appendQueuedResolutionPromptEvent(ctx, {
      playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
      sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
      queuedResolutionSteps: steps as any[],
    });
    debug(2, `[queueSecretEachPlayerNumberPrompts] ${sourceName} queued ${steps.length} secret number step(s)`);
  } catch (err) {
    clearSecretEachPlayerNumberBatch(state, batchId);
    debugWarn(1, `[queueSecretEachPlayerNumberPrompts] ${sourceName} failed to queue secret numbers:`, err);
  }
}
