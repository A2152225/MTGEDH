import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { processPendingBottomOrder } from '../src/socket/resolution.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function initZones(game: any, playerId: PlayerID) {
  (game.state as any).zones = {
    ...(game.state as any).zones,
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };
}

describe('reorder effect replay semantics', () => {
  it('replays scry completion and clears stale pending state', () => {
    const gameId = 't_scry_resolve_replay_cleanup';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    game.importDeckResolved(p1, [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
      { id: 'c3', name: 'Card 3', zone: 'library' },
      { id: 'c4', name: 'Card 4', zone: 'library' },
    ] as any);
    (game.state as any).pendingScry = { [p1]: { count: 2, queued: true } };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SCRY,
      playerId: p1,
      description: 'Scry 2',
      mandatory: true,
      cards: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
      ],
      scryCount: 2,
    } as any);

    game.applyEvent({
      type: 'scryResolve',
      playerId: p1,
      keepTopOrder: [{ id: 'c2', name: 'Card 2' }],
      bottomOrder: [{ id: 'c1', name: 'Card 1' }],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['c2', 'c3', 'c4', 'c1']);
    expect((game.state as any).pendingScry).toBeUndefined();
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });

  it('replays surveil completion and clears stale pending state', () => {
    const gameId = 't_surveil_resolve_replay_cleanup';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    game.importDeckResolved(p1, [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
      { id: 'c3', name: 'Card 3', zone: 'library' },
    ] as any);
    (game.state as any).pendingSurveil = { [p1]: { count: 2, queued: true } };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SURVEIL,
      playerId: p1,
      description: 'Surveil 2',
      mandatory: true,
      cards: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
      ],
      surveilCount: 2,
    } as any);

    game.applyEvent({
      type: 'surveilResolve',
      playerId: p1,
      toGraveyard: [{ id: 'c1', name: 'Card 1' }],
      keepTopOrder: [{ id: 'c2', name: 'Card 2' }],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['c2', 'c3']);
    expect((game.state as any).zones[p1].graveyard.map((card: any) => card.id)).toEqual(['c1']);
    expect((game.state as any).pendingSurveil).toBeUndefined();
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });

  it('replays surveil follow-up exile prompts after surveil completion', () => {
    const gameId = 't_surveil_followup_prompt_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    initZones(game, p1);
    initZones(game, p2);

    game.importDeckResolved(p1, [
      { id: 'c1', name: 'Card 1', zone: 'library' },
      { id: 'c2', name: 'Card 2', zone: 'library' },
    ] as any);
    (game.state as any).pendingSurveil = { [p1]: { count: 2, queued: true } };
    (game.state as any).zones[p2].graveyard = [{ id: 'g_opponent', name: 'Dead Card', zone: 'graveyard' }];
    (game.state as any).zones[p2].graveyardCount = 1;

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SURVEIL,
      playerId: p1,
      description: 'Test Walker: Surveil 2',
      mandatory: true,
      sourceId: 'walker_1',
      sourceName: 'Test Walker',
      cards: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
      ],
      surveilCount: 2,
    } as any);

    game.applyEvent({
      type: 'surveilResolve',
      playerId: p1,
      toGraveyard: [{ id: 'c1', name: 'Card 1' }],
      keepTopOrder: [{ id: 'c2', name: 'Card 2' }],
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'walker_1',
      queuedResolutionStep: {
        id: 'queued_surveil_followup_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        sourceId: 'walker_1',
        sourceName: 'Test Walker',
        description: 'Test Walker: Exile a card from a graveyard',
        mandatory: true,
        action: 'exile_graveyard_card',
        validTargets: [
          { id: 'c1', label: 'Card 1', description: 'card', zone: 'graveyard', owner: p1 },
          { id: 'g_opponent', label: 'Dead Card', description: 'card', zone: 'graveyard', owner: p2 },
        ],
        minTargets: 1,
        maxTargets: 1,
      },
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['c2']);
    expect((game.state as any).zones[p1].graveyard.map((card: any) => card.id)).toEqual(['c1']);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.action).toBe('exile_graveyard_card');
  });

  it('replays ponder-style completion by restoring hand and library state', () => {
    const gameId = 't_ponder_effect_resolve_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    (game.state as any).pendingPonder = {
      [p1]: {
        effectId: 'ponder_1',
        cardCount: 3,
        cardName: 'Ponder',
        drawAfter: true,
        queued: true,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.PONDER_EFFECT,
      playerId: p1,
      description: 'Ponder',
      cards: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
        { id: 'c3', name: 'Card 3' },
      ],
      cardCount: 3,
      drawAfter: true,
      sourceName: 'Ponder',
      effectId: 'ponder_1',
      targetPlayerId: p1,
      variant: 'ponder',
    } as any);

    game.applyEvent({
      type: 'ponderEffectResolve',
      playerId: p1,
      targetPlayerId: p1,
      effectId: 'ponder_1',
      sourceName: 'Ponder',
      variant: 'ponder',
      shouldShuffle: false,
      toHandCards: [{ id: 'c2', name: 'Card 2', zone: 'hand' }],
      drawnCard: { id: 'c1', name: 'Card 1', zone: 'hand' },
      libraryAfter: [{ id: 'c3', name: 'Card 3', zone: 'library' }],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['c3']);
    expect((game.state as any).zones[p1].hand.map((card: any) => card.id)).toEqual(['c2', 'c1']);
    expect((game.state as any).pendingPonder).toBeUndefined();
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });

  it('replays bottom-order completion by restoring the final library and clearing pending prompt state', () => {
    const gameId = 't_bottom_order_resolve_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    game.importDeckResolved(p1, [
      { id: 'base_1', name: 'Base 1', zone: 'library' },
      { id: 'base_2', name: 'Base 2', zone: 'library' },
    ] as any);
    (game.state as any).pendingBottomOrder = {
      [p1]: [
        {
          effectId: 'bottom_1',
          sourceId: 'source_1',
          sourceName: 'Impulse Variant',
          cards: [
            { id: 'c1', name: 'Card 1', zone: 'library' },
            { id: 'c2', name: 'Card 2', zone: 'library' },
          ],
          shuffleAfter: false,
          queued: true,
        },
      ],
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BOTTOM_ORDER,
      playerId: p1,
      description: 'Put cards on the bottom',
      mandatory: true,
      sourceId: 'source_1',
      sourceName: 'Impulse Variant',
      effectId: 'bottom_1',
      cards: [
        { id: 'c1', name: 'Card 1', zone: 'library' },
        { id: 'c2', name: 'Card 2', zone: 'library' },
      ],
    } as any);

    game.applyEvent({
      type: 'bottomOrderResolve',
      playerId: p1,
      effectId: 'bottom_1',
      sourceId: 'source_1',
      sourceName: 'Impulse Variant',
      orderedCardIds: ['c2', 'c1'],
      libraryAfter: [
        { id: 'base_1', name: 'Base 1', zone: 'library' },
        { id: 'base_2', name: 'Base 2', zone: 'library' },
        { id: 'c2', name: 'Card 2', zone: 'library' },
        { id: 'c1', name: 'Card 1', zone: 'library' },
      ],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['base_1', 'base_2', 'c2', 'c1']);
    expect((game.state as any).pendingBottomOrder).toBeUndefined();
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });

  it('reconstructs bottom-order prompts from persisted library-search state', () => {
    const gameId = 't_library_search_bottom_order_rehydrate';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    game.applyEvent({
      type: 'librarySearchResolve',
      playerId: p1,
      sourceId: 'impulse_like_source',
      sourceName: 'Impulse Variant',
      selectedCardIds: ['chosen_card'],
      selectedCards: [{ id: 'chosen_card', name: 'Chosen Card', type_line: 'Instant' }],
      destination: 'hand',
      libraryAfter: [{ id: 'base_1', name: 'Base 1', zone: 'library' }],
      pendingBottomOrder: {
        effectId: 'impulse_like_source:rest_1:rest_2',
        sourceId: 'impulse_like_source',
        sourceName: 'Impulse Variant',
        description: 'Impulse Variant: Put the rest on the bottom of your library in any order.',
        cards: [
          { id: 'rest_1', name: 'Rest 1', zone: 'library' },
          { id: 'rest_2', name: 'Rest 2', zone: 'library' },
        ],
        shuffleAfter: true,
      },
    } as any);

    expect((game.state as any).pendingBottomOrder?.[p1]).toHaveLength(1);
    expect((game.state as any).pendingBottomOrder[p1][0].queued).toBe(false);

    processPendingBottomOrder({} as any, game, gameId);

    const queuedSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(queuedSteps).toHaveLength(1);
    expect(queuedSteps[0]?.type).toBe(ResolutionStepType.BOTTOM_ORDER);
    expect((queuedSteps[0] as any)?.effectId).toBe('impulse_like_source:rest_1:rest_2');
    expect((game.state as any).pendingBottomOrder[p1][0].queued).toBe(true);
  });

  it('replays queue-first bottom-order prompts persisted separately from library search resolution', () => {
    const gameId = 't_library_search_bottom_order_queue_first_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    game.applyEvent({
      type: 'librarySearchResolve',
      playerId: p1,
      sourceId: 'impulse_like_source',
      sourceName: 'Impulse Variant',
      selectedCardIds: ['chosen_card'],
      selectedCards: [{ id: 'chosen_card', name: 'Chosen Card', type_line: 'Instant' }],
      destination: 'hand',
      libraryAfter: [{ id: 'base_1', name: 'Base 1', zone: 'library' }],
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'impulse_like_source',
      queuedResolutionStep: {
        id: 'queued_bottom_order_prompt_1',
        type: ResolutionStepType.BOTTOM_ORDER,
        playerId: p1,
        sourceId: 'impulse_like_source',
        sourceName: 'Impulse Variant',
        description: 'Impulse Variant: Put the rest on the bottom of your library in any order.',
        mandatory: true,
        effectId: 'impulse_like_source:rest_1:rest_2',
        cards: [
          { id: 'rest_1', name: 'Rest 1', zone: 'library' },
          { id: 'rest_2', name: 'Rest 2', zone: 'library' },
        ],
        shuffleAfter: true,
      },
    } as any);

    expect((game.state as any).pendingBottomOrder).toBeUndefined();
    expect((game.state as any).zones[p1].hand.map((card: any) => card.id)).toEqual(['chosen_card']);
    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['base_1']);

    const queuedSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(queuedSteps).toHaveLength(1);
    expect(String((queuedSteps[0] as any)?.id || '')).toBe('queued_bottom_order_prompt_1');
    expect((queuedSteps[0] as any)?.type).toBe(ResolutionStepType.BOTTOM_ORDER);
    expect((queuedSteps[0] as any)?.effectId).toBe('impulse_like_source:rest_1:rest_2');
  });
});