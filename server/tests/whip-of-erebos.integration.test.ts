import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';

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
    sockets: {
      sockets: new Map(),
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Whip of Erebos (integration)', () => {
  const gameId = 'test_whip_of_erebos_integration';

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

  it('returns the target with haste, schedules delayed exile, and exiles it if it leaves early', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 5;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'whip_target_1',
            name: 'Grizzly Bears',
            type_line: 'Creature - Bear',
            oracle_text: '',
            mana_cost: '{1}{G}',
            power: '2',
            toughness: '2',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'whip_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'whip_card_1',
          name: 'Whip of Erebos',
          type_line: 'Legendary Enchantment Artifact',
          oracle_text: "Creatures you control have lifelink.\n{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else. Activate only as a sorcery.",
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'whip_1',
      abilityId: 'whip_1-ability-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true);
    expect(targetStep).toBeDefined();
    expect(((targetStep as any).validTargets || []).map((target: any) => String(target?.id || ''))).toEqual(['whip_target_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['whip_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('return target creature card from your graveyard to the battlefield');

    game.resolveTopOfStack();

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual([]);
    expect(zones?.graveyardCount).toBe(0);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'whip_target_1'
    );
    expect(returnedPermanent).toBeTruthy();
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSickness: false,
    });
    expect(String(returnedPermanent?.card?.zone || '')).toBe('battlefield');
    expect((returnedPermanent?.grantedAbilities || []).map((ability: any) => String(ability || '').toLowerCase())).toContain('haste');
    expect(String(returnedPermanent?.leaveBattlefieldReplacementDestination || '')).toBe('exile');
    expect(String(returnedPermanent?.card?.leaveBattlefieldReplacementDestination || '')).toBe('exile');

    expect(((game.state as any).pendingExileAtNextEndStep || []) as any[]).toEqual(expect.arrayContaining([
      {
        permanentId: String(returnedPermanent?.id || ''),
        fireAtTurnNumber: 5,
        sourceName: 'Whip of Erebos',
        createdBy: playerId,
      },
    ]));
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    expect(movePermanentToHand(game as any, String(returnedPermanent?.id || ''))).toBe(true);
    expect(((game.state as any).battlefield || []).find((perm: any) => String(perm?.id || '') === String(returnedPermanent?.id || ''))).toBeUndefined();
    expect(zones?.handCount).toBe(0);
    expect((zones?.hand || []).map((card: any) => String(card?.id || ''))).toEqual([]);
    expect((zones?.exile || []).map((card: any) => String(card?.id || ''))).toContain('whip_target_1');
  });
});