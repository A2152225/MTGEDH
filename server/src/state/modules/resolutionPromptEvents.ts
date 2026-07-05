import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { ResolutionQueueManager, type CreateResolutionStepConfig } from '../resolution/index.js';

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
  const queuedResolutionSteps = Array.isArray(options.queuedResolutionSteps)
    ? options.queuedResolutionSteps.filter((step) => step && typeof step === 'object' && !Array.isArray(step))
    : [];
  const queuedResolutionStep =
    options.queuedResolutionStep && typeof options.queuedResolutionStep === 'object' && !Array.isArray(options.queuedResolutionStep)
      ? options.queuedResolutionStep
      : undefined;

  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) {
    return;
  }

  if (!queuedResolutionStep && queuedResolutionSteps.length === 0) {
    return;
  }

  try {
    const remainingLibraryIds = options.playerId
      ? (() => {
        const pid = String(options.playerId || '').trim();
        const lib = (ctx as any).libraries?.get?.(pid)
          ?? (ctx.state as any)?.zones?.[pid]?.library
          ?? [];
        return Array.isArray(lib)
          ? lib.map((card: any) => String(card?.id || '')).filter(Boolean)
          : [];
      })()
      : undefined;

    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0), 'resolveTopOfStackPrompt', {
      playerId: String(options.playerId || '').trim(),
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

