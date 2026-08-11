import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { appendQueuedResolutionPromptEvent } from '../src/state/modules/resolutionPromptEvents.js';
import { attachZoneHandSnapshotToStep, resolvePromptZoneHandRestore } from '../src/state/modules/promptZoneHandSnapshot.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';

describe('resolveTopOfStackPrompt hand restore', () => {
  it('does not overwrite zone hand with ChoiceOption discard stubs', () => {
    const gameId = 'test_prompt_choiceoption_hand_guard';
    const playerId = 'p1';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    game.applyEvent({ type: 'join', playerId, name: 'P1' } as any);

    const fullHand = [
      {
        id: 'card-1',
        name: 'Force of Will',
        type_line: 'Instant',
        oracle_text: 'You may pay 1 life...',
        image_uris: { normal: 'fow.png' },
        zone: 'hand',
      },
      {
        id: 'card-2',
        name: 'Force Spike',
        type_line: 'Instant',
        oracle_text: 'Counter target spell unless...',
        image_uris: { normal: 'spike.png' },
        zone: 'hand',
      },
    ];

    (game.state as any).zones = {
      [playerId]: {
        hand: fullHand.map((card) => ({ ...card })),
        handCount: fullHand.length,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      queuedResolutionStep: {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId,
        description: 'Discard 1 card',
        sourceName: 'Chart a Course',
        mandatory: true,
        discardCount: 1,
        reason: 'effect',
        hand: [
          { id: 'card-1', label: 'Force of Will', imageUrl: 'fow.png' },
          { id: 'card-2', label: 'Force Spike', imageUrl: 'spike.png' },
        ],
        currentHandSize: 2,
        maxHandSize: 1,
      },
    } as any);

    const handAfter = (game.state as any).zones?.[playerId]?.hand || [];
    expect(handAfter).toHaveLength(2);
    expect(handAfter.map((card: any) => card.name)).toEqual(['Force of Will', 'Force Spike']);
    expect(handAfter.every((card: any) => card.type_line && card.oracle_text)).toBe(true);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((entry: any) => entry.id)).toEqual(['card-1', 'card-2']);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('restores zone hand from zoneHandSnapshot even when hand is ChoiceOptions', () => {
    const gameId = 'test_prompt_zone_hand_snapshot_restore';
    const playerId = 'p1';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    game.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const zoneHandSnapshot = [
      {
        id: 'h1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '',
        image_uris: { normal: 'island.png' },
      },
      {
        id: 'h2',
        name: 'Force of Will',
        type_line: 'Instant',
        oracle_text: 'You may pay 1 life...',
        image_uris: { normal: 'fow.png' },
      },
      {
        id: 'h3',
        name: 'Mana Leak',
        type_line: 'Instant',
        oracle_text: 'Counter target spell unless...',
        image_uris: { normal: 'leak.png' },
      },
    ];

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      queuedResolutionStep: {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId,
        description: 'Discard 1 card',
        sourceName: 'Cleanup',
        mandatory: true,
        discardCount: 1,
        reason: 'cleanup',
        hand: zoneHandSnapshot.map((card) => ({
          id: card.id,
          label: card.name,
          imageUrl: card.image_uris.normal,
        })),
        zoneHandSnapshot,
        currentHandSize: 3,
        maxHandSize: 2,
      },
    } as any);

    const handAfter = (game.state as any).zones?.[playerId]?.hand || [];
    expect(handAfter.map((card: any) => card.id)).toEqual(['h1', 'h2', 'h3']);
    expect(handAfter.map((card: any) => card.name)).toEqual(['Island', 'Force of Will', 'Mana Leak']);
    expect(handAfter.every((card: any) => card.type_line)).toBe(true);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('still restores zone hand from legacy full KnownCardRef hand arrays', () => {
    const gameId = 'test_prompt_full_hand_restore';
    const playerId = 'p1';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    game.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ id: 'stale', name: 'Stale Card', type_line: 'Instant', zone: 'hand' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const snapshot = [
      {
        id: 'fresh-1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '',
        image_uris: { normal: 'island.png' },
      },
      {
        id: 'fresh-2',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '',
        image_uris: { normal: 'forest.png' },
      },
    ];

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      queuedResolutionStep: {
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId,
        description: 'Discard 1 card',
        sourceName: 'Effect',
        mandatory: true,
        discardCount: 1,
        reason: 'effect',
        hand: snapshot,
        currentHandSize: 2,
        maxHandSize: 1,
      },
    } as any);

    const handAfter = (game.state as any).zones?.[playerId]?.hand || [];
    expect(handAfter.map((card: any) => card.id)).toEqual(['fresh-1', 'fresh-2']);
    expect(handAfter.map((card: any) => card.name)).toEqual(['Island', 'Forest']);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('persists zoneHandSnapshot on resolveTopOfStackPrompt for ChoiceOption discard steps', async () => {
    await initDb();
    const gameId = 'test_prompt_persist_zone_hand_snapshot';
    const playerId = 'p1';
    ResolutionQueueManager.removeQueue(gameId);
    try {
      truncateEventsForUndo(gameId, 0);
    } catch {
      // ignore
    }
    await deleteGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = createInitialGameState(gameId);
    (game as any).gameId = gameId;
    game.applyEvent({ type: 'join', playerId, name: 'P1' } as any);

    const fullHand = Array.from({ length: 8 }, (_, i) => ({
      id: `card-${i + 1}`,
      name: `Test Card ${i + 1}`,
      type_line: 'Instant',
      oracle_text: `Oracle ${i + 1}`,
      image_uris: { normal: `card-${i + 1}.png` },
      zone: 'hand',
    }));
    (game.state as any).zones = {
      [playerId]: {
        hand: fullHand.map((card) => ({ ...card })),
        handCount: fullHand.length,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const choiceHand = fullHand.map((card) => ({
      id: card.id,
      label: card.name,
      imageUrl: card.image_uris.normal,
    }));

    const step = {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId,
      description: 'Discard 1 card',
      sourceName: 'Chart a Course',
      mandatory: true,
      discardCount: 1,
      reason: 'effect',
      hand: choiceHand,
      currentHandSize: 8,
      maxHandSize: 7,
    };

    appendQueuedResolutionPromptEvent(game as any, {
      playerId,
      sourceId: 'stack_1',
      queuedResolutionStep: step,
    });

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    const persisted = promptEvent.payload?.queuedResolutionStep;
    expect((persisted?.hand || []).map((entry: any) => entry.id)).toEqual(fullHand.map((card) => card.id));
    expect((persisted?.hand || [])[0]?.label).toBe('Test Card 1');
    expect((persisted?.hand || [])[0]?.name).toBeUndefined();
    expect((persisted?.zoneHandSnapshot || []).map((card: any) => card.name)).toEqual(
      fullHand.map((card) => card.name),
    );
    expect((persisted?.zoneHandSnapshot || []).every((card: any) => card.oracle_text)).toBe(true);

    // Empty zone then replay — snapshot must rebuild all 8 selectable cards.
    (game.state as any).zones[playerId].hand = [];
    (game.state as any).zones[playerId].handCount = 0;
    ResolutionQueueManager.removeQueue(gameId);
    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const restored = (game.state as any).zones?.[playerId]?.hand || [];
    expect(restored).toHaveLength(8);
    expect(restored.map((card: any) => card.name)).toEqual(fullHand.map((card) => card.name));

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect((discardStep?.hand || []).map((entry: any) => entry.id)).toHaveLength(8);

    ResolutionQueueManager.removeQueue(gameId);
    await deleteGame(gameId);
  });

  it('attachZoneHandSnapshotToStep keeps ChoiceOptions and clones zone cards', () => {
    const playerId = 'p1';
    const state = {
      zones: {
        [playerId]: {
          hand: [
            { id: 'a', name: 'Alpha', type_line: 'Instant', oracle_text: 'A' },
            { id: 'b', name: 'Beta', type_line: 'Sorcery', oracle_text: 'B' },
          ],
        },
      },
    };
    const step = {
      type: 'discard_selection',
      playerId,
      hand: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ],
    };
    const attached = attachZoneHandSnapshotToStep(state, step, playerId);
    expect(attached.hand).toEqual(step.hand);
    expect(attached.zoneHandSnapshot.map((card: any) => card.name)).toEqual(['Alpha', 'Beta']);
    expect(resolvePromptZoneHandRestore(attached)?.map((card: any) => card.id)).toEqual(['a', 'b']);
    expect(resolvePromptZoneHandRestore({ hand: step.hand })).toBeNull();
  });
});
