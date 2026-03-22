import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
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

function seedGame(gameId: string) {
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
          id: 'veteran_echo_1',
          name: 'Valiant Veteran Echo',
          type_line: 'Creature - Human Soldier',
          oracle_text: '{3}{W}{W}, Exile this card from your graveyard: Put a +1/+1 counter on each Soldier you control.',
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
      id: 'soldier_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      card: { id: 'soldier_1', name: 'Soldier One', type_line: 'Creature - Human Soldier', zone: 'battlefield' },
    },
    {
      id: 'soldier_2',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: { '+1/+1': 2 },
      card: { id: 'soldier_2', name: 'Soldier Two', type_line: 'Creature - Human Soldier', zone: 'battlefield' },
    },
    {
      id: 'wizard_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      card: { id: 'wizard_1', name: 'Wizard One', type_line: 'Creature - Human Wizard', zone: 'battlefield' },
    },
  ];
  (game.state as any).manaPool = {
    [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
  };

  return { game, playerId };
}

describe('exile-to-add-counters graveyard replay semantics (integration)', () => {
  const gameId = 'test_exile_to_add_counters_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('live exile-to-add-counters exiles the card and adds counters to matching creatures', async () => {
    const { game, playerId } = seedGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'veteran_echo_1',
      abilityId: 'exile-to-add-counters',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('veteran_echo_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((perm: any) => perm.id === 'soldier_1')?.counters?.['+1/+1']).toBe(1);
    expect(battlefield.find((perm: any) => perm.id === 'soldier_2')?.counters?.['+1/+1']).toBe(3);
    expect(battlefield.find((perm: any) => perm.id === 'wizard_1')?.counters?.['+1/+1']).toBeUndefined();
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays exile-to-add-counters exile, counters, and mana spend', () => {
    const replayGameId = `${gameId}_replay`;
    const { game, playerId } = seedGame(replayGameId);

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'veteran_echo_1',
      abilityId: 'exile-to-add-counters',
      creatureType: 'Soldier',
      manaCost: '{3}{W}{W}',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('veteran_echo_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((perm: any) => perm.id === 'soldier_1')?.counters?.['+1/+1']).toBe(1);
    expect(battlefield.find((perm: any) => perm.id === 'soldier_2')?.counters?.['+1/+1']).toBe(3);
    expect(battlefield.find((perm: any) => perm.id === 'wizard_1')?.counters?.['+1/+1']).toBeUndefined();
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });
});