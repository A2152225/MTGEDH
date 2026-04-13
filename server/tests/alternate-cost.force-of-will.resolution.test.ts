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

describe('Resolution FORCE alternate cost (Force of Will / Negation style)', () => {
  const gameId = 'test_resolution_force_alt_cost';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('exiles the chosen blue card, pays life, and resumes casting', async () => {
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'spell_1', name: 'Force of Will', type_line: 'Instant', colors: ['U'] },
          { id: 'blue_1', name: 'Ponder', type_line: 'Instant', colors: ['U'] },
          { id: 'red_1', name: 'Lightning Bolt', type_line: 'Instant', colors: ['R'] },
        ],
        handCount: 3,
        exile: [],
        exileCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Choose a blue card to exile',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Force of Will',
      forceOfWillExileChoice: true,
      forceSpellCardId: 'spell_1',
      forceSpellName: 'Force of Will',
      forceRequiresLifePayment: true,
      forceLifePaymentAmount: 1,
      forceCastArgs: {
        payment: {},
        targets: [],
        xValue: 0,
        alternateCostId: 'force_of_will',
      },
      options: [
        { id: 'blue_1', label: 'Ponder' },
        { id: 'red_1', label: 'Lightning Bolt' },
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['blue_1'] });

    const zones = (game.state as any).zones[p1];
    expect((zones.hand || []).map((c: any) => c.id)).toEqual(['red_1']);
    expect((zones.exile || []).map((c: any) => c.id)).toEqual(['blue_1']);
    expect(zones.exile[0].exiledForAlternateCost).toBe(true);
    expect(zones.exile[0].exiledForSpellCardId).toBe('spell_1');

    expect((game.state as any).life[p1]).toBe(39);
    expect(((game.state as any).players[0] as any).life).toBe(39);
    expect(emitted.some((event) => event.event === 'castSpellFromHandContinue')).toBe(false);
    expect(emitted.find((event) => event.event === 'error')).toBeUndefined();
    expect(Array.isArray((game.state as any).stack)).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect(String((game.state as any).stack[0]?.card?.name || '')).toBe('Force of Will');
  });

  it('rejects selecting a non-blue card (no state changes)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'spell_1', name: 'Force of Will', colors: ['U'] },
          { id: 'blue_1', name: 'Ponder', colors: ['U'] },
          { id: 'red_1', name: 'Lightning Bolt', colors: ['R'] },
        ],
        handCount: 3,
        exile: [],
        exileCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Choose a blue card to exile',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Force of Will',
      forceOfWillExileChoice: true,
      forceSpellCardId: 'spell_1',
      forceSpellName: 'Force of Will',
      forceRequiresLifePayment: true,
      forceLifePaymentAmount: 1,
      forceCastArgs: {
        payment: {},
        targets: [],
        xValue: 0,
        alternateCostId: 'force_of_will',
      },
      options: [
        { id: 'blue_1', label: 'Ponder' },
        { id: 'red_1', label: 'Lightning Bolt' },
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['red_1'] });

    const zones = (game.state as any).zones[p1];
    expect((zones.hand || []).map((c: any) => c.id)).toEqual(['spell_1', 'blue_1', 'red_1']);
    expect((zones.exile || []).length).toBe(0);
    expect((game.state as any).life[p1]).toBe(40);

    const errEvt = emitted.find(e => e.event === 'error');
    expect(errEvt).toBeDefined();
    expect(errEvt!.payload.code).toBe('CANNOT_PAY_COST');

    expect(emitted.some((event) => event.event === 'castSpellFromHandContinue')).toBe(false);
  });
});
