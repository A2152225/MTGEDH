/**
 * Origin parent: triggerDelayedCleanupUtils.ts / triggerDelayedEffectUtils.ts
 * Cluster moved: delayed next-upkeep "may draw up to N" picker queue + apply.
 * Public entry symbols: delayedUpkeepDrawIsUpToFromStep, queueDelayedDrawUpToChoice,
 *   isDelayedDrawUpToSelectionStep, delayedDrawUpToPromptAlreadyAnsweredInReplay,
 *   applyDelayedDrawUpToChoice, chooseDelayedDrawUpToCount.
 *
 * "Up to N" is choose 0..N at resolve time (CR 609.3), not a mandatory draw of N.
 * The caster's delayed "You draw a card" stays a mandatory count-1 draw.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { drawCards } from './zones.js';

function clampChosenDrawCount(step: any, selectedCount: number | null): number {
  const minValue = Number.isFinite(Number(step?.minValue))
    ? Math.max(0, Math.floor(Number(step.minValue)))
    : 0;
  const maxValue = Number.isFinite(Number(step?.maxValue))
    ? Math.max(minValue, Math.floor(Number(step.maxValue)))
    : minValue;
  if (selectedCount == null || !Number.isFinite(Number(selectedCount))) {
    return minValue;
  }
  return Math.max(minValue, Math.min(maxValue, Math.floor(Number(selectedCount))));
}

export function delayedUpkeepDrawIsUpToFromStep(
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>,
): boolean {
  const nestedSteps = Array.isArray(step.steps) ? step.steps : [];
  const drawStep = nestedSteps.find((nested) => nested.kind === 'draw') as
    | Extract<OracleEffectStep, { kind: 'draw' }>
    | undefined;
  const texts = [String(step.effect || ''), String(drawStep?.raw || '')];
  return texts.some((text) => /\bup\s+to\b/i.test(text));
}

export function isDelayedDrawUpToSelectionStep(step: any): boolean {
  return step?.delayedDrawUpTo === true;
}

/**
 * The up-to-N prompt is mandatory, so it stays the last persisted event until the
 * player answers. A later event (the drawCards that recorded the choice, or
 * delayedDrawUpToResolve when they chose 0) means the choice already happened.
 * Re-queueing the same step after undo would offer the draw again.
 */
export function delayedDrawUpToPromptAlreadyAnsweredInReplay(ctx: GameContext, step: any): boolean {
  if ((ctx as any)?.isReplaying !== true) return false;
  if (!isDelayedDrawUpToSelectionStep(step)) return false;
  const events = (ctx as any)._replayEvents;
  const index = Number((ctx as any)._replayEventIndex);
  if (!Array.isArray(events) || !Number.isFinite(index)) return false;
  return index < events.length - 1;
}

function persistDelayedDrawUpToResolve(
  ctx: GameContext,
  playerId: string,
  resolvedStepId: string,
  count: number,
): void {
  if ((ctx as any)?.isReplaying) return;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || !resolvedStepId) return;
  try {
    appendEvent(
      gameId,
      Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
      'delayedDrawUpToResolve',
      {
        playerId,
        resolvedStepId,
        count,
      },
    );
  } catch (err) {
    debugWarn(1, '[delayedDrawUpTo] appendEvent(delayedDrawUpToResolve) failed:', err);
  }
}

export function queueDelayedDrawUpToChoice(params: {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly triggerItem: any;
  readonly maxCount: number;
}): boolean {
  if ((params.ctx as any).isReplaying) {
    return true;
  }

  const maxCount = Math.max(1, Math.floor(Number(params.maxCount || 1)));
  const sourceName = String(
    params.sourceName || params.triggerItem?.delayedSourceName || 'Delayed trigger',
  ).trim() || 'Delayed trigger';
  const sourceId = String(
    params.triggerItem?.source
    || params.triggerItem?.permanentId
    || params.triggerItem?.sourceId
    || params.triggerItem?.delayedScheduleId
    || '',
  ).trim();

  queueResolveTopOfStackPrompt(params.ctx, {
    type: ResolutionStepType.X_VALUE_SELECTION,
    playerId: params.controller,
    description: `${sourceName}: Choose how many cards to draw (up to ${maxCount}).`,
    mandatory: true,
    sourceId,
    sourceName,
    sourceImage: params.triggerItem?.card?.image_uris?.small || params.triggerItem?.sourceImage,
    minValue: 0,
    maxValue: maxCount,
    delayedDrawUpTo: true,
  } as any);

  return true;
}

export function applyDelayedDrawUpToChoice(
  ctx: GameContext,
  step: any,
  selectedCount: number | null,
): void {
  const count = clampChosenDrawCount(step, selectedCount);
  const playerId = String(step?.playerId || '').trim();
  const resolvedStepId = String(step?.id || '').trim();
  if (playerId && count > 0) {
    drawCards(ctx, playerId as PlayerID, count);
  }
  persistDelayedDrawUpToResolve(ctx, playerId, resolvedStepId, count);
}

export function chooseDelayedDrawUpToCount(game: any, playerId: string, step: any): number {
  const minValue = Number.isFinite(Number(step?.minValue))
    ? Math.max(0, Math.floor(Number(step.minValue)))
    : 0;
  const maxValue = Number.isFinite(Number(step?.maxValue))
    ? Math.max(minValue, Math.floor(Number(step.maxValue)))
    : minValue;
  const library = typeof game?.libraries?.get === 'function'
    ? game.libraries.get(playerId)
    : undefined;
  const libraryCount = Array.isArray(library)
    ? library.length
    : Math.max(0, Math.floor(Number(game?.state?.zones?.[playerId]?.libraryCount ?? maxValue)));
  return Math.max(minValue, Math.min(maxValue, libraryCount));
}
