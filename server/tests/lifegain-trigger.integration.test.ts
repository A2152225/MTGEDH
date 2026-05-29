import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: { playerId: string; spectator?: boolean; gameId?: string },
  emitted: Array<{ room?: string; event: string; payload: any }>,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('lifegain triggers (integration)', () => {
  const gameId = 'test_lifegain_trigger_ajani';
  const ratchetGameId = 'test_lifegain_trigger_ratchet';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(ratchetGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(ratchetGameId);
  });

  it('queues ordinary lifegain triggers on the stack and resolves named self counters', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'ajani_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'ajani_card',
          name: "Ajani's Pridemate",
          type_line: 'Creature - Cat Soldier',
          oracle_text: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers.adjustLife({ gameId, delta: 3, targetPlayerId: p1 });

    expect((game.state.life as any)[p1]).toBe(43);
    expect((game.state as any).lifeGainedThisTurn?.[p1]).toBe(3);
    expect((game.state as any).pendingTriggers).toBeUndefined();

    const lifegainStackItems = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'ajani_perm');
    expect(lifegainStackItems).toHaveLength(1);
    expect(lifegainStackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'lifegain',
      sourceName: "Ajani's Pridemate",
      triggeringPlayer: p1,
      effect: "put a +1/+1 counter on ajani's pridemate",
    }));
    expect(lifegainStackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'ajani_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: "Ajani's Pridemate",
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === "Ajani's Pridemate"
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'ajani_perm',
      controller: p1,
      owner: p1,
    }));

    game.resolveTopOfStack();

    const ajani = (((game.state as any).battlefield || []) as any[]).find((perm: any) => perm?.id === 'ajani_perm');
    expect(ajani?.counters?.['+1/+1']).toBe(1);
  });

  it('resolves Ratchet convert reflexive into a tapped graveyard artifact return', async () => {
    const gameId = ratchetGameId;
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const ratchetFrontOracle = 'More Than Meets the Eye {1}{W} (You may cast this card converted for {1}{W}.)\nLifelink\nWhenever you gain life, you may convert Ratchet. When you do, return target artifact card with mana value less than or equal to the amount of life you gained this turn from your graveyard to the battlefield tapped.';
    const ratchetBackOracle = 'Living metal (During your turn, this Vehicle is also a creature.)\nLifelink\nWhenever one or more nontoken artifacts you control are put into a graveyard from the battlefield, convert Ratchet. This ability triggers only once each turn.';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'mind_stone_card',
            name: 'Mind Stone',
            type_line: 'Artifact',
            mana_cost: '{2}',
            cmc: 2,
            zone: 'graveyard',
          },
          {
            id: 'hedron_archive_card',
            name: 'Hedron Archive',
            type_line: 'Artifact',
            mana_cost: '{4}',
            cmc: 4,
            zone: 'graveyard',
          },
          {
            id: 'watchwolf_card',
            name: 'Watchwolf',
            type_line: 'Creature',
            mana_cost: '{G}{W}',
            cmc: 2,
            zone: 'graveyard',
          },
        ],
        graveyardCount: 3,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'ratchet_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        transformed: false,
        card: {
          id: 'ratchet_card',
          name: 'Ratchet, Field Medic',
          layout: 'transform',
          type_line: 'Legendary Artifact Creature - Robot',
          oracle_text: ratchetFrontOracle,
          power: '2',
          toughness: '4',
          cmc: 3,
          zone: 'battlefield',
          card_faces: [
            {
              name: 'Ratchet, Field Medic',
              type_line: 'Legendary Artifact Creature - Robot',
              oracle_text: ratchetFrontOracle,
              power: '2',
              toughness: '4',
            },
            {
              name: 'Ratchet, Rescue Racer',
              type_line: 'Legendary Artifact - Vehicle',
              oracle_text: ratchetBackOracle,
              power: '1',
              toughness: '4',
            },
          ],
        },
      },
    ];
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);
    registerGameActions(io, socket as any);
    registerResolutionHandlers(io, socket as any);

    await handlers.adjustLife({ gameId, delta: 3, targetPlayerId: p1 });

    const lifegainStackItem = (((game.state as any).stack || []) as any[]).find((item: any) => item?.source === 'ratchet_perm');
    expect(lifegainStackItem).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'lifegain',
      sourceName: 'Ratchet, Field Medic',
      mandatory: false,
      effect: expect.stringContaining('when you do, return target artifact card with mana value less than or equal to the amount of life you gained this turn'),
    }));
    expect(lifegainStackItem?.requiresTarget).toBeUndefined();
    expect(lifegainStackItem?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'ratchet_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: 'Ratchet, Field Medic',
      }),
    }));

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const convertStep = queue.steps.find((step: any) => step?.reflexiveConvertWhenYouDo === true) as any;
    expect(convertStep).toEqual(expect.objectContaining({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      sourceId: 'ratchet_perm',
      reflexiveConvertWhenYouDoSourcePermanentId: 'ratchet_perm',
    }));
    expect(convertStep.options.map((option: any) => option.id)).toEqual(['convert', 'decline']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: convertStep.id,
      selections: ['convert'],
    });

    const ratchet = (((game.state as any).battlefield || []) as any[]).find((perm: any) => perm?.id === 'ratchet_perm');
    expect(ratchet?.transformed).toBe(true);
    expect(ratchet?.card?.name).toBe('Ratchet, Rescue Racer');

    const followupStackItem = (((game.state as any).stack || []) as any[]).find((item: any) => item?.triggerType === 'reflexive_convert');
    expect(followupStackItem).toEqual(expect.objectContaining({
      source: 'ratchet_perm',
      sourceName: 'Ratchet, Field Medic',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      targetGraveyardScope: 'your',
      targetFilterTypes: ['artifact'],
      targetFilterMaxManaValue: 3,
      battlefieldTapped: true,
    }));

    const convertEvent = getEvents(gameId).find((event: any) => event.type === 'reflexiveConvertResolve') as any;
    expect(convertEvent?.payload).toMatchObject({
      sourceId: 'ratchet_perm',
      converted: true,
      faceIndex: 1,
    });
    const followupEvent = getEvents(gameId).find((event: any) =>
      event.type === 'pushTriggeredAbility' && event.payload?.triggerType === 'reflexive_convert'
    ) as any;
    expect(followupEvent?.payload).toMatchObject({
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      targetFilterTypes: ['artifact'],
      targetFilterMaxManaValue: 3,
      battlefieldTapped: true,
    });

    game.resolveTopOfStack();

    queue = ResolutionQueueManager.getQueue(gameId);
    const graveyardStep = queue.steps.find((step: any) => step?.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(graveyardStep).toEqual(expect.objectContaining({
      triggeredAbilityGraveyardSelection: true,
      targetPlayerId: p1,
      destination: 'battlefield',
      battlefieldTapped: true,
    }));
    expect(graveyardStep.validTargets.map((target: any) => target.id)).toEqual(['mind_stone_card']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: graveyardStep.id,
      selections: ['mind_stone_card'],
    });

    const playerZones = (game.state as any).zones?.[p1];
    expect((playerZones?.graveyard || []).map((card: any) => card.id)).toEqual(['hedron_archive_card', 'watchwolf_card']);
    const returnedArtifact = (((game.state as any).battlefield || []) as any[]).find((perm: any) => perm?.card?.id === 'mind_stone_card');
    expect(returnedArtifact).toEqual(expect.objectContaining({
      controller: p1,
      owner: p1,
      tapped: true,
    }));
  });
});