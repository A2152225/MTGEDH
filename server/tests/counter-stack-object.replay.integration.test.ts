import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/index.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';

async function resetGame(gameId: string) {
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedCounterTable(game: any, playerId: PlayerID, opponentId: PlayerID, stack: any[]) {
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false, graveyard: [], exile: [], hand: [], library: [] },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false, graveyard: [], exile: [], hand: [], library: [] },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).battlefield = [];
  (game.state as any).stack = stack.map((item) => ({ ...item, card: item.card ? { ...item.card } : undefined }));
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
}

describe('counter stack object replay', () => {
  const gameId = 'test_counter_stack_object_replay';
  const replayGameId = `${gameId}_replay`;
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('persists a countered spell as counterStackObject and replays it once', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    const bolt = {
      id: 'spell-1',
      type: 'spell',
      controller: opponentId,
      owner: opponentId,
      card: { id: 'bolt-card', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' },
    };
    seedCounterTable(game, playerId, opponentId, [bolt]);

    const steps = parseOracleTextToIR('Counter target spell.', 'Counterspell').abilities[0]?.steps ?? [];
    expect(steps.map((step: any) => step.kind)).toEqual(['counter_spell']);

    const eventStart = getEvents(gameId).length;
    applyOracleIRStepsOnServer(
      game as any,
      (game.state as any),
      steps,
      buildOracleIRExecutionContext({
        controllerId: playerId,
        sourceId: 'counterspell-1',
        sourceName: 'Counterspell',
        targetSpellId: 'spell-1',
      }),
      { allowOptional: false },
      { controller: playerId },
    );

    expect((game.state as any).stack.map((item: any) => item.id)).toEqual([]);
    expect((game.state as any).zones[opponentId].graveyard.map((card: any) => card.id)).toEqual(['bolt-card']);

    const replayEvents = toReplayEvents(gameId, eventStart);
    const counterEvents = replayEvents.filter((event) => event.type === 'counterStackObject');
    expect(counterEvents).toHaveLength(1);
    expect(counterEvents[0]).toEqual(expect.objectContaining({
      type: 'counterStackObject',
      stackItemId: 'spell-1',
      ownerId: opponentId,
      destination: 'graveyard',
      wasSpell: true,
      oracleIrReplayMutation: true,
    }));

    const replayGame = createInitialGameState(replayGameId);
    seedCounterTable(replayGame, playerId, opponentId, [bolt]);
    replayGame.replay!(replayEvents as any);

    expect((replayGame.state as any).stack.map((item: any) => item.id)).toEqual([]);
    expect((replayGame.state as any).zones[opponentId].graveyard.map((card: any) => card.id)).toEqual(['bolt-card']);
    assertNoReplayDivergence(game, replayGame);

    replayGame.applyEvent?.(counterEvents[0] as any);
    expect((replayGame.state as any).zones[opponentId].graveyard).toHaveLength(1);
  });

  it('replays a countered ability by removing it from the stack', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    const ability = {
      id: 'ability-1',
      type: 'activated_ability',
      controller: opponentId,
      owner: opponentId,
      description: '{T}: Draw a card.',
    };
    seedCounterTable(game, playerId, opponentId, [ability]);

    const steps = parseOracleTextToIR('Counter target activated ability.', 'Stifle').abilities[0]?.steps ?? [];
    const eventStart = getEvents(gameId).length;
    applyOracleIRStepsOnServer(
      game as any,
      (game.state as any),
      steps,
      buildOracleIRExecutionContext({
        controllerId: playerId,
        sourceId: 'stifle-1',
        sourceName: 'Stifle',
        targetSpellId: 'ability-1',
      }),
      { allowOptional: false },
      { controller: playerId },
    );

    expect((game.state as any).stack).toEqual([]);
    expect((game.state as any).zones[opponentId].graveyard).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.some((event) => event.type === 'counterStackObject' && event.destination === 'cease')).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    seedCounterTable(replayGame, playerId, opponentId, [ability]);
    replayGame.replay!(replayEvents as any);

    expect((replayGame.state as any).stack).toEqual([]);
    expect((replayGame.state as any).zones[opponentId].graveyard).toEqual([]);
    assertNoReplayDivergence(game, replayGame);
  });
});
