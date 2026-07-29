import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const gameId = 'test_bulk_tap_tokens_for_mana';
const playerId = 'p1';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
    rooms: new Set<string>([String(data.gameId || '')]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // ignore
  }
}

describe('bulkTapPermanentsForMana', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame();
  });

  afterEach(async () => {
    await resetGame();
  });

  it('taps many Cryptolith-enabled tokens and queues one mana distribution prompt', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const tokenIds = Array.from({ length: 25 }, (_, i) => `merfolk_token_${i}`);
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'cryptolith_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'cryptolith_card',
          name: 'Cryptolith Rite',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
        },
      },
      ...tokenIds.map((id) => ({
        id,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        isToken: true,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: `${id}_card`,
          name: 'Merfolk Wizard',
          type_line: 'Token Creature — Merfolk Wizard',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      })),
    ];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);

    await handlers['bulkTapPermanentsForMana']({
      gameId,
      permanentIds: tokenIds,
      count: 20,
    });

    const battlefield = (game.state as any).battlefield || [];
    const tappedTokens = battlefield.filter((p: any) => tokenIds.includes(p.id) && p.tapped === true);
    expect(tappedTokens).toHaveLength(20);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    const manaStep = steps.find((step: any) => step.type === ResolutionStepType.MANA_COLOR_SELECTION) as any;
    expect(manaStep).toBeDefined();
    expect(manaStep.selectionKind).toBe('distribution');
    expect(Number(manaStep.totalAmount || manaStep.amount)).toBe(20);
  });
});
