import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('MDFC face OPTION_CHOICE validate-before-complete (integration)', () => {
  const gameId = 'test_mdfc_face_option_choice_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on invalid selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      cardId: 'mdfc_1',
      cardName: 'Test MDFC',
      fromZone: 'hand',
      mandatory: true,
      mdfcFaceChoice: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: '0', label: 'Face A' },
        { id: '1', label: 'Face B' },
      ],
      description: 'Choose a face',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).mdfcFaceChoice === true);
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['5'] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Valid selection should now complete.
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: ['0'] });
    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('plays the selected MDFC land face entirely server-side after the queue response', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40, isAI: false }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).landsPlayedThisTurn = { [p1]: 0 };
    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'mdfc_1',
            name: 'Riverglide Pathway // Lavaglide Pathway',
            layout: 'modal_dfc',
            type_line: 'Land',
            oracle_text: '',
            image_uris: { small: 'https://example.com/mdfc-card.jpg' },
            card_faces: [
              {
                name: 'Riverglide Pathway',
                type_line: 'Land',
                oracle_text: '{T}: Add {U}.',
                image_uris: { small: 'https://example.com/riverglide.jpg' },
              },
              {
                name: 'Lavaglide Pathway',
                type_line: 'Land',
                oracle_text: '{T}: Add {R}.',
                image_uris: { small: 'https://example.com/lavaglide.jpg' },
              },
            ],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'mdfc_1' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).mdfcFaceChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: ['1'] });

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((s: any) => (s as any).mdfcFaceChoice === true)).toBe(false);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.id).toBe('mdfc_1');
    expect(battlefield[0]?.card?.name).toBe('Lavaglide Pathway');
    expect(((game.state as any).zones?.[p1]?.hand || [])).toHaveLength(0);
    expect(Number((game.state as any).landsPlayedThisTurn?.[p1] || 0)).toBe(1);
    expect(emitted.some((entry) => entry.event === 'mdfcFaceSelectionComplete')).toBe(false);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});
