import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

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

async function setupBaseGame(gameId: string, playerId = 'p1', opponentId = 'p2') {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };

  return game;
}

function seedRequestCastSacrificeState(game: any, playerId: string, opponentId: string) {
  (game.state as any).battlefield = [
    {
      id: 'bear_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSickness: false,
      card: {
        id: 'bear_card_1',
        name: 'Runeclaw Bear',
        type_line: 'Creature - Bear',
        oracle_text: '',
        image_uris: { small: 'https://example.com/bear.jpg' },
      },
    },
  ];

  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      exile: [
        {
          id: 'sac_spell_1',
          name: 'Offering to Ashes',
          mana_cost: '{0}',
          manaCost: '{0}',
          type_line: 'Sorcery',
          oracle_text: 'As an additional cost to cast this spell, sacrifice a creature. Draw two cards.',
          image_uris: { small: 'https://example.com/sac-spell.jpg' },
          zone: 'exile',
          canBePlayedBy: playerId,
          playableUntilTurn: 1,
        },
      ],
      exileCount: 1,
      graveyard: [],
      graveyardCount: 0,
      library: [],
      libraryCount: 0,
    },
    [opponentId]: {
      hand: [],
      handCount: 0,
      exile: [],
      exileCount: 0,
      graveyard: [],
      graveyardCount: 0,
      library: [],
      libraryCount: 0,
    },
  };
}

describe('requestCastSpell sacrifice additional cost (integration)', () => {
  const gameId = 'test_request_cast_additional_cost_sacrifice';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues the sacrifice prompt for exile casts and resumes the cast after the sacrifice resolves', async () => {
    const playerId = 'p1';
    const opponentId = 'p2';
    const game = await setupBaseGame(gameId, playerId, opponentId);
    seedRequestCastSacrificeState(game, playerId, opponentId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.requestCastSpell({ gameId, cardId: 'sac_spell_1', fromZone: 'exile' });

    const sacrificeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'additional_cost_payment') as any;
    expect(sacrificeStep).toBeDefined();
    expect(sacrificeStep?.costType).toBe('sacrifice');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(sacrificeStep.id),
      selections: ['bear_1'],
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && (step as any)?.spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
    });

    const errorEvents = emitted.filter((event) => event.event === 'error');
    expect(errorEvents).toEqual([]);

    const battlefieldIds = ((game.state as any).battlefield || []).map((permanent: any) => permanent.id);
    expect(battlefieldIds).not.toContain('bear_1');

    const graveyardIds = (((game.state as any).zones?.[playerId]?.graveyard) || []).map((card: any) => card.id || card.name);
    expect(graveyardIds).toContain('bear_card_1');

    const exileIds = (((game.state as any).zones?.[playerId]?.exile) || []).map((card: any) => card.id);
    expect(exileIds).not.toContain('sac_spell_1');

    const stack = (game.state as any).stack || [];
    const spellOnStack = stack.find((item: any) => String(item?.card?.id || '') === 'sac_spell_1');
    expect(spellOnStack).toBeDefined();
    expect(spellOnStack?.castFromExile).toBe(true);
  });
});