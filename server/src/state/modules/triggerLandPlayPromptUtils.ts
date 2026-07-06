import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';

export {
  isBothPlayersMayPutPermanentFromHandOracleStep as isBothPlayersMayPutPermanentFromHandStep,
  isControllerMayPutLandFromHandOracleStep as isControllerMayPutLandFromHandStep,
  isEachPlayerMayPutLandFromHandOracleStep as isEachPlayerMayPutLandFromHandStep,
} from '../../../../rules-engine/src/oracleIRPerPlayerOptional.js';

function landsInPlayerHand(state: any, playerId: PlayerID): any[] {
  const hand = Array.isArray(state?.zones?.[playerId]?.hand)
    ? (state.zones[playerId].hand as any[])
    : [];
  return hand.filter((card: any) =>
    card && String(card?.type_line || '').toLowerCase().includes('land'),
  );
}

function buildLandPlayOrDrawStepConfig(params: {
  playerId: PlayerID;
  sourceController: PlayerID;
  sourceName: string;
  sourceId?: string;
  sourceImage?: string;
  batchId: string;
  landsInHand: readonly any[];
}): Record<string, unknown> {
  const isController = params.playerId === params.sourceController;
  const options = isController
    ? (['play_land', 'decline'] as const)
    : (['play_land', 'draw_card'] as const);

  return {
    type: ResolutionStepType.KYNAIOS_CHOICE,
    playerId: params.playerId,
    description: `${params.sourceName}: You may put a land card from your hand onto the battlefield${isController ? '' : ', or draw a card'}`,
    mandatory: false,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    sourceImage: params.sourceImage,
    kynaiosBatchId: params.batchId,
    isController,
    sourceController: params.sourceController,
    canPlayLand: params.landsInHand.length > 0,
    landsInHand: params.landsInHand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    })),
    options,
    landPlayOrFallbackIsController: isController,
    landPlayOrFallbackSourceController: params.sourceController,
    landPlayOrFallbackCanPlayLand: params.landsInHand.length > 0,
    landPlayOrFallbackLandsInHand: params.landsInHand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    })),
    landPlayOrFallbackOptions: options,
  };
}

/**
 * Generic each-player optional land-from-hand queue used by Oracle IR and legacy
 * "each player may put a land… then each opponent who didn't draws" effects.
 */
