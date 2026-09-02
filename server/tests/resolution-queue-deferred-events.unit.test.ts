import { describe, expect, it, vi } from 'vitest';

import {
  ResolutionQueueEvent,
  ResolutionQueueManager,
  ResolutionStepType,
} from '../src/state/resolution/index.js';

describe('ResolutionQueueManager deferred step-added events', () => {
  const gameId = 'test_resolution_queue_deferred_events';

  it('defers STEP_ADDED emissions until the deferred scope exits', () => {
    ResolutionQueueManager.removeQueue(gameId);
    const addedStepIds: string[] = [];
    const handler = (event: ResolutionQueueEvent, eventGameId: string, step?: { id?: string }) => {
      if (eventGameId !== gameId || event !== ResolutionQueueEvent.STEP_ADDED || !step?.id) return;
      addedStepIds.push(String(step.id));
    };
    ResolutionQueueManager.on(handler);

    try {
      ResolutionQueueManager.runWithDeferredStepAddedEvents(gameId, () => {
        const step = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: 'p1',
          description: 'Deferred prompt',
          mandatory: false,
          options: [{ id: 'yes', label: 'Yes' }],
        } as any);
        expect(addedStepIds).toHaveLength(0);
        expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry) => entry.id === step.id)).toBe(true);
      });
      expect(addedStepIds).toHaveLength(0);
    } finally {
      ResolutionQueueManager.off(handler);
      ResolutionQueueManager.removeQueue(gameId);
    }
  });

  it('flushes deferred STEP_ADDED emissions on the next tick', async () => {
    ResolutionQueueManager.removeQueue(gameId);
    const addedStepIds: string[] = [];
    const handler = (event: ResolutionQueueEvent, eventGameId: string, step?: { id?: string }) => {
      if (eventGameId !== gameId || event !== ResolutionQueueEvent.STEP_ADDED || !step?.id) return;
      addedStepIds.push(String(step.id));
    };
    ResolutionQueueManager.on(handler);

    try {
      const step = ResolutionQueueManager.runWithDeferredStepAddedEvents(gameId, () =>
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: 'p1',
          description: 'Deferred prompt flush',
          mandatory: false,
          options: [{ id: 'yes', label: 'Yes' }],
        } as any),
      );

      await vi.waitFor(() => {
        expect(addedStepIds).toContain(String(step.id));
      });
    } finally {
      ResolutionQueueManager.off(handler);
      ResolutionQueueManager.removeQueue(gameId);
    }
  });

  it('does not emit STEP_ADDED for allowDuringReplay restore enqueue', () => {
    const replayGameId = 'test_resolution_queue_replay_skip_emit';
    ResolutionQueueManager.removeQueue(replayGameId);
    const addedStepIds: string[] = [];
    const handler = (event: ResolutionQueueEvent, eventGameId: string, step?: { id?: string }) => {
      if (eventGameId !== replayGameId || event !== ResolutionQueueEvent.STEP_ADDED || !step?.id) return;
      addedStepIds.push(String(step.id));
    };
    ResolutionQueueManager.on(handler);

    try {
      ResolutionQueueManager.beginReplay(replayGameId);
      const step = ResolutionQueueManager.addStep(replayGameId, {
        type: ResolutionStepType.SURVEIL,
        playerId: 'p1',
        description: 'Surveil 1',
        mandatory: true,
        cards: [{ id: 'c1', name: 'Card 1' }],
        surveilCount: 1,
      } as any, { allowDuringReplay: true });
      ResolutionQueueManager.endReplay(replayGameId);

      expect(String(step.id || '')).toBeTruthy();
      expect(ResolutionQueueManager.getQueue(replayGameId).steps.some((entry) => entry.id === step.id)).toBe(true);
      expect(addedStepIds).toHaveLength(0);
    } finally {
      ResolutionQueueManager.off(handler);
      ResolutionQueueManager.removeQueue(replayGameId);
    }
  });
});
