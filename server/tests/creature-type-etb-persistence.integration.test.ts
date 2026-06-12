import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { queuePermanentAsEntersBattlefieldChoiceSteps } from '../src/state/modules/stackResolvePermanentEtbChoiceUtils.js';
import '../src/state/modules/priority.js';

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

describe('ETB creature type choice persistence (G1 regression)', () => {
  const gameId = 'test_creature_type_etb_persistence';
  const playerId = 'p1';

  const cavernOracle =
    'As Cavern of Souls enters the battlefield, choose a creature type.\n' +
    'Creatures of the chosen type can\'t be countered.\n' +
    '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.';

  const threeTreeOracle =
    'As Three Tree City enters, choose a creature type.\n' +
    '{T}: Add {C}.\n' +
    '{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.';

  async function resetGame() {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map() },
    } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame();
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
  });

  afterEach(async () => {
    await resetGame();
  });

  async function completeCreatureTypeChoice(permanentId: string, cardName: string, oracleText: string, chosenType: string) {
    const game = ensureGame(gameId)!;
    (game.state as any).battlefield = [{
      id: permanentId,
      controller: playerId,
      owner: playerId,
      card: {
        id: `${permanentId}_card`,
        name: cardName,
        type_line: cardName.includes('City') ? 'Land' : 'Land',
        oracle_text: oracleText,
      },
    }];

    queuePermanentAsEntersBattlefieldChoiceSteps(game as any, {
      controller: playerId as any,
      effectiveCard: {
        name: cardName,
        oracle_text: oracleText,
      },
      newPermanent: (game.state as any).battlefield[0],
      newPermId: permanentId,
      isCreature: false,
    });

    const step = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry?.type === ResolutionStepType.CREATURE_TYPE_CHOICE,
    ) as any;
    expect(step).toBeTruthy();
    expect(step.permanentId).toBe(permanentId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: step.id,
      selections: chosenType,
    });

    return ensureGame(gameId)!;
  }

  it('persists chosenCreatureType on Cavern of Souls after resolution', async () => {
    const game = await completeCreatureTypeChoice('cavern_1', 'Cavern of Souls', cavernOracle, 'Merfolk');
    const cavern = (game.state as any).battlefield.find((entry: any) => entry.id === 'cavern_1');
    expect(cavern?.chosenCreatureType).toBe('Merfolk');
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('persists chosenCreatureType on Three Tree City after resolution', async () => {
    const game = await completeCreatureTypeChoice('three_tree_1', 'Three Tree City', threeTreeOracle, 'Elf');
    const land = (game.state as any).battlefield.find((entry: any) => entry.id === 'three_tree_1');
    expect(land?.chosenCreatureType).toBe('Elf');
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
