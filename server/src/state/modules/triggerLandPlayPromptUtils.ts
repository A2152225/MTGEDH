import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';

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
