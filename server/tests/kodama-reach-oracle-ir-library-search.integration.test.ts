import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe("Kodama's Reach Oracle IR library search", () => {
  const gameId = 'test_kodama_reach_oracle_ir_library_search';
  const playerId = 'p1';
  const oracleText =
    "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.";

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
  });

  it('queues a single split-destination library search under Oracle IR spell primary', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 6,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'f2', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest2.png' } },
        { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        { id: 'p2', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains2.png' } },
        { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', image_uris: { normal: 'island.png' } },
        { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'bolt.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'kodamas_reach_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'kodamas_reach_1',
          name: "Kodama's Reach",
          type_line: 'Sorcery',
          oracle_text: oracleText,
          mana_cost: '{2}{G}',
        },
        targets: [],
      },
    ];

    resolveTopOfStack(game as any);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).filter(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any[];
    expect(steps).toHaveLength(1);
    expect(steps[0].splitDestination).toBe(true);
    expect(steps[0].destination).toBe('split');
    expect(steps[0].maxSelections).toBe(2);
    expect(steps[0].oracleIrChoiceStepJson).toBeTruthy();
    expect(steps[0].filter).toEqual({ supertypes: ['basic'], types: ['land'] });
    expect((steps[0].availableCards || []).map((card: any) => card.id)).toEqual([
      'f1', 'f2', 'p1', 'p2', 'island',
    ]);
  });
});
