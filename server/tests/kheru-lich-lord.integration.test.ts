import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Kheru Lich Lord (integration)', () => {
  const gameId = 'test_kheru_lich_lord_integration';

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

  it('pays for the upkeep trigger, returns a random creature card, and applies the reanimation riders', async () => {
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
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).turnNumber = 1;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).pendingExileAtNextEndStep = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_creature_1',
            name: 'Runeclaw Bear',
            type_line: 'Creature - Bear',
            mana_cost: '{1}{G}',
            power: '2',
            toughness: '2',
            zone: 'graveyard',
          },
          {
            id: 'gy_spell_1',
            name: 'Sign in Blood',
            type_line: 'Sorcery',
            mana_cost: '{B}{B}',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 2,
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
        id: 'kheru_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'kheru_card_1',
          name: 'Kheru Lich Lord',
          type_line: 'Creature - Zombie Wizard',
          oracle_text: 'At the beginning of your upkeep, you may pay {2}{B}. If you do, return a creature card at random from your graveyard to the battlefield. It gains flying, trample, and haste. Exile that card at the beginning of your next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.',
          power: '4',
          toughness: '4',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const upkeepTrigger = getUpkeepTriggersForPlayer(game as any, playerId).find(
      (trigger: any) => String(trigger?.cardName || '') === 'Kheru Lich Lord'
    );
    expect(upkeepTrigger).toBeDefined();

    (game.state as any).stack.push({
      id: 'kheru_trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'kheru_1',
      permanentId: 'kheru_1',
      sourceName: 'Kheru Lich Lord',
      description: String(upkeepTrigger?.effect || upkeepTrigger?.description || ''),
      effect: String(upkeepTrigger?.effect || upkeepTrigger?.description || ''),
      triggerType: 'upkeep',
      mandatory: false,
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const payStep = queue.steps.find((step: any) => (step as any)?.optionalPaymentPrompt === true) as any;
    expect(payStep).toBeDefined();
    expect(payStep.options.map((option: any) => String(option.id))).toEqual(['pay_mana', 'decline']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(payStep.id),
      selections: 'pay_mana',
    });

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const reanimatedPermanent = battlefield.find((permanent: any) => String(permanent?.card?.id || '') === 'gy_creature_1');
    expect(reanimatedPermanent).toBeDefined();
    expect(String(reanimatedPermanent?.controller || '')).toBe(playerId);
    expect((reanimatedPermanent?.grantedAbilities || []).map((ability: any) => String(ability || '').toLowerCase())).toEqual(expect.arrayContaining(['flying', 'trample', 'haste']));
    expect(Boolean(reanimatedPermanent?.summoningSickness)).toBe(false);
    expect(String(reanimatedPermanent?.leaveBattlefieldReplacementDestination || '')).toBe('exile');
    expect(String(reanimatedPermanent?.card?.leaveBattlefieldReplacementDestination || '')).toBe('exile');
    expect(((game.state as any).pendingExileAtNextEndStep || []) as any[]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        permanentId: String(reanimatedPermanent?.id || ''),
        sourceName: 'Kheru Lich Lord',
        createdBy: playerId,
      }),
    ]));

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['gy_spell_1']);

    expect(movePermanentToHand(game as any, String(reanimatedPermanent?.id || ''))).toBe(true);
    expect((playerZones?.hand || []).map((card: any) => String(card?.id || ''))).not.toContain('gy_creature_1');
    expect((playerZones?.exile || []).map((card: any) => String(card?.id || ''))).toContain('gy_creature_1');

    const confirmEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload?.selectedCardIds).toEqual(['gy_creature_1']);
  });
});