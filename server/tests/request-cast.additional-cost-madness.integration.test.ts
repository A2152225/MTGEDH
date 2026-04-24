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

function seedRequestCastMadnessState(game: any, playerId: string, opponentId: string) {
  (game.state as any).zones = {
    [playerId]: {
      hand: [
        {
          id: 'madness_card_1',
          name: 'Fiery Temper',
          mana_cost: '{1}{R}{R}',
          type_line: 'Instant',
          oracle_text: 'Madness {R}',
          image_uris: { small: 'https://example.com/fiery-temper.jpg' },
          zone: 'hand',
        },
      ],
      handCount: 1,
      exile: [
        {
          id: 'discard_spell_1',
          name: 'Hazardous Research',
          mana_cost: '{0}',
          manaCost: '{0}',
          type_line: 'Sorcery',
          oracle_text: 'As an additional cost to cast this spell, discard a card. Draw two cards.',
          image_uris: { small: 'https://example.com/discard-spell.jpg' },
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

describe('requestCastSpell discard additional cost with madness (integration)', () => {
  const gameId = 'test_request_cast_additional_cost_madness';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues the discard prompt for exile casts and preserves the madness follow-up after the spell is cast', async () => {
    const playerId = 'p1';
    const opponentId = 'p2';
    const game = await setupBaseGame(gameId, playerId, opponentId);
    seedRequestCastMadnessState(game, playerId, opponentId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.requestCastSpell({ gameId, cardId: 'discard_spell_1', fromZone: 'exile' });

    const discardStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'additional_cost_payment') as any;
    expect(discardStep).toBeDefined();
    expect(discardStep?.costType).toBe('discard');
    expect(discardStep?.castSpellFromHandArgs?.fromZone).toBe('exile');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(discardStep.id),
      selections: ['madness_card_1'],
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

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.exile || []).map((card: any) => card.id)).toContain('madness_card_1');
    expect((playerZones?.graveyard || []).map((card: any) => card.id)).not.toContain('madness_card_1');
    expect((playerZones?.exile || []).map((card: any) => card.id)).not.toContain('discard_spell_1');

    const stack = (game.state as any).stack || [];
    const spellOnStack = stack.find((item: any) => String(item?.card?.id || '') === 'discard_spell_1');
    expect(spellOnStack).toBeDefined();
    expect(spellOnStack?.castFromExile).toBe(true);

    const madnessPrompt = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_1') as any;
    expect(madnessPrompt).toBeDefined();
    expect(madnessPrompt?.madnessPrompt).toBe(true);
  });
});