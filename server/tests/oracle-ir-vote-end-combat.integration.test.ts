import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const voteGameId = 'test_oracle_ir_vote_socket';
const endCombatGameId = 'test_oracle_ir_end_combat';
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('oracle IR vote queue + resume (Layer 3)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    await resetGame(voteGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    await resetGame(voteGameId);
  });

  it('queues APNAP VOTE steps and resumes draw from votes_received tallies', async () => {
    createGameIfNotExists(voteGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(voteGameId) ?? createInitialGameState(voteGameId);
    games.set(voteGameId as any, game as any);

    (game as any).gameId = voteGameId;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).activePlayer = p1;
    (game.state as any).turnPlayer = p1;
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: [
          { id: 'lib1', name: 'Card A' },
          { id: 'lib2', name: 'Card B' },
        ],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
      },
      [p2]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0 },
    };
    const p1Player = (game.state as any).players.find((entry: any) => entry.id === p1);
    p1Player.library = [
      { id: 'lib1', name: 'Card A' },
      { id: 'lib2', name: 'Card B' },
    ];
    p1Player.hand = [];
    (game as any).libraries = new Map([
      [p1, p1Player.library.map((card: any) => ({ ...card }))],
      [p2, []],
    ]);

    const steps = [
      {
        kind: 'vote' as const,
        voters: { kind: 'each_player' as const },
        choices: [] as string[],
        ballot: 'players' as const,
        ballotFilter: 'another player',
        secret: true,
        startingWith: { kind: 'you' as const },
        raw: 'Each player secretly votes for another player',
      },
      {
        kind: 'draw' as const,
        who: { kind: 'you' as const },
        amount: { kind: 'votes_received' as const, who: 'you' as const },
        raw: 'For each vote you received, draw a card.',
      },
    ];

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'mob-verdict-1',
      sourceName: 'Mob Verdict',
      sourceObjectType: 'spell',
    });

    applyOracleIRStepsOnServer(
      game as any,
      game.state as any,
      steps as any,
      irCtx,
      { allowOptional: false, haltOnPlayerChoiceRequired: true },
      { controller: p1, sourceName: 'Mob Verdict', sourceId: 'mob-verdict-1' },
    );

    const firstVote = ResolutionQueueManager.getQueue(voteGameId).steps.find(
      (step) => step.type === ResolutionStepType.VOTE,
    );
    expect(firstVote).toBeTruthy();
    expect(firstVote!.playerId).toBe(p1);
    expect((firstVote as any).choices).toEqual(expect.arrayContaining([p2]));
    expect((firstVote as any).secret).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: p1Socket, handlers: p1Handlers } = createMockSocket(p1, voteGameId, emitted);
    const { socket: p2Socket, handlers: p2Handlers } = createMockSocket(p2, voteGameId, emitted);
    const io = createMockIo(emitted, [p1Socket, p2Socket]);
    registerResolutionHandlers(io as any, p1Socket as any);
    registerResolutionHandlers(io as any, p2Socket as any);

    await p1Handlers.submitResolutionResponse({
      gameId: voteGameId,
      stepId: String(firstVote!.id),
      selections: p2,
      cancelled: false,
    });

    const secondVote = ResolutionQueueManager.getQueue(voteGameId).steps.find(
      (step) => step.type === ResolutionStepType.VOTE && step.playerId === p2,
    );
    expect(secondVote).toBeTruthy();

    await p2Handlers.submitResolutionResponse({
      gameId: voteGameId,
      stepId: String(secondVote!.id),
      selections: p1,
      cancelled: false,
    });

    expect(ResolutionQueueManager.getQueue(voteGameId).steps).toHaveLength(0);
    expect((game.state as any).votesReceivedByPlayer?.[p1]).toBe(1);
    const handIds = ((game.state as any).zones?.[p1]?.hand || []).map((c: any) => c.id);
    expect(handIds).toContain('lib1');
  }, 20000);
});

describe('oracle IR end_combat_phase (Layer 3 server apply)', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue(endCombatGameId);
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue(endCombatGameId);
  });

  it('applies End the combat phase through applyOracleIRStepsOnServer', () => {
    const game = createInitialGameState(endCombatGameId);
    (game as any).gameId = endCombatGameId;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    Object.assign(game.state as any, {
      phase: 'combat',
      step: 'declareBlockers',
      combat: { attackers: ['a1'] },
      combatNumber: 1,
      battlefield: [
        {
          id: 'a1',
          controller: p1,
          attacking: p2,
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'b1',
          controller: p2,
          blocking: 'a1',
          card: { name: 'Wall', type_line: 'Creature — Wall' },
        },
      ],
      stack: [
        {
          id: 's1',
          controller: p1,
          card: { id: 'c1', name: 'Mandate of Peace', type_line: 'Instant' },
        },
      ],
    });

    const step = {
      kind: 'end_combat_phase' as const,
      exileStack: true,
      raw: 'End the combat phase.',
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 's1',
      sourceName: 'Mandate of Peace',
      sourceObjectType: 'spell',
    });

    const result = applyOracleIRStepsOnServer(
      game as any,
      game.state as any,
      [step as any],
      irCtx,
      { allowOptional: true },
      { controller: p1, sourceName: 'Mandate of Peace', sourceId: 's1' },
    );

    expect(result.appliedSteps.some((s) => s.kind === 'end_combat_phase')).toBe(true);
    expect((game.state as any).phase).toBe(GamePhase.POSTCOMBAT_MAIN);
    expect((game.state as any).battlefield[0].attacking).toBeUndefined();
    expect((game.state as any).battlefield[1].blocking).toBeUndefined();
    expect((game.state as any).combat).toBeUndefined();
    expect((game.state as any).stack).toHaveLength(0);
  });
});