export function queueEachPlayerMayPutLandOrDrawBatch(
  ctx: GameContext,
  params: {
    sourceController: PlayerID;
    sourceName: string;
    sourceId?: string;
    sourceImage?: string;
    batchId?: string;
    triggerItem?: any;
  },
): boolean {
  const state = (ctx as any).state;
  const players = Array.isArray(state?.players) ? state.players : [];
  if (players.length === 0) return false;

  const gameId = String((ctx as any).gameId || (ctx as any).id || params.triggerItem?.gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;
  if ((ctx as any).isReplaying) return false;

  const batchId = String(
    params.batchId
    || params.triggerItem?.id
    || `land_play_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const sourceId = params.sourceId || params.triggerItem?.permanentId || params.triggerItem?.sourceId;
  const sourceImage = params.sourceImage || params.triggerItem?.card?.image_uris?.small;
  const turnOrder = players.map((player: any) => String(player?.id || '')).filter(Boolean);
  const activePlayerId = String(state?.activePlayer || params.sourceController || turnOrder[0] || '').trim() as PlayerID;

  const stepConfigs = players.map((player: any) => {
    const playerId = String(player?.id || '').trim() as PlayerID;
    return buildLandPlayOrDrawStepConfig({
      playerId,
      sourceController: params.sourceController,
      sourceName: params.sourceName,
      sourceId,
      sourceImage,
      batchId,
      landsInHand: landsInPlayerHand(state, playerId),
    });
  });

  ResolutionQueueManager.addStepsWithAPNAP(
    gameId,
    stepConfigs as any[],
    turnOrder,
    activePlayerId,
  );

  return true;
}

export function queueControllerLandPlayOrDrawPrompt(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem?: any,
): boolean {
  const landsInHand = landsInPlayerHand((ctx.state as any), controller);
  const options = landsInHand.length > 0
    ? (['play_land', 'draw_card'] as const)
    : (['draw_card'] as const);

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.KYNAIOS_CHOICE,
    playerId: controller as any,
    description: `${sourceName}: You may put a land card from your hand onto the battlefield. If you don't, draw a card.`,
    mandatory: false,
    sourceId: triggerItem?.permanentId || triggerItem?.sourceId,
    sourceName,
    sourceImage: triggerItem?.card?.image_uris?.small,
    kynaiosBatchId: String((triggerItem as any)?.id || `land_play_or_draw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    isController: true,
    sourceController: controller,
    canPlayLand: landsInHand.length > 0,
    landsInHand: landsInHand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    })),
    options,
    landPlayOrFallbackIsController: true,
    landPlayOrFallbackSourceController: controller,
    landPlayOrFallbackCanPlayLand: landsInHand.length > 0,
    landPlayOrFallbackLandsInHand: landsInHand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    })),
    landPlayOrFallbackOptions: options,
    landPlayOrFallbackSkipFinalize: true,
    landPlayOrFallbackDrawIfNot: true,
  } as any);

  return true;
}

export function queueLandPlayFromHandPrompt(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  triggerItem?: any,
): boolean {
  const hand = Array.isArray((ctx.state as any)?.zones?.[controller]?.hand)
    ? ((ctx.state as any).zones[controller].hand as any[])
    : [];
  const landsInHand = hand.filter((card: any) =>
    card && String(card?.type_line || '').toLowerCase().includes('land'),
  );

  if (landsInHand.length === 0) {
    return false;
  }

  const options = ['play_land', 'decline'] as const;
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.KYNAIOS_CHOICE,
    playerId: controller as any,
    description: `${sourceName}: You may put a land card from your hand onto the battlefield.`,
    mandatory: false,
    sourceId: triggerItem?.permanentId || triggerItem?.sourceId,
    sourceName,
    sourceImage: triggerItem?.card?.image_uris?.small,
    kynaiosBatchId: String((triggerItem as any)?.id || `land_play_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    isController: true,
    sourceController: controller,
    canPlayLand: true,
    landsInHand: landsInHand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    })),
    options,
    landPlayOrFallbackIsController: true,
    landPlayOrFallbackSourceController: controller,
    landPlayOrFallbackCanPlayLand: true,
    landPlayOrFallbackLandsInHand: landsInHand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    })),
    landPlayOrFallbackOptions: options,
    landPlayOrFallbackSkipFinalize: true,
  } as any);

  return true;
}

export function queueBothPlayersMayPutPermanentFromHandPrompts(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    targetPlayerId: PlayerID;
    sourceName: string;
    triggerItem?: any;
  },
): boolean {
  const queuedController = queueLandPlayFromHandPrompt(
    ctx,
    params.controller,
    params.sourceName,
    params.triggerItem,
  );
  const queuedTarget = queueLandPlayFromHandPrompt(
    ctx,
    params.targetPlayerId,
    params.sourceName,
    params.triggerItem,
  );
  return queuedController || queuedTarget;
}

export function refreshKynaiosLandPlayResolutionStepForClient(
  state: any,
  step: Record<string, any>,
): Record<string, any> {
  const playerId = String(step.playerId || '').trim() as PlayerID;
  if (!playerId) return step;

  const landsInHand = landsInPlayerHand(state, playerId);
  const isController = step.isController === true
    || step.landPlayOrFallbackIsController === true
    || playerId === String(step.sourceController || step.landPlayOrFallbackSourceController || '').trim();
  const options = isController
    ? (['play_land', 'decline'] as const)
    : (['play_land', 'draw_card'] as const);
  const landCards = landsInHand.map((card: any) => ({
    id: String(card?.id || ''),
    name: String(card?.name || ''),
    imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
  }));

  return {
    ...step,
    isController,
    canPlayLand: landsInHand.length > 0,
    landsInHand: landCards,
    options,
    landPlayOrFallbackIsController: isController,
    landPlayOrFallbackCanPlayLand: landsInHand.length > 0,
    landPlayOrFallbackLandsInHand: landCards,
    landPlayOrFallbackOptions: options,
  };
}
