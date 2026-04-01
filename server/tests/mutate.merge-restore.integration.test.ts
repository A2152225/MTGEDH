import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';

describe('Mutate merge restore (integration)', () => {
  const gameId = 'test_mutate_merge_restore';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('merges a mutating creature spell into its target, persists the merge, and restores it from the explicit event', () => {
    const persistentGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    ResolutionQueueManager.removeQueue(persistentGameId);
    games.delete(persistentGameId as any);

    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'target_card_1',
          name: 'Parcelbeast Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'stack_mutate_1',
        type: 'spell',
        controller: playerId,
        alternateCostId: 'mutate',
        targets: ['target_1'],
        card: {
          id: 'mutate_card_1',
          name: 'Gemrazer',
          type_line: 'Creature - Beast',
          oracle_text: 'Mutate {1}{G}{G}\nReach\nTrample',
          zone: 'stack',
          power: '4',
          toughness: '4',
          isMutating: true,
          mutateTarget: 'target_1',
          mutateOnTop: true,
          alternateCostId: 'mutate',
        },
      },
    ];

    game.resolveTopOfStack();

    const mergedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'target_1');
    expect(((game.state as any).battlefield || []).length).toBe(1);
    expect(mergedPermanent?.card?.name).toBe('Gemrazer');
    expect(mergedPermanent?.basePower).toBe(4);
    expect(mergedPermanent?.baseToughness).toBe(4);
    expect(mergedPermanent?.mutationCount).toBe(1);
    expect(Array.isArray(mergedPermanent?.mutatedStack)).toBe(true);
    expect(mergedPermanent?.mutatedStack).toHaveLength(2);
    expect(String(mergedPermanent?.card?.oracle_text || '')).toContain('Reach');
    expect(String(mergedPermanent?.card?.oracle_text || '')).toContain('Vigilance');

    const persisted = [...getEvents(persistentGameId)].reverse().find((event: any) => event.type === 'mutatePermanent') as any;
    expect(persisted?.payload?.targetPermanentId).toBe('target_1');
    expect(persisted?.payload?.mutatingCard?.id).toBe('mutate_card_1');
    expect(persisted?.payload?.onTop).toBe(true);

    const replayGame = createInitialGameState(`${persistentGameId}_explicit_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (replayGame.state as any).battlefield = [
      {
        id: 'target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'target_card_1',
          name: 'Parcelbeast Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];

    replayGame.applyEvent({ type: 'mutatePermanent', ...(persisted.payload || {}) } as any);

    const replayMergedPermanent = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'target_1');
    expect(replayMergedPermanent?.card?.name).toBe('Gemrazer');
    expect(replayMergedPermanent?.mutationCount).toBe(1);
    expect(replayMergedPermanent?.mutatedStack).toHaveLength(2);
    expect(String(replayMergedPermanent?.card?.oracle_text || '')).toContain('Reach');
    expect(String(replayMergedPermanent?.card?.oracle_text || '')).toContain('Vigilance');
  });

  it('queues and persists mutate triggers, and replays them only from pushTriggeredAbility', () => {
    const persistentGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    ResolutionQueueManager.removeQueue(persistentGameId);
    games.delete(persistentGameId as any);

    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'target_card_1',
          name: 'Migratory Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'artifact_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        card: {
          id: 'artifact_card_1',
          name: 'Opponent Relic',
          type_line: 'Artifact',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'stack_mutate_trigger_1',
        type: 'spell',
        controller: playerId,
        alternateCostId: 'mutate',
        targets: ['target_1'],
        card: {
          id: 'mutate_card_trigger_1',
          name: 'Gemrazer',
          type_line: 'Creature - Beast',
          oracle_text: 'Mutate {1}{G}{G}\nReach\nTrample\nWhenever this creature mutates, destroy target artifact or enchantment.',
          zone: 'stack',
          power: '4',
          toughness: '4',
          isMutating: true,
          mutateTarget: 'target_1',
          mutateOnTop: true,
          alternateCostId: 'mutate',
        },
      },
    ];

    game.resolveTopOfStack();

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'target_1',
      sourceName: 'Gemrazer',
      description: 'destroy target artifact or enchantment.',
      triggerType: 'triggered_ability',
      mandatory: true,
      requiresTarget: true,
      targetType: 'artifact',
      needsTargetSelection: true,
    });
    expect(String(triggerStack[0]?.effect || '')).toContain('Whenever this creature mutates');

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(persistentGameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('target_selection');
    expect(String((queue.steps[0] as any)?.action || '')).toBe('destroy_artifact_enchantment');

    const allEvents = [...getEvents(persistentGameId)].reverse();
    const persistedMutate = allEvents.find((event: any) => event.type === 'mutatePermanent') as any;
    const persistedTrigger = allEvents.find((event: any) => event.type === 'pushTriggeredAbility') as any;
    expect(persistedMutate?.payload?.targetPermanentId).toBe('target_1');
    expect(persistedTrigger?.payload).toMatchObject({
      sourceId: 'target_1',
      permanentId: 'target_1',
      sourceName: 'Gemrazer',
      description: 'destroy target artifact or enchantment.',
      triggerType: 'triggered_ability',
      mandatory: true,
      requiresTarget: true,
      targetType: 'artifact',
      needsTargetSelection: true,
    });

    const replayGame = createInitialGameState(`${persistentGameId}_trigger_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    replayGame.applyEvent({ type: 'join', playerId: opponentId, name: 'P2' } as any);
    (replayGame.state as any).battlefield = [
      {
        id: 'target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'target_card_1',
          name: 'Migratory Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'artifact_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        card: {
          id: 'artifact_card_1',
          name: 'Opponent Relic',
          type_line: 'Artifact',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    replayGame.applyEvent({ type: 'mutatePermanent', ...(persistedMutate.payload || {}) } as any);
    expect((replayGame.state as any).stack || []).toHaveLength(0);

    replayGame.applyEvent({ type: 'pushTriggeredAbility', ...(persistedTrigger.payload || {}) } as any);
    expect((replayGame.state as any).stack || []).toHaveLength(1);
    expect((replayGame.state as any).stack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'target_1',
      sourceName: 'Gemrazer',
      description: 'destroy target artifact or enchantment.',
      requiresTarget: true,
      targetType: 'artifact',
    });
  });

  it('replays mutate from castSpell plus resolveTopOfStack event stream', () => {
    const game = createInitialGameState('t_mutate_replay_stream');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'mutate_card_1',
            name: 'Gemrazer',
            type_line: 'Creature - Beast',
            oracle_text: 'Mutate {1}{G}{G}\nReach\nTrample',
            zone: 'hand',
            power: '4',
            toughness: '4',
            isMutating: true,
            mutateTarget: 'target_1',
            mutateOnTop: true,
            alternateCostId: 'mutate',
          },
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'target_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'target_card_1',
          name: 'Migratory Greathorn Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];

    game.applyEvent({
      type: 'castSpell',
      playerId: p1,
      card: {
        id: 'mutate_card_1',
        name: 'Gemrazer',
        type_line: 'Creature - Beast',
        oracle_text: 'Mutate {1}{G}{G}\nReach\nTrample',
        zone: 'hand',
        power: '4',
        toughness: '4',
        isMutating: true,
        mutateTarget: 'target_1',
        mutateOnTop: true,
        alternateCostId: 'mutate',
      },
      cardId: 'mutate_card_1',
      targets: ['target_1'],
      alternateCostId: 'mutate',
      fromZone: 'hand',
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const mergedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'target_1');
    expect(((game.state as any).battlefield || []).length).toBe(1);
    expect(mergedPermanent?.card?.name).toBe('Gemrazer');
    expect(mergedPermanent?.mutationCount).toBe(1);
    expect(mergedPermanent?.mutatedStack).toHaveLength(2);
    expect((game.state as any).stack || []).toHaveLength(0);
    expect(String(mergedPermanent?.card?.oracle_text || '')).toContain('Reach');
    expect(String(mergedPermanent?.card?.oracle_text || '')).toContain('Vigilance');
  });
});