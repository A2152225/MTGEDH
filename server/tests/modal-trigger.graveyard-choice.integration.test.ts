import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

import '../src/state/modules/priority.js';

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Triggered modal choice graveyard targeting (integration)', () => {
  const gameId = 'test_modal_trigger_graveyard_choice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('resumes choose-one graveyard-return trigger modes through MODAL_CHOICE into GRAVEYARD_SELECTION', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_creature_mv1',
            name: 'Careful Pup',
            type_line: 'Creature - Dog',
            mana_cost: '{W}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
          {
            id: 'gy_creature_mv2',
            name: 'Watchful Fox',
            type_line: 'Creature - Fox',
            mana_cost: '{1}{W}',
            power: '2',
            toughness: '1',
            zone: 'graveyard',
          },
          {
            id: 'gy_spell_1',
            name: 'Spent Spell',
            type_line: 'Instant',
            mana_cost: '{1}{U}',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 3,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).stack = [
      {
        id: 'modal_trigger_1',
        type: 'triggered_ability',
        controller: playerId,
        source: 'abiding_grace_1',
        sourceId: 'abiding_grace_1',
        sourceName: 'Abiding Grace',
        description: 'Choose one: You gain 1 life; or return target creature card with mana value 1 from your graveyard to the battlefield.',
        effect: 'Choose one: You gain 1 life; or return target creature card with mana value 1 from your graveyard to the battlefield.',
        triggerType: 'end_step',
        mandatory: true,
        requiresChoice: true,
        modalOptions: [
          'You gain 1 life',
          'Return target creature card with mana value 1 from your graveyard to the battlefield.',
        ],
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const modalStep = queue.steps[0] as any;
    expect(modalStep.type).toBe('modal_choice');
    expect(modalStep.options.map((option: any) => String(option.id))).toEqual(['option_1', 'option_2']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: modalStep.id,
      selections: ['option_2'],
    });

    const updatedQueue = ResolutionQueueManager.getQueue(gameId);
    expect(updatedQueue.steps).toHaveLength(1);
    const graveyardStep = updatedQueue.steps[0] as any;
    expect(graveyardStep.type).toBe('graveyard_selection');
    expect(graveyardStep.destination).toBe('battlefield');
    expect(graveyardStep.validTargets.map((target: any) => String(target.id))).toEqual(['gy_creature_mv1']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: graveyardStep.id,
      selections: ['gy_creature_mv1'],
    });

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'gy_creature_mv1')).toBe(false);

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    const createdPermanentId = String(persisted?.payload?.createdPermanentIds?.[0] || '');
    expect(createdPermanentId).not.toBe('');

    const battlefield = (((game.state as any).battlefield || []) as any[]);
    const reanimatedPermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === createdPermanentId);
    expect(reanimatedPermanent).toBeDefined();
    expect(String(reanimatedPermanent?.controller || '')).toBe(playerId);
    expect(String(reanimatedPermanent?.card?.id || '')).toBe('gy_creature_mv1');
  });

  it('uses source-power graveyard mana thresholds when a modal trigger option references the source name', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'power_reclaimer_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        counters: {},
        card: {
          id: 'power_reclaimer_card_1',
          name: 'Power Reclaimer',
          type_line: 'Creature - Spirit',
          oracle_text: 'Choose one: You gain 1 life; or return target creature card with mana value less than or equal to Power Reclaimer\'s power from your graveyard to the battlefield.',
          power: '3',
          toughness: '3',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_creature_mv3',
            name: 'Three-Drop Witness',
            type_line: 'Creature - Human',
            mana_cost: '{2}{G}',
            power: '3',
            toughness: '2',
            zone: 'graveyard',
          },
          {
            id: 'gy_creature_mv4',
            name: 'Four-Drop Giant',
            type_line: 'Creature - Giant',
            mana_cost: '{3}{G}',
            power: '4',
            toughness: '4',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).stack = [
      {
        id: 'modal_trigger_dynamic_1',
        type: 'triggered_ability',
        controller: playerId,
        source: 'power_reclaimer_1',
        sourceId: 'power_reclaimer_1',
        sourceName: 'Power Reclaimer',
        description: 'Choose one: You gain 1 life; or return target creature card with mana value less than or equal to Power Reclaimer\'s power from your graveyard to the battlefield.',
        effect: 'Choose one: You gain 1 life; or return target creature card with mana value less than or equal to Power Reclaimer\'s power from your graveyard to the battlefield.',
        triggerType: 'end_step',
        mandatory: true,
        requiresChoice: true,
        modalOptions: [
          'You gain 1 life',
          'Return target creature card with mana value less than or equal to Power Reclaimer\'s power from your graveyard to the battlefield.',
        ],
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const modalStep = queue.steps[0] as any;
    expect(modalStep.type).toBe('modal_choice');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: modalStep.id,
      selections: ['option_2'],
    });

    const graveyardStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(graveyardStep.type).toBe('graveyard_selection');
    expect(graveyardStep.destination).toBe('battlefield');
    expect(graveyardStep.validTargets.map((target: any) => String(target.id))).toEqual(['gy_creature_mv3']);
  });
});