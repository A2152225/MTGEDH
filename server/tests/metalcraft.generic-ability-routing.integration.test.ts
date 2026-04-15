import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
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

function createBaseGame(gameId: string, playerId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'precombat_main';
  (game.state as any).stack = [];

  return game;
}

describe('metalcraft generic battlefield activation routing (integration)', () => {
  const gameId = 'test_metalcraft_generic_activation';

  const fixedGameIds = [
    gameId,
    'test_ferocious_generic_activation',
    'test_threshold_generic_activation',
    'test_coven_generic_activation',
  ];

  async function resetGame(gameId: string) {
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const fixedGameId of fixedGameIds) {
      await resetGame(fixedGameId);
    }
  });

  afterEach(async () => {
    for (const fixedGameId of fixedGameIds) {
      await resetGame(fixedGameId);
    }
  });

  it('rejects generic activated abilities that require metalcraft before costs are paid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'argent_sphinx_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'argent_card_1',
          name: 'Argent Sphinx',
          type_line: 'Artifact Creature — Sphinx',
          oracle_text: 'Flying\nMetalcraft — {U}: Exile Argent Sphinx. Return it to the battlefield under your control at the beginning of the next end step.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'argent_sphinx_1',
      abilityId: 'argent_card_1-ability-0',
    });

    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent?.payload?.code).toBe('METALCRAFT_NOT_ACTIVE');
    expect(((game.state as any).stack || []).length).toBe(0);
    expect(Number((game.state as any).manaPool?.[playerId]?.blue || 0)).toBe(1);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'argent_sphinx_1')?.tapped).toBe(false);
  });

  it('rejects ferocious abilities that only expose the condition via the ability-word prefix', async () => {
    const localGameId = 'test_ferocious_generic_activation';
    const playerId = 'p1';
    const game = createBaseGame(localGameId, playerId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 1, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'ferocious_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'ferocious_card_1',
          name: 'Ferocious Test Card',
          type_line: 'Creature — Orc Shaman',
          power: '2',
          toughness: '2',
          oracle_text: 'Ferocious — {2}{G}{U}: Draw a card for each creature you control with power 4 or greater.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(localGameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: localGameId,
      permanentId: 'ferocious_1',
      abilityId: 'ferocious_card_1-ability-0',
    });

    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(((game.state as any).stack || []).length).toBe(0);
    expect(Number((game.state as any).manaPool?.[playerId]?.green || 0)).toBe(1);
    expect(Number((game.state as any).manaPool?.[playerId]?.blue || 0)).toBe(1);
  });

  it('rejects threshold abilities before tap or sacrifice costs are paid', async () => {
    const localGameId = 'test_threshold_generic_activation';
    const playerId = 'p1';
    const game = createBaseGame(localGameId, playerId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
    };
    (game.state as any).zones = { [playerId]: { graveyard: [] } };
    (game.state as any).battlefield = [
      {
        id: 'threshold_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'threshold_card_1',
          name: 'Threshold Test Druid',
          type_line: 'Creature — Human Druid',
          power: '3',
          toughness: '1',
          oracle_text: 'Threshold — {1}{G}: Regenerate this creature. Activate only if there are seven or more cards in your graveyard.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(localGameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: localGameId,
      permanentId: 'threshold_1',
      abilityId: 'threshold_card_1-ability-1',
    });

    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(((game.state as any).stack || []).length).toBe(0);
    expect(Number((game.state as any).manaPool?.[playerId]?.green || 0)).toBe(1);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'threshold_1')).toBeTruthy();
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'threshold_1')?.tapped).toBe(false);
  });

  it('rejects coven abilities before color choice or costs are consumed', async () => {
    const localGameId = 'test_coven_generic_activation';
    const playerId = 'p1';
    const game = createBaseGame(localGameId, playerId);
    (game.state as any).manaPool = {
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'coven_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'coven_card_1',
          name: 'Coven Test Soldier',
          type_line: 'Creature — Human Soldier',
          power: '3',
          toughness: '2',
          oracle_text: 'Coven — {1}{W}: Choose a color. This creature gains hexproof from that color until end of turn and can\'t be blocked by creatures of that color this turn. Activate only if you control three or more creatures with different powers.',
        },
      },
      {
        id: 'coven_ally_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'coven_ally_card_1',
          name: 'Same Power Ally A',
          type_line: 'Creature — Human',
          power: '2',
          toughness: '2',
          oracle_text: '',
        },
      },
      {
        id: 'coven_ally_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'coven_ally_card_2',
          name: 'Same Power Ally B',
          type_line: 'Creature — Human',
          power: '2',
          toughness: '2',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(localGameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: localGameId,
      permanentId: 'coven_1',
      abilityId: 'coven_card_1-ability-0',
    });

    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(((game.state as any).stack || []).length).toBe(0);
    expect(Number((game.state as any).manaPool?.[playerId]?.white || 0)).toBe(2);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'coven_1')?.tapped).toBe(false);
  });
});