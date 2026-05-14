import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Moira and Teshar (integration)', () => {
  const gameId = 'test_moira_and_teshar_integration';

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

  it('reanimates only nonland permanents from your graveyard and applies the haste plus exile riders', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'main1';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'historic_spell_1',
            name: 'Ornithopter',
            mana_cost: '{0}',
            manaCost: '{0}',
            type_line: 'Artifact Creature - Thopter',
            oracle_text: 'Flying',
            power: '0',
            toughness: '2',
          },
        ],
        handCount: 1,
        graveyard: [
          {
            id: 'gy_creature_1',
            name: 'Glory Seeker',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            mana_cost: '{1}{W}',
            power: '2',
            toughness: '2',
            zone: 'graveyard',
          },
          {
            id: 'gy_land_1',
            name: 'Plains',
            type_line: 'Basic Land - Plains',
            oracle_text: '({T}: Add {W}.)',
            zone: 'graveyard',
          },
          {
            id: 'gy_spell_1',
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            mana_cost: '{R}',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 3,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'moira_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 5,
        card: {
          id: 'moira_card_1',
          name: 'Moira and Teshar',
          type_line: 'Legendary Creature - Phyrexian Spirit Bird',
          oracle_text: 'Flying\nWhenever you cast a historic spell, return target nonland permanent card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.',
          power: '4',
          toughness: '5',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'historic_spell_1',
      targets: [],
    });

    const moiraTrigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && String(item?.sourceName || '') === 'Moira and Teshar'
    );
    expect(moiraTrigger).toBeDefined();

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const graveyardStep = queue.steps[0] as any;
    expect(graveyardStep.type).toBe('graveyard_selection');
    expect(graveyardStep.destination).toBe('battlefield');
    expect(graveyardStep.validTargets.map((target: any) => String(target.id))).toEqual(['gy_creature_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(graveyardStep.id),
      selections: ['gy_creature_1'],
      cancelled: false,
    });

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['gy_land_1', 'gy_spell_1']);

    const confirmEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload?.selectedCardIds).toEqual(['gy_creature_1']);
    const createdPermanentId = String(confirmEvent?.payload?.createdPermanentIds?.[0] || '');
    expect(createdPermanentId).not.toBe('');

    const reanimatedPermanent = ((game.state as any).battlefield || []).find(
      (permanent: any) => String(permanent?.id || '') === createdPermanentId
    );
    expect(reanimatedPermanent).toBeDefined();
    expect(String(reanimatedPermanent?.card?.id || '')).toBe('gy_creature_1');
    expect((reanimatedPermanent?.grantedAbilities || []).map((ability: any) => String(ability || '').toLowerCase())).toContain('haste');
    expect(Boolean(reanimatedPermanent?.summoningSickness)).toBe(false);
    expect(String(reanimatedPermanent?.leaveBattlefieldReplacementDestination || '')).toBe('exile');
    expect(String(reanimatedPermanent?.card?.leaveBattlefieldReplacementDestination || '')).toBe('exile');
    expect(((game.state as any).pendingExileAtNextEndStep || []) as any[]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        permanentId: createdPermanentId,
        sourceName: 'Moira and Teshar',
        createdBy: playerId,
      }),
    ]));

    expect(movePermanentToHand(game as any, createdPermanentId)).toBe(true);
    expect((((game.state as any).battlefield || []) as any[]).some((permanent: any) => String(permanent?.id || '') === createdPermanentId)).toBe(false);
    expect((zones?.hand || []).map((card: any) => String(card?.id || ''))).not.toContain('gy_creature_1');
    expect((zones?.exile || []).map((card: any) => String(card?.id || ''))).toContain('gy_creature_1');
  });
});