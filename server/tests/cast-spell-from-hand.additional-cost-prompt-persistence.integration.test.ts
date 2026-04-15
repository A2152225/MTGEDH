import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

async function setupBaseGame(testGameId: string, playerId = 'p1', opponentId = 'p2') {
  await resetGame(testGameId);
  createGameIfNotExists(testGameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(testGameId);
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
  return game;
}

describe('castSpellFromHand additional-cost prompt persistence (integration)', () => {
  const gameId = 'test_cast_spell_from_hand_additional_cost_prompt_persistence';
  const playerId = 'p1';
  const opponentId = 'p2';
  const derivedGameIds = [
    `${gameId}_life`,
    `${gameId}_bargain`,
    `${gameId}_evidence`,
    `${gameId}_discard`,
    `${gameId}_sacrifice`,
    `${gameId}_squad`,
  ];

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    for (const derivedGameId of derivedGameIds) {
      await resetGame(derivedGameId);
    }
  });

  it('persists direct life-payment prompts', async () => {
    const testGameId = `${gameId}_life`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'toxic_deluge_1', name: 'Toxic Deluge', mana_cost: '{2}{B}', type_line: 'Sorcery', oracle_text: 'All creatures get -X/-X until end of turn.', image_uris: { small: 'https://example.com/toxic-deluge.jpg' } },
        ],
        handCount: 1,
        exile: [], exileCount: 0, graveyard: [], graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'toxic_deluge_1' });

    const step = ResolutionQueueManager.getQueue(testGameId).steps.find((entry: any) => entry.type === 'life_payment') as any;
    expect(step?.cardId).toBe('toxic_deluge_1');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('life_payment');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.cardId).toBe('toxic_deluge_1');
  });

  it('persists direct bargain prompts', async () => {
    const testGameId = `${gameId}_bargain`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'treasure_1',
        controller: playerId,
        owner: playerId,
        isToken: true,
        tapped: false,
        card: { name: 'Treasure', type_line: 'Token Artifact - Treasure', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'bargain_spell_1', name: 'Bargain Spell', mana_cost: '{2}{U}', type_line: 'Sorcery', oracle_text: 'Bargain\nDraw two cards.', image_uris: { small: 'https://example.com/bargain.jpg' } },
        ],
        handCount: 1,
        exile: [], exileCount: 0, graveyard: [], graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'bargain_spell_1' });

    const step = ResolutionQueueManager.getQueue(testGameId).steps.find((entry: any) => entry.type === 'additional_cost_payment') as any;
    expect(step?.additionalCostKeyword).toBe('bargain');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('additional_cost_payment');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.additionalCostKeyword).toBe('bargain');
  });

  it('persists direct collect-evidence prompts', async () => {
    const testGameId = `${gameId}_evidence`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'evidence_spell_1', name: 'Evidence Spell', mana_cost: '{1}{U}', type_line: 'Sorcery', oracle_text: 'As an additional cost to cast this spell, collect evidence 3. Draw two cards.', image_uris: { small: 'https://example.com/evidence.jpg' } },
        ],
        handCount: 1,
        graveyard: [
          { id: 'grave_1', name: 'Opt', mana_cost: '{U}', type_line: 'Instant', image_uris: { small: 'https://example.com/opt.jpg' } },
        ],
        graveyardCount: 1,
        exile: [], exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'evidence_spell_1' });

    const step = ResolutionQueueManager.getQueue(testGameId).steps.find((entry: any) => entry.type === 'graveyard_selection') as any;
    expect(step?.purpose).toBe('collectEvidence');
    expect(step?.collectEvidenceMinManaValue).toBe(3);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('graveyard_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.purpose).toBe('collectEvidence');
  });

  it('persists direct discard-cost prompts', async () => {
    const testGameId = `${gameId}_discard`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'discard_spell_1', name: 'Discard Spell', mana_cost: '{1}{R}', type_line: 'Sorcery', oracle_text: 'As an additional cost to cast this spell, discard a card. Draw two cards.', image_uris: { small: 'https://example.com/discard.jpg' } },
          { id: 'other_card_1', name: 'Spare Card', mana_cost: '{1}', type_line: 'Instant', oracle_text: '', image_uris: { small: 'https://example.com/spare.jpg' } },
        ],
        handCount: 2,
        graveyard: [], graveyardCount: 0,
        exile: [], exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'discard_spell_1' });

    const step = ResolutionQueueManager.getQueue(testGameId).steps.find((entry: any) => entry.type === 'additional_cost_payment') as any;
    expect(step?.costType).toBe('discard');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('additional_cost_payment');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.costType).toBe('discard');
  });

  it('persists direct sacrifice-cost prompts', async () => {
    const testGameId = `${gameId}_sacrifice`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Elf Token', type_line: 'Creature - Elf', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'sac_spell_1', name: 'Sacrifice Spell', mana_cost: '{B}', type_line: 'Sorcery', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature. Draw two cards.', image_uris: { small: 'https://example.com/sac.jpg' } },
        ],
        handCount: 1,
        graveyard: [], graveyardCount: 0,
        exile: [], exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'sac_spell_1' });

    const step = ResolutionQueueManager.getQueue(testGameId).steps.find((entry: any) => entry.type === 'additional_cost_payment') as any;
    expect(step?.costType).toBe('sacrifice');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('additional_cost_payment');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.costType).toBe('sacrifice');
  });

  it('persists direct squad-cost prompts', async () => {
    const testGameId = `${gameId}_squad`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'squad_spell_1', name: 'Squad Spell', mana_cost: '{3}{W}', type_line: 'Creature - Soldier', oracle_text: 'Squad {2}', image_uris: { small: 'https://example.com/squad.jpg' }, colors: ['W'] },
        ],
        handCount: 1,
        graveyard: [], graveyardCount: 0,
        exile: [], exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'squad_spell_1' });

    const step = ResolutionQueueManager.getQueue(testGameId).steps.find((entry: any) => entry.type === 'squad_cost_payment') as any;
    expect(step?.cardId).toBe('squad_spell_1');
    expect(step?.squadCost).toBe('{2}');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('squad_cost_payment');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.cardId).toBe('squad_spell_1');
  });
});