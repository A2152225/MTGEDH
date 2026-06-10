import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { cleanupCardLeavingExile } from './playable-from-exile.js';
import { movePermanentToGraveyard } from './counters_tokens.js';
import { syncPreparedPermanentAfterControlChange } from './prepared.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { queueMayAbilityStep } from '../../socket/may-ability-prompts.js';
import { queueCastFromExileResolutionPrompt } from './triggerCastFromExileUtils.js';

export interface TriggerLegacySpecialParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacySacrificeThisCreature(
  params: TriggerLegacySpecialParams,
): boolean {
  if (params.desc !== 'sacrifice this creature' && params.desc !== 'sacrifice this creature.') {
    return false;
  }

  const sourceId = String(params.triggerItem?.source || params.triggerItem?.permanentId || '').trim();
  if (sourceId) {
    movePermanentToGraveyard(params.ctx, sourceId, true);
  }
  return true;
}

export function applyRetiredTriggerLegacyAttackingPlayerGainsControlOfArtifact(
  params: TriggerLegacySpecialParams,
): boolean {
  if (params.desc !== 'the attacking player gains control of this artifact and untaps it') {
    return false;
  }

  const sourceId = String(params.triggerItem?.source || params.triggerItem?.permanentId || '').trim();
  const attackingPlayerId = String(params.triggerItem?.attackingPlayerId || '').trim();
  if (!sourceId || !attackingPlayerId) {
    return true;
  }

  const sourcePerm = Array.isArray(params.state.battlefield)
    ? params.state.battlefield.find((perm: any) => perm && String(perm.id || '') === sourceId)
    : null;
  if (sourcePerm) {
    const previousController = String((sourcePerm as any).controller || '');
    (sourcePerm as any).controller = attackingPlayerId;
    syncPreparedPermanentAfterControlChange(params.state, sourcePerm, previousController);
    (sourcePerm as any).tapped = false;
  }
  return true;
}

export function applyRetiredTriggerLegacyReboundTrigger(
  params: TriggerLegacySpecialParams,
): boolean {
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
    (zones as any).graveyard.push({ ...exiledCard, zone: 'graveyard', reboundPending: false, reboundTriggered: false });
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

export function applyRetiredTriggerLegacyParadigmTrigger(
  params: TriggerLegacySpecialParams,
): boolean {
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
