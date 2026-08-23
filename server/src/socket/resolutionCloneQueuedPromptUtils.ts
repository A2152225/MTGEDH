/**
 * socket/resolutionCloneQueuedPromptUtils.ts
 *
 * Small shared helpers for resolution event persistence:
 * zone/library clone snapshots and queued resolveTopOfStackPrompt events.
 *
 * Extracted from resolution.ts so process-pending handlers can live separately
 * without circular imports.
 */

import { appendEvent } from "../db/index.js";
import { debugWarn } from "../utils/debug.js";
import { attachZoneHandSnapshotToStep } from "../state/modules/promptZoneHandSnapshot.js";

export function cloneCascadeZoneCard(card: any, zone: 'library' | 'exile'): any {
  return card && typeof card === 'object' ? { ...card, zone } : card;
}

export function cloneCascadeLibrary(cards: any[]): any[] {
  return Array.isArray(cards) ? cards.map((card: any) => cloneCascadeZoneCard(card, 'library')) : [];
}

export function cloneLibraryStateForEvent(cards: any[]): any[] {
  return Array.isArray(cards) ? cards.map((card: any) => ({ ...card, zone: 'library' })) : [];
}

export function cloneZoneCardsForEvent(cards: any[], zone: 'hand' | 'library' | 'graveyard' | 'exile'): any[] {
  return Array.isArray(cards) ? cards.map((card: any) => ({ ...card, zone })) : [];
}

export function cloneExileStateForEvent(cards: any[]): any[] {
  return cloneZoneCardsForEvent(cards, 'exile');
}

export function appendQueuedResolutionPromptEvent(
  game: any,
  gameId: string,
  options: {
    playerId?: string;
    sourceId?: string;
    queuedResolutionStep?: any;
    queuedResolutionSteps?: any[];
    additionalPayload?: Record<string, any>;
  },
): void {
  const playerId = String(options.playerId || '').trim();
  const state = (game as any)?.state;
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
  const additionalPayload =
    options.additionalPayload && typeof options.additionalPayload === 'object' && !Array.isArray(options.additionalPayload)
      ? options.additionalPayload
      : undefined;

  if (!gameId || queuedResolutionSteps.length === 0 && !queuedResolutionStep) {
    return;
  }

  try {
    appendEvent(
      gameId,
      Number((game as any)?.seq?.value ?? (game as any)?.seq ?? (game as any)?.state?.seq ?? 0),
      'resolveTopOfStackPrompt',
      {
        ...(playerId ? { playerId } : {}),
        ...(options.sourceId ? { sourceId: String(options.sourceId) } : {}),
        ...(queuedResolutionStep ? { queuedResolutionStep } : {}),
        ...(queuedResolutionSteps.length > 0 ? { queuedResolutionSteps } : {}),
        ...(additionalPayload || {}),
      },
    );
  } catch (err) {
    debugWarn(1, '[resolution] appendEvent(resolveTopOfStackPrompt) failed:', err);
  }
}