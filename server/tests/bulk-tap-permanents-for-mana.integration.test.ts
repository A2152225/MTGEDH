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

  it('resolves emit-side virtual group ids after _tokenGroupMembers is cleared (restart)', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const tokenIds = Array.from({ length: 12 }, (_, i) => `merfolk_token_${i}`);
    const groupId = `group_${tokenIds[0]}`;
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

    // Simulate post-restart: no in-memory group registry (emit rebuilds via prototype match).
    delete (game as any)._tokenGroupMembers;

    const virtualIds = tokenIds.map((_, i) => `${groupId}_virtual_${i}`);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);

    await handlers['bulkTapPermanentsForMana']({
      gameId,
      permanentIds: virtualIds,
      count: 8,
    });

    const battlefield = (game.state as any).battlefield || [];
    const tappedTokens = battlefield.filter((p: any) => tokenIds.includes(p.id) && p.tapped === true);
    expect(tappedTokens).toHaveLength(8);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    const manaStep = steps.find((step: any) => step.type === ResolutionStepType.MANA_COLOR_SELECTION) as any;
    expect(manaStep).toBeDefined();
    expect(manaStep.selectionKind).toBe('distribution');
    expect(Number(manaStep.totalAmount || manaStep.amount)).toBe(8);
  });

  it('sanitizeStepForClient preserves selectionKind so the client opens the distribution UI', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: playerId as any,
      sourceId: 'tok_0',
      sourceName: 'Merfolk Wizard',
      description: 'Choose how to distribute 100 mana',
      mandatory: true,
      selectionKind: 'distribution',
      permanentId: 'tok_0',
      cardName: 'Merfolk Wizard',
      amount: 100,
      totalAmount: 100,
      availableColors: ['W', 'U', 'B', 'R', 'G'],
      allowedColors: ['W', 'U', 'B', 'R', 'G'],
    } as any);

    const { sanitizeStepForClient } = await import('../src/socket/resolution.js');
    const clientStep = sanitizeStepForClient(gameId, step as any);
    expect(clientStep.selectionKind).toBe('distribution');
    expect(clientStep.totalAmount).toBe(100);
    expect(clientStep.availableColors).toEqual(['W', 'U', 'B', 'R', 'G']);
  });

  it('applies distribution mana to the pool when the player submits colors', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const tokenIds = Array.from({ length: 5 }, (_, i) => `merfolk_token_${i}`);
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
      count: 5,
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId);
    const manaStep = steps.find((step: any) => step.type === ResolutionStepType.MANA_COLOR_SELECTION) as any;
    expect(manaStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: manaStep.id,
      selections: { U: 3, W: 2 },
      cancelled: false,
    });

    const pool = (game.state as any).manaPool[playerId];
    expect(pool.blue).toBe(3);
    expect(pool.white).toBe(2);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
  });
});
