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

function seedGame(gameId: string, cardId: string, oracleText: string, options?: { manaCost?: string; manaPool?: any; life?: number }) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: options?.life ?? 40 }];
  (game.state as any).life = { [playerId]: options?.life ?? 40 };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [
        {
          id: cardId,
          name: 'Grave Spell',
          type_line: 'Sorcery',
          mana_cost: options?.manaCost,
          oracle_text: oracleText,
          zone: 'graveyard',
        },
      ],
      graveyardCount: 1,
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: options?.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };

  return { game, playerId };
}

describe('cast-from-graveyard replay semantics (integration)', () => {
  const gameId = 'test_cast_from_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('live jump-start activation spends mana and moves the card from graveyard to stack', async () => {
    const { game, playerId } = seedGame(gameId, 'jump_start_1', 'Draw a card.\nJump-start {1}{U}', {
      manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
    });
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'jump_start_1',
      abilityId: 'jump-start',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('jump_start_1');
    expect(stack[0]?.card?.castWithAbility).toBe('jump-start');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  for (const abilityId of ['flashback', 'retrace', 'escape']) {
    it(`replays ${abilityId} as a cast-from-graveyard stack item`, () => {
      const replayGameId = `${gameId}_${abilityId}`;
      const oracleText = abilityId === 'flashback'
        ? 'Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life.'
        : abilityId === 'escape'
          ? 'Escape {2}{G}, Exile three other cards from your graveyard.'
          : `${abilityId} sample text`;
      const { game, playerId } = seedGame(replayGameId, `${abilityId}_1`, oracleText, {
        manaCost: abilityId === 'retrace' ? '{2}{B}' : undefined,
        manaPool: abilityId === 'flashback'
          ? { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 }
          : abilityId === 'escape'
            ? { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 }
            : { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 2 },
        life: abilityId === 'flashback' ? 20 : 40,
      });

      game.applyEvent({
        type: 'activateGraveyardAbility',
        playerId,
        cardId: `${abilityId}_1`,
        abilityId,
        ...(abilityId === 'flashback' ? { manaCost: '{1}{U}', lifePaidForCost: 3 } : {}),
        ...(abilityId === 'escape' ? { manaCost: '{2}{G}' } : {}),
        ...(abilityId === 'retrace' ? { manaCost: '{2}{B}' } : {}),
      });

      const zones = (game.state as any).zones?.[playerId];
      expect(zones?.graveyardCount).toBe(0);
      const stack = (game.state as any).stack || [];
      expect(stack).toHaveLength(1);
      expect(stack[0]?.card?.id).toBe(`${abilityId}_1`);
      expect(stack[0]?.card?.castWithAbility).toBe(abilityId);
      expect((game.state as any).castFromGraveyardThisTurn?.[playerId]).toBe(true);
      if (abilityId === 'flashback') {
        expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
        expect((game.state as any).life?.[playerId]).toBe(17);
      }
    });
  }
});