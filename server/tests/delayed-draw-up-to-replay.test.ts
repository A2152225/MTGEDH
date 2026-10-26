import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { initDb, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  applyDelayedDrawUpToChoice,
  queueDelayedDrawUpToChoice,
} from '../src/state/modules/triggerDelayedDrawUpToUtils.js';
import { transformDbEventsForReplay } from '../src/socket/util.js';

const p1 = 'p_draw' as PlayerID;

function card(id: string) {
  return { id, name: id, type_line: 'Instant', oracle_text: '' };
}

const libraryCards = [card('c1'), card('c2'), card('c3'), card('c4')];

function delayedDrawPrompt(stepId = 'step-arcane-draw') {
  return {
    type: 'resolveTopOfStackPrompt',
    playerId: p1,
    sourceId: 'stack_arcane',
    queuedResolutionStep: {
      id: stepId,
      type: 'x_value_selection',
      playerId: p1,
      description: 'Arcane Denial: Choose how many cards to draw (up to 2).',
      mandatory: true,
      minValue: 0,
      maxValue: 2,
      delayedDrawUpTo: true,
      sourceId: 'stack_arcane',
      sourceName: 'Arcane Denial',
    },
  };
}

function handIds(game: any): string[] {
  return ((game.state.zones?.[p1]?.hand ?? []) as any[]).map((entry) => String(entry?.id || ''));
}

function pendingStepIds(gameId: string): string[] {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  const steps = [
    ...(Array.isArray(queue?.steps) ? queue.steps : []),
    queue?.activeStep,
  ].filter(Boolean);
  return steps
    .filter((step: any) => step.status !== 'completed' && step.status !== 'cancelled')
    .map((step: any) => String(step.id || ''));
}

function replayFrom(gameId: string, events: any[]) {
  ResolutionQueueManager.removeQueue(gameId);
  const game = createInitialGameState(gameId);
  game.replay!(events);
  return game;
}

describe('delayed draw up to replay', () => {
  const gameId = 'delayed_draw_up_to_replay';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('does not restore an answered Arcane Denial draw prompt or draw those cards again', () => {
    const game = replayFrom(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      { type: 'deckImportResolved', playerId: p1, cards: libraryCards },
      delayedDrawPrompt(),
      { type: 'drawCards', playerId: p1, count: 2, drawnCardIds: ['c1', 'c2'] },
    ]);

    expect(pendingStepIds(gameId)).not.toContain('step-arcane-draw');
    expect(handIds(game)).toEqual(['c1', 'c2']);
  });

  it('keeps the prompt when undo stops before the choice is answered', () => {
    const game = replayFrom(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      { type: 'deckImportResolved', playerId: p1, cards: libraryCards },
      delayedDrawPrompt(),
    ]);

    expect(pendingStepIds(gameId)).toContain('step-arcane-draw');
    expect(handIds(game)).toEqual([]);
    expect(game.state.zones?.[p1]?.libraryCount).toBe(4);
  });

  it('drops a zero-card choice once later play continued, without drawing', () => {
    const game = replayFrom(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      { type: 'deckImportResolved', playerId: p1, cards: libraryCards },
      delayedDrawPrompt(),
      { type: 'passPriority', by: p1 },
    ]);

    expect(pendingStepIds(gameId)).not.toContain('step-arcane-draw');
    expect(handIds(game)).toEqual([]);
    expect(game.state.zones?.[p1]?.libraryCount).toBe(4);
  });

  it('keeps an unanswered X selection when replay stops on that prompt', () => {
    replayFrom(gameId, [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'resolveTopOfStackPrompt',
        playerId: p1,
        queuedResolutionStep: {
          id: 'step-spell-x',
          type: ResolutionStepType.X_VALUE_SELECTION,
          playerId: p1,
          description: 'Choose X',
          mandatory: true,
          minValue: 0,
          maxValue: 3,
        },
      },
    ]);

    expect(pendingStepIds(gameId)).toContain('step-spell-x');
  });

  it('records the choice and replays the draw once', async () => {
    await initDb();
    const liveId = 'delayed_draw_up_to_live_replay';
    ResolutionQueueManager.removeQueue(liveId);
    const game = createInitialGameState(liveId);
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: libraryCards });

    queueDelayedDrawUpToChoice({
      ctx: game as any,
      controller: p1,
      sourceName: 'Arcane Denial',
      triggerItem: { sourceId: 'stack_arcane', delayedSourceName: 'Arcane Denial' },
      maxCount: 2,
    });
    const step = ResolutionQueueManager.getQueue(liveId).steps.find((entry) => (entry as any).delayedDrawUpTo === true);
    expect(step?.id).toBeTruthy();

    applyDelayedDrawUpToChoice(game as any, step, 2);
    expect(handIds(game)).toHaveLength(2);

    const persisted = transformDbEventsForReplay(getEvents(liveId) as any);
    expect(persisted.some((event) => event.type === 'delayedDrawUpToResolve' && event.resolvedStepId === step!.id)).toBe(true);
    const drawEvents = persisted.filter((event) => event.type === 'drawCards');
    expect(drawEvents).toHaveLength(1);
    expect(drawEvents[0].drawnCardIds).toHaveLength(2);

    game.reset!(true);
    game.replay!([
      { type: 'join', playerId: p1, name: 'P1' },
      { type: 'deckImportResolved', playerId: p1, cards: libraryCards },
      ...persisted,
    ]);

    expect(pendingStepIds(liveId)).not.toContain(step!.id);
    expect(handIds(game)).toHaveLength(2);
    expect(game.state.zones?.[p1]?.libraryCount).toBe(2);

    ResolutionQueueManager.removeQueue(liveId);
  });
});
