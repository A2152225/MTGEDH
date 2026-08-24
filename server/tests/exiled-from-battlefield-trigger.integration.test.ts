import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToExile, movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resolveCommanderChoice(gameId: string, playerId: string, selection: 'command' | 'stay') {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const step = queue.steps.find((entry: any) => entry?.type === 'option_choice' && entry?.commanderZoneChoice === true) as any;
  expect(step).toBeDefined();

  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const { socket, handlers } = createMockSocket(playerId, emitted);
  socket.rooms.add(gameId);
  const io = createMockIo(emitted, [socket]);
  registerResolutionHandlers(io as any, socket as any);

  await handlers['submitResolutionResponse']({
    gameId,
    stepId: String(step.id || ''),
    selections: [selection],
    cancelled: false,
  });
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('exiled-from-battlefield triggers (integration)', () => {
  const gameId = 'test_exiled_from_battlefield_trigger_soulherder';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues Soulherder-style triggers with exiled permanent context', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).isReplaying = false;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'soulherder_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'soulherder_card',
          name: 'Soulherder',
          type_line: 'Creature - Spirit',
          oracle_text: "Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.\nAt the beginning of your end step, you may exile another target creature you control, then return that card to the battlefield under its owner's control.",
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
      {
        id: 'bear_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'bear_card',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    movePermanentToExile(game as any, 'bear_perm');

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['soulherder_perm']);
    expect(((game.state as any).zones?.[p2]?.exile || []).map((card: any) => card.id)).toEqual(['bear_card']);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'creature_exiled_from_battlefield',
      sourceName: 'Soulherder',
      triggeringPermanent: 'bear_perm',
      // Oracle sentence terminator is kept (CR 603.2 extracted effect clause).
      effect: 'put a +1/+1 counter on this creature.',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      exiledPermanentId: 'bear_perm',
      exiledPermanentName: 'Runeclaw Bear',
      exiledPermanentController: p2,
      exiledPermanentOwner: p2,
      exiledPermanentTypeLine: 'Creature - Bear',
      fromZone: 'battlefield',
      toZone: 'exile',
    }));
    expect(stackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'soulherder_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: 'Soulherder',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Soulherder'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'soulherder_perm',
      controller: p1,
      owner: p1,
    }));

    game.resolveTopOfStack();

    const soulherder = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === 'soulherder_perm');
    expect(soulherder?.counters?.['+1/+1']).toBe(1);
  });

  it('does not rediscover live exiled-from-battlefield triggers while replaying', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).isReplaying = true;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'soulherder_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'soulherder_card',
          name: 'Soulherder',
          type_line: 'Creature - Spirit',
          oracle_text: 'Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.',
        },
      },
      {
        id: 'bear_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'bear_card',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).stack = [];

    movePermanentToExile(game as any, 'bear_perm');

    expect((game.state as any).stack).toEqual([]);
    expect(getEvents(gameId).filter((event: any) => event?.type === 'pushTriggeredAbility')).toEqual([]);
  });

  it('queues when a leave-battlefield replacement exiles a permanent instead', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).isReplaying = false;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'soulherder_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'soulherder_card',
          name: 'Soulherder',
          type_line: 'Creature - Spirit',
          oracle_text: 'Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.',
        },
      },
      {
        id: 'replacement_bear_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        leaveBattlefieldReplacementDestination: 'exile',
        leaveBattlefieldReplacementSourceName: 'Test Replacement',
        card: {
          id: 'replacement_bear_card',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).stack = [];

    movePermanentToGraveyard(game as any, 'replacement_bear_perm');

    expect(((game.state as any).zones?.[p2]?.exile || []).map((card: any) => card.id)).toEqual(['replacement_bear_card']);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'creature_exiled_from_battlefield',
      sourceName: 'Soulherder',
      triggeringPermanent: 'replacement_bear_perm',
      // Oracle sentence terminator is kept (CR 603.2 extracted effect clause).
      effect: 'put a +1/+1 counter on this creature.',
    }));
  });

  it('queues when a commander replacement choice lets the commander stay in exile', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).isReplaying = false;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0, commandZone: [], commandZoneCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0, commandZone: [], commandZoneCount: 0 },
    };
    (game.state as any).commandZone = {
      [p2]: {
        commanderIds: ['commander_bear_card'],
        inCommandZone: [],
      },
    };
    (game as any).commandZone = (game.state as any).commandZone;
    (game.state as any).battlefield = [
      {
        id: 'soulherder_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'soulherder_card',
          name: 'Soulherder',
          type_line: 'Creature - Spirit',
          oracle_text: 'Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.',
        },
      },
      {
        id: 'commander_bear_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        isCommander: true,
        leaveBattlefieldReplacementDestination: 'exile',
        card: {
          id: 'commander_bear_card',
          name: 'Runeclaw Commander',
          type_line: 'Legendary Creature - Bear',
          oracle_text: '',
          isCommander: true,
        },
      },
    ];
    (game.state as any).stack = [];

    movePermanentToGraveyard(game as any, 'commander_bear_perm');
    expect(((game.state as any).stack || [])).toEqual([]);

    await resolveCommanderChoice(gameId, p2, 'stay');

    expect(((game.state as any).zones?.[p2]?.exile || []).map((card: any) => card.id)).toEqual(['commander_bear_card']);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'creature_exiled_from_battlefield',
      sourceName: 'Soulherder',
      triggeringPermanent: 'commander_bear_perm',
      // Oracle sentence terminator is kept (CR 603.2 extracted effect clause).
      effect: 'put a +1/+1 counter on this creature.',
    }));
  });
});