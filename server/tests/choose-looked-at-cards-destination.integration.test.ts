import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
  sockets: any[] = []
) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

function setUpGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const p1 = 'p1' as any;
  (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).zones = {
    [p1]: {
      library: [
        { id: 'top_1', name: 'Top One', type_line: 'Instant', zone: 'library' },
        { id: 'top_2', name: 'Top Two', type_line: 'Sorcery', zone: 'library' },
        { id: 'rest_1', name: 'Rest', type_line: 'Land', zone: 'library' },
      ],
      libraryCount: 3,
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
    },
  };

  return { game, p1 };
}

async function runChoice(gameId: string, p1: string, emitted: Array<{ room?: string; event: string; payload: any }>, step: any, selection: string) {
  const { socket, handlers } = createMockSocket(p1, emitted, gameId);
  const io = createMockIo(emitted, [socket]);
  registerResolutionHandlers(io as any, socket as any);
  await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: selection });
}

describe('choose looked-at cards destination (integration)', () => {
  const gameId = 'test_choose_looked_at_cards_destination';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('puts the chosen card into hand and the other on the bottom of the library', async () => {
    const { game, p1 } = setUpGame(gameId);
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Put one into your hand and the other on the bottom of your library.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'top_1', label: 'Top One' },
        { id: 'top_2', label: 'Top Two' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseLookedAtCardsDestinationChoice: true,
      chooseLookedAtCardsDestinationController: p1,
      chooseLookedAtCardsDestinationSourceName: 'Source',
      chooseLookedAtCardsDestinationTopCardIds: ['top_1', 'top_2'],
      chooseLookedAtCardsDestinationChosenZone: 'hand',
      chooseLookedAtCardsDestinationOtherZone: 'bottom_library',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    await runChoice(gameId, p1, emitted, step, 'top_2');

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['top_2']);
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toEqual(['rest_1', 'top_1']);
  });

  it('puts the chosen card into hand and the other into the graveyard', async () => {
    const { game, p1 } = setUpGame(gameId);
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Put one into your hand and the other into your graveyard.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'top_1', label: 'Top One' },
        { id: 'top_2', label: 'Top Two' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseLookedAtCardsDestinationChoice: true,
      chooseLookedAtCardsDestinationController: p1,
      chooseLookedAtCardsDestinationSourceName: 'Source',
      chooseLookedAtCardsDestinationTopCardIds: ['top_1', 'top_2'],
      chooseLookedAtCardsDestinationChosenZone: 'hand',
      chooseLookedAtCardsDestinationOtherZone: 'graveyard',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    await runChoice(gameId, p1, emitted, step, 'top_1');

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['top_1']);
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['top_2']);
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toEqual(['rest_1']);
  });

  it('puts the chosen card into the graveyard and leaves the other on top of the library', async () => {
    const { game, p1 } = setUpGame(gameId);
    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Put one into your graveyard.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'top_1', label: 'Top One' },
        { id: 'top_2', label: 'Top Two' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseLookedAtCardsDestinationChoice: true,
      chooseLookedAtCardsDestinationController: p1,
      chooseLookedAtCardsDestinationSourceName: 'Source',
      chooseLookedAtCardsDestinationTopCardIds: ['top_1', 'top_2'],
      chooseLookedAtCardsDestinationChosenZone: 'graveyard',
      chooseLookedAtCardsDestinationOtherZone: 'top_library',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    await runChoice(gameId, p1, emitted, step, 'top_2');

    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.id)).toEqual(['top_2']);
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toEqual(['top_1', 'rest_1']);
  });
});