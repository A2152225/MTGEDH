import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { cleanupCardLeavingExile } from './playable-from-exile.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { queueMayAbilityStep } from '../../socket/may-ability-prompts.js';
import { queueCastFromExileResolutionPrompt } from './triggerCastFromExileUtils.js';

export interface StackSpecialTriggerParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyStackReboundTrigger(params: StackSpecialTriggerParams): boolean {
  if (params.triggerItem?.triggerType !== 'rebound') {
    return false;
  }

  const reboundCardId = params.triggerItem.reboundCardId;
  const gameId = (params.ctx as any).gameId || 'unknown';
  if ((params.ctx as any).isReplaying) {
    debug(2, `[executeTriggerEffect] Rebound: skipping resolution steps during replay`);
    return true;
  }

  const io = (params.ctx as any).io;
  const playerName = String(
    ((params.state as any)?.players || []).find((p: any) => String(p?.id || '') === String(params.controller))?.name || params.controller,
  );

  const resolveReboundChoice = async (castFromExile: boolean) => {
    const zones = params.state?.zones?.[params.controller as any];
    if (!zones || !Array.isArray((zones as any).exile)) {
      debugWarn(2, `[executeTriggerEffect] Rebound: No exile zone found for player ${params.controller}`);
      return;
    }

    const exile = (zones as any).exile as any[];
    const cardIndex = exile.findIndex((c: any) => c?.id === reboundCardId);
    if (cardIndex === -1) {
      debugWarn(2, `[executeTriggerEffect] Rebound: Card ${reboundCardId} not found in exile`);
      return;
    }

    const exiledCard = exile[cardIndex];
    exile.splice(cardIndex, 1);
    (zones as any).exileCount = exile.length;
    cleanupCardLeavingExile(params.state as any, exiledCard);

    if (castFromExile) {
      params.state.stack = params.state.stack || [];
      params.state.stack.push({
        id: uid('rebound_spell'),
        type: 'spell',
        card: { ...exiledCard, zone: 'stack', reboundPending: false, reboundTriggered: false },
        controller: params.controller,
        targets: [],
        castFromRebound: true,
        castFromHand: false,
      });

      io?.to?.(gameId)?.emit?.('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `🔄 ${playerName} cast ${exiledCard.name} from rebound!`,
        ts: Date.now(),
      });

      debug(2, `[executeTriggerEffect] Rebound: ${params.controller} cast ${exiledCard.name} from exile`);
      return;
    }

    (zones as any).graveyard = Array.isArray((zones as any).graveyard) ? (zones as any).graveyard : [];
    pushCardToPlayerGraveyardWithReplacements(params.ctx, String(params.controller), exiledCard, (zones as any).graveyard, {
      extraFields: { reboundPending: false, reboundTriggered: false },
    });
    (zones as any).graveyardCount = (zones as any).graveyard.length;

    io?.to?.(gameId)?.emit?.('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${playerName} declined to cast ${exiledCard.name} from rebound - moved to graveyard.`,
      ts: Date.now(),
    });

    debug(2, `[executeTriggerEffect] Rebound: ${params.controller} declined to cast ${exiledCard.name}, moved to graveyard`);
  };

  queueMayAbilityStep(
    (io || ({} as any)) as any,
    gameId,
    { state: params.state },
    String(params.controller),
    params.sourceName,
    `cast ${params.sourceName} from exile without paying its mana cost`,
    `At the beginning of your next upkeep, you may cast ${params.sourceName} from exile without paying its mana cost.`,
    async () => {
      await resolveReboundChoice(true);
    },
    async () => {
      await resolveReboundChoice(false);
    },
  );

  debug(2, `[executeTriggerEffect] Rebound: queued may prompt for ${params.sourceName}`);
  return true;
}

export function applyStackParadigmTrigger(params: StackSpecialTriggerParams): boolean {
  if (params.triggerItem?.triggerType !== 'paradigm') {
    return false;
  }

  const paradigmCardId = String(params.triggerItem.paradigmCardId || '').trim();
  const gameId = (params.ctx as any).gameId || 'unknown';
  if (!paradigmCardId) {
    debugWarn(2, '[executeTriggerEffect] Paradigm: missing paradigm card id');
    return true;
  }

  if ((params.ctx as any).isReplaying) {
    debug(2, '[executeTriggerEffect] Paradigm: skipping resolution steps during replay');
    return true;
  }

  const zones = params.state?.zones?.[params.controller as any];
  if (!zones || !Array.isArray((zones as any).exile)) {
    debugWarn(2, `[executeTriggerEffect] Paradigm: No exile zone found for player ${params.controller}`);
    return true;
  }

  const exile = (zones as any).exile as any[];
  const sourceCard = exile.find((card: any) => String(card?.id || '') === paradigmCardId);
  if (!sourceCard) {
    debugWarn(2, `[executeTriggerEffect] Paradigm: Card ${paradigmCardId} not found in exile`);
    return true;
  }

  const paradigmCopyCard = {
    ...sourceCard,
    id: uid('paradigm_copy'),
    zone: 'exile',
    isCopy: true,
    copiedFromCardId: sourceCard.id,
    canBePlayedBy: params.controller,
    playableUntilTurn: Number((params.state as any)?.turnNumber ?? 0),
    withoutPayingManaCost: true,
    ceaseOnResolution: true,
    ceaseOnCounter: true,
    paradigmGeneratedCopy: true,
    paradigmActive: false,
  };
  exile.push(paradigmCopyCard);
  (zones as any).exileCount = exile.length;

  queueCastFromExileResolutionPrompt(
    params.ctx,
    gameId,
    params.controller,
    String(params.sourceName || sourceCard?.name || 'Paradigm'),
    String(params.triggerItem.source || sourceCard?.id || '').trim() || undefined,
    sourceCard?.image_uris?.small || sourceCard?.image_uris?.normal || sourceCard?.imageUrl,
    {
      ...paradigmCopyCard,
      castFromExileDeclineDestination: 'cease_to_exist',
    },
  );

  debug(2, `[executeTriggerEffect] Paradigm: queued cast-from-exile prompt for ${sourceCard?.name || paradigmCardId}`);
  return true;
}
