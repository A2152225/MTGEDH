import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { ResolutionQueueManager, type CreateResolutionStepConfig } from '../resolution/index.js';
import { attachZoneHandSnapshotToStep } from './promptZoneHandSnapshot.js';

export function appendQueuedResolutionPromptEvent(
  ctx: GameContext,
  options: {
    playerId?: string;
    sourceId?: string;
    queuedResolutionStep?: any;
    queuedResolutionSteps?: any[];
  },
): void {
  const gameId = String((ctx as any).gameId || 'unknown');
  const playerId = String(options.playerId || '').trim();
  const state = (ctx as any)?.state;
  const queuedResolutionSteps = Array.isArray(options.queuedResolutionSteps)
    ? options.queuedResolutionSteps
        .filter((step) => step && typeof step === 'object' && !Array.isArray(step))
        .map((step) => attachZoneHandSnapshotToStep(state, step, playerId || String((step as any)?.playerId || '')))
    : [];
  const queuedResolutionStep =
    options.queuedResolutionStep && typeof options.queuedResolutionStep === 'object' && !Array.isArray(options.queuedResolutionStep)
      ? attachZoneHandSnapshotToStep(
          state,
          options.queuedResolutionStep,
          playerId || String((options.queuedResolutionStep as any)?.playerId || ''),
        )
      : undefined;

  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) {
    return;
  }

  if (!queuedResolutionStep && queuedResolutionSteps.length === 0) {
    return;
  }

  try {
    const remainingLibraryIds = playerId
      ? (() => {
        const lib = (ctx as any).libraries?.get?.(playerId)
          ?? (ctx.state as any)?.zones?.[playerId]?.library
          ?? [];
        return Array.isArray(lib)
          ? lib.map((card: any) => String(card?.id || '')).filter(Boolean)
          : [];
      })()
      : undefined;

    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0), 'resolveTopOfStackPrompt', {
      playerId,
      sourceId: String(options.sourceId || '').trim(),
      ...(Array.isArray(remainingLibraryIds) ? { remainingLibraryIds } : {}),
      ...(queuedResolutionSteps.length > 0
        ? { queuedResolutionSteps }
        : { queuedResolutionStep }),
    });
  } catch (err) {
    debugWarn(1, '[resolveTopOfStack] appendEvent(resolveTopOfStackPrompt) failed:', err);
  }
}

export function queueResolveTopOfStackPrompt(
  ctx: GameContext,
  config: CreateResolutionStepConfig,
): void {
  const gameId = String((ctx as any).gameId || 'unknown');
  const step = ResolutionQueueManager.addStep(gameId, config);

  appendQueuedResolutionPromptEvent(ctx, {
    playerId: String((step as any).playerId || (config as any).playerId || '').trim(),
    sourceId: String((step as any).sourceId || (config as any).sourceId || '').trim(),
    queuedResolutionStep: step,
  });
}

