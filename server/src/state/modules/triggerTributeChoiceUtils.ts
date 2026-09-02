import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { bindCanonicalResolutionQueueGameId } from '../resolution/resolutionQueueGameIds.js';
import { processKeywordTriggers, type KeywordTriggerContext } from './keyword-handlers.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import { playerCannotReceivePriority } from './priorityEligibility.js';

function playerEntryId(player: any): string {
  return String(player?.id || player?.playerId || '').trim();
}

function resolveTributePlayers(state: any, controller: string): any[] {
  const listed = Array.isArray(state?.players) ? state.players : [];
  const normalizedListed = listed
    .map((player: any) => {
      const id = playerEntryId(player);
      if (!id) return null;
      return { ...player, id };
    })
    .filter((player: any) => player && !playerCannotReceivePriority(player, { state }));
  if (normalizedListed.some((player: any) => player.id !== controller)) {
    return normalizedListed;
  }

  const ids = [
    ...Object.keys(state?.life || {}),
    ...Object.keys(state?.zones || {}),
  ].filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
  if (ids.length === 0) return normalizedListed;
  return ids.map((id) => {
    const existing = normalizedListed.find((player: any) => player.id === id);
    return existing || { id, name: id };
  });
}

export function queueTributeChoiceOnEntry(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): boolean {
  if ((ctx as any).isReplaying) {
    return false;
  }

  const state = (ctx as any).state;
  if (!state || !permanent?.card) {
    return false;
  }

  const existingOutcome =
    permanent?.tributePaid ??
    permanent?.tributeWasPaid ??
    permanent?.card?.tributePaid ??
    permanent?.card?.tributeWasPaid;
  if (typeof existingOutcome === 'boolean') {
    return false;
  }

  const battlefield = state.battlefield || [];
  const actualController = (permanent?.controller || controller) as PlayerID;
  const players = resolveTributePlayers(state, String(actualController));
  const keywordCtx: KeywordTriggerContext = {
    gameId: bindCanonicalResolutionQueueGameId(ctx) || (ctx as any).gameId || 'unknown',
    permanent,
    controller: actualController,
    state,
    battlefield,
    players,
    activePlayer: state.activePlayer || actualController,
  };

  const tributeResult = processKeywordTriggers(keywordCtx, 'etb').find(
    (result) => result.keyword === 'tribute' && result.requiresPlayerChoice?.type === 'tribute_choice',
  );
  if (!tributeResult?.requiresPlayerChoice) {
    return false;
  }

  const keywordChoice = tributeResult.requiresPlayerChoice;
  const gameId = bindCanonicalResolutionQueueGameId(ctx)
    || String((ctx as any).gameId || (ctx as any).state?.id || '').trim();
  if (!gameId || gameId === 'unknown') {
    return false;
  }

  const normalizedPermanentId = String(keywordChoice.permanentId || permanent?.id || '').trim();
  if (!normalizedPermanentId) {
    return false;
  }

  const existingStep = ResolutionQueueManager.getStepsForPlayer(gameId, keywordChoice.playerId as any).some(
    (step: any) =>
      step?.type === ResolutionStepType.TRIBUTE_CHOICE &&
      String(step?.permanentId || '').trim() === normalizedPermanentId,
  );
  if (existingStep) {
    return true;
  }

  const normalizedOptions = Array.isArray(keywordChoice.options)
    ? keywordChoice.options
        .map((option: any) => {
          const id = String(option?.id ?? option?.value ?? option?.name ?? '').trim();
          if (!id) return null;
          return {
            ...option,
            id,
            label: String(option?.label ?? option?.name ?? id),
          };
        })
        .filter(Boolean)
    : [];
  if (normalizedOptions.length === 0) {
    return false;
  }

  const queuedStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TRIBUTE_CHOICE,
    playerId: keywordChoice.playerId as any,
    description: String(tributeResult.chatMessage || `${permanent?.card?.name || 'Permanent'}: Tribute choice`),
    mandatory: true,
    sourceId: normalizedPermanentId,
    sourceName: String(permanent?.card?.name || 'Permanent'),
    sourceImage:
      permanent?.card?.image_uris?.small ||
      permanent?.card?.image_uris?.normal ||
      permanent?.card?.imageUrl ||
      undefined,
    permanentId: normalizedPermanentId,
    options: normalizedOptions,
    minSelections: 1,
    maxSelections: 1,
    ...(typeof keywordChoice.value === 'number' && Number.isFinite(keywordChoice.value)
      ? { value: keywordChoice.value }
      : null),
  } as any);

  appendQueuedResolutionPromptEvent(ctx, {
    playerId: String(keywordChoice.playerId || '').trim(),
    sourceId: normalizedPermanentId,
    queuedResolutionStep: queuedStep,
  });

  debug(2, `[queueTributeChoiceOnEntry] Queued tribute choice for ${permanent?.card?.name || normalizedPermanentId}`);
  return true;
}
