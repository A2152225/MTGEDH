import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

function seedGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  const library = [
    {
      id: 'forest_lib_1',
      name: 'Forest',
      type_line: 'Basic Land - Forest',
      oracle_text: '',
      zone: 'library',
    },
    {
      id: 'mountain_lib_1',
      name: 'Mountain',
      type_line: 'Basic Land - Mountain',
      oracle_text: '',
      zone: 'library',
    },
    {
      id: 'spell_lib_1',
      name: 'Cult Insight',
      type_line: 'Sorcery',
      oracle_text: '',
      zone: 'library',
    },
  ];

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  game.importDeckResolved(playerId as any, library as any);
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: library.length,
      graveyard: [
        {
          id: 'grave_tutor_1',
          name: 'Buried Pathways',
          type_line: 'Sorcery',
          oracle_text: 'Search your library for a basic land card, put that card into your hand, then shuffle.',
          zone: 'graveyard',
        },
      ],
      graveyardCount: 1,
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).zones[playerId].libraryCount = library.length;

  return { game, playerId };
}

describe('graveyard tutor library-search replay semantics (integration)', () => {
  const gameId = 'test_graveyard_tutor_library_search_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('persists and replays the resolved library search for a graveyard tutor activation', async () => {
    const { game, playerId } = seedGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'grave_tutor_1',
      abilityId: 'graveyard-activated',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    const searchStep = steps.find(step => step.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeDefined();
    expect(searchStep.sourceId).toBe('grave_tutor_1');
    expect(searchStep.persistLibrarySearchResolve).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(searchStep.id),
      selections: ['forest_lib_1'],
    });

    const events = getEvents(gameId);
    const resolvedEvent = [...events].reverse().find(event => event.type === 'librarySearchResolve');
    expect(resolvedEvent).toBeDefined();
    expect((((resolvedEvent as any).payload?.selectedCardIds) || [])).toEqual(['forest_lib_1']);
    expect(((((resolvedEvent as any).payload?.libraryAfter) || []) as any[]).map(card => card.id)).not.toContain('forest_lib_1');

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.hand || []).map((card: any) => card.id)).toEqual(['forest_lib_1']);
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).toEqual(['grave_tutor_1']);

    const replayGameId = `${gameId}_replay`;
    const { game: replayGame } = seedGame(replayGameId);
    replayGame.applyEvent({
      type: 'librarySearchResolve',
      ...((resolvedEvent as any).payload || {}),
    });

    const replayZones = (replayGame.state as any).zones?.[playerId];
    expect((replayZones?.hand || []).map((card: any) => card.id)).toEqual(['forest_lib_1']);
    expect((replayZones?.graveyard || []).map((card: any) => card.id)).toEqual(['grave_tutor_1']);
    expect(((replayGame as any).libraries?.get?.(playerId) || []).map((card: any) => card.id)).toEqual(
      (((resolvedEvent as any).payload?.libraryAfter) || []).map((card: any) => card.id),
    );
  });

  it('replays unresolved graveyard tutor activation by rebuilding the pending library search step and mana spend', () => {
    const replayGameId = `${gameId}_pending`;
    const { game, playerId } = seedGame(replayGameId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'grave_tutor_1',
      abilityId: 'graveyard-activated',
      isTutor: true,
      manaCost: '{3}',
      searchCriteria: 'basic land card',
      destination: 'hand',
      maxSelections: 1,
      splitDestination: false,
      toBattlefield: 1,
      toHand: 1,
      entersTapped: false,
      filter: { supertypes: ['basic'], types: ['land'] },
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['grave_tutor_1']);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const steps = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId);
    const searchStep = steps.find(step => step.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeDefined();
    expect(searchStep.sourceId).toBe('grave_tutor_1');
    expect(searchStep.searchCriteria).toBe('basic land card');
    expect((searchStep.availableCards || []).some((card: any) => card.id === 'forest_lib_1')).toBe(true);
  });
});