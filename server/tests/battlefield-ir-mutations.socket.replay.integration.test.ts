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

function seedTargetBoard(game: any, playerId: PlayerID, opponentId: PlayerID) {
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [{
    id: 'target_bear',
    controller: opponentId,
    owner: opponentId,
    tapped: false,
    counters: {},
    card: {
      name: 'Target Bear',
      type_line: 'Creature — Bear',
      power: '2',
      toughness: '2',
    },
  }];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 },
  };
}

function runOracleIrMutation(
  game: any,
  gameId: string,
  playerId: PlayerID,
  oracleText: string,
  sourceName: string,
  sourceId: string,
  targetPermanentId: string,
) {
  const steps = parseOracleTextToIR(oracleText, sourceName).abilities?.[0]?.steps || [];
  expect(steps.length).toBeGreaterThan(0);

  const irCtx = buildOracleIRExecutionContext({
    controllerId: playerId,
    sourceId,
    sourceName,
    targetPermanentId,
  });

  applyOracleIRStepsOnServer(
    game as any,
    (game.state as any),
    steps,
    irCtx,
    { allowOptional: false },
    { controller: playerId },
  );
}

describe('battlefield IR mutations socket replay', () => {
  const gameId = 'test_battlefield_ir_mutations_socket_replay';
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

  it('persists and replays suspect via battlefieldPermanentPatch', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedTargetBoard(game, playerId, opponentId);
    (game as any).gameId = gameId;

    const eventStart = getEvents(gameId).length;
    runOracleIrMutation(
      game,
      gameId,
      playerId,
      'Suspect target creature.',
      'Case Cracker',
      'case-cracker-1',
      'target_bear',
    );

    const livePermanent = (game.state as any).battlefield.find((entry: any) => entry?.id === 'target_bear');
    expect(livePermanent?.isSuspected).toBe(true);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.some((event: any) =>
      event.type === 'battlefieldPermanentPatch'
      && event.permanentId === 'target_bear'
      && event.patch?.isSuspected === true,
    )).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    seedTargetBoard(replayGame, playerId, opponentId);
    replayGame.replay!(replayEvents as any);

    const replayPermanent = (replayGame.state as any).battlefield.find((entry: any) => entry?.id === 'target_bear');
    expect(replayPermanent?.isSuspected).toBe(true);
    assertNoReplayDivergence(game, replayGame);
  });

  it('persists and replays detain via battlefieldPermanentPatch', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedTargetBoard(game, playerId, opponentId);
    (game as any).gameId = gameId;

    const eventStart = getEvents(gameId).length;
    runOracleIrMutation(
      game,
      gameId,
      playerId,
      'Detain target permanent.',
      'Azorius Arrester',
      'azorius-arrester-1',
      'target_bear',
    );

    const livePermanent = (game.state as any).battlefield.find((entry: any) => entry?.id === 'target_bear');
    expect(Array.isArray(livePermanent?.temporaryEffects)).toBe(true);
    expect(livePermanent.temporaryEffects.length).toBeGreaterThan(0);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.some((event: any) =>
      event.type === 'battlefieldPermanentPatch'
      && event.permanentId === 'target_bear'
      && Array.isArray(event.patch?.temporaryEffects)
      && event.patch.temporaryEffects.length > 0,
    )).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    seedTargetBoard(replayGame, playerId, opponentId);
    replayGame.replay!(replayEvents as any);

    const replayPermanent = (replayGame.state as any).battlefield.find((entry: any) => entry?.id === 'target_bear');
    expect(Array.isArray(replayPermanent?.temporaryEffects)).toBe(true);
    expect(replayPermanent.temporaryEffects.length).toBeGreaterThan(0);
    assertNoReplayDivergence(game, replayGame);
  });

  it('persists and replays phase out via battlefieldPermanentPatch', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedTargetBoard(game, playerId, opponentId);
    (game as any).gameId = gameId;

    const eventStart = getEvents(gameId).length;
    runOracleIrMutation(
      game,
      gameId,
      playerId,
      'Target creature phases out.',
      "Galadriel's Dismissal",
      'galadriels-dismissal-1',
      'target_bear',
    );

    const livePermanent = (game.state as any).battlefield.find((entry: any) => entry?.id === 'target_bear');
    expect(livePermanent?.phasedOut).toBe(true);
    expect(livePermanent?.phasedOutBy).toBe('effect');

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.some((event: any) =>
      event.type === 'battlefieldPermanentPatch'
      && event.permanentId === 'target_bear'
      && event.patch?.phasedOut === true,
    )).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    seedTargetBoard(replayGame, playerId, opponentId);
    replayGame.replay!(replayEvents as any);

    const replayPermanent = (replayGame.state as any).battlefield.find((entry: any) => entry?.id === 'target_bear');
    expect(replayPermanent?.phasedOut).toBe(true);
    expect(replayPermanent?.phasedOutBy).toBe('effect');
    assertNoReplayDivergence(game, replayGame);
  });
});
