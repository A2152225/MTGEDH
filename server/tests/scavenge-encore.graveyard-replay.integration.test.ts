import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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

describe('scavenge and encore graveyard replay semantics (integration)', () => {
  const gameId = 'test_scavenge_encore_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('live scavenge moves the card from graveyard to exile', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'scavenge_card_1',
            name: 'Slitherhead',
            type_line: 'Creature - Plant Zombie',
            oracle_text: 'Scavenge {0}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'scavenge_card_1',
      abilityId: 'scavenge',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('scavenge_card_1');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 });
  });

  it('live encore exiles the card, creates one token per opponent, and enforces each token\'s required defender', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentA = 'p2';
    const opponentB = 'p3';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentA, name: 'P2', spectator: false, life: 40 },
      { id: opponentB, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'encore_card_1',
            name: 'Impetuous Devils',
            type_line: 'Creature - Devil',
            oracle_text: 'Encore {3}{R}{R}',
            power: '6',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'encore_card_1',
      abilityId: 'encore',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('encore_card_1');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(2);
    const targetIds = battlefield.map((perm: any) => perm.encoreAttackPlayerId).sort();
    expect(targetIds).toEqual([opponentA, opponentB]);
    expect(battlefield.every((perm: any) => perm.isToken)).toBe(true);
    expect(battlefield.every((perm: any) => perm.mustAttack)).toBe(true);
    expect(battlefield.every((perm: any) => perm.summoningSickness === false)).toBe(true);

    const delayed = (game.state as any).pendingSacrificeAtNextEndStep || [];
    expect(delayed).toHaveLength(2);
    expect(delayed.every((entry: any) => entry.createdBy === playerId)).toBe(true);

    (game.state as any).turnPlayer = playerId;
    (game.state as any).turn = 1;
    (game.state as any).step = 'declareAttackers';
    const tokenForOpponentA = battlefield.find((perm: any) => perm.encoreAttackPlayerId === opponentA);
    expect(tokenForOpponentA).toBeDefined();

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: tokenForOpponentA.id, targetPlayerId: opponentB }],
    });

    const attackError = emitted.filter((entry) => entry.event === 'error').at(-1);
    expect(attackError?.payload?.code).toBe('ATTACK_REQUIREMENT');
  });

  it('replays encore by exiling the card, rebuilding the token copies, and scheduling next-end-step sacrifice', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentA = 'p2';
    const opponentB = 'p3';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentA, name: 'P2', spectator: false, life: 40 },
      { id: opponentB, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'encore_card_1',
            name: 'Impetuous Devils',
            type_line: 'Creature - Devil',
            oracle_text: 'Encore {3}{R}{R}',
            power: '6',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).pendingSacrificeAtNextEndStep = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
    };

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'encore_card_1',
      abilityId: 'encore',
      manaCost: '{3}{R}{R}',
      createdPermanentIds: ['encore_live_token_1', 'encore_live_token_2'],
      encoreTargetPlayerIds: [opponentA, opponentB],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('encore_card_1');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(2);
    expect(battlefield.map((perm: any) => perm.id)).toEqual(['encore_live_token_1', 'encore_live_token_2']);
    const targetIds = battlefield.map((perm: any) => perm.encoreAttackPlayerId).sort();
    expect(targetIds).toEqual([opponentA, opponentB]);
    expect(battlefield.every((perm: any) => perm.isToken)).toBe(true);
    expect(battlefield.every((perm: any) => perm.mustAttack)).toBe(true);

    const delayed = (game.state as any).pendingSacrificeAtNextEndStep || [];
    expect(delayed).toHaveLength(2);
    expect(delayed.every((entry: any) => entry.createdBy === playerId)).toBe(true);
    expect(delayed.map((entry: any) => entry.permanentId)).toEqual(['encore_live_token_1', 'encore_live_token_2']);
  });
});