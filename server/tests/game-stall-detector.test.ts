import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  resetGameStallConfigOverrides,
  setGameStallConfigOverrides,
} from '../src/state/modules/gameStall/gameStallConfig.js';
import { computeGameStallFingerprint } from '../src/state/modules/gameStall/gameStallFingerprint.js';
import {
  admitGameStallRecovery,
  checkGameStallIdle,
  getGameStallTracker,
  noteGameStallAiFailure,
  observeGameStall,
  observeGameStallAiActionById,
  registerGameStallRuntime,
  resetAllGameStallTrackersForTests,
  resetGameStallRuntimeForTests,
  type GameStallDetection,
} from '../src/state/modules/gameStall/gameStallDetector.js';
import {
  isOrphanedStackItem,
  runGameStallRecovery,
  type GameStallRecoveryDeps,
} from '../src/state/modules/gameStall/gameStallRecovery.js';

const AI = 'ai_1';
const AI2 = 'ai_2';
const HUMAN = 'human_1';

function makeGame(gameId: string, opts: { humanSeat?: boolean } = {}) {
  ResolutionQueueManager.removeQueue(gameId);
  const game: any = createInitialGameState(gameId);
  const second = opts.humanSeat ? HUMAN : AI2;
  const players = [
    { id: AI, name: 'Robo', seat: 0, isAI: true },
    opts.humanSeat ? { id: HUMAN, name: 'Human', seat: 1 } : { id: AI2, name: 'Robo 2', seat: 1, isAI: true },
  ];
  Object.assign(game.state, {
    id: gameId,
    players,
    turnPlayer: AI,
    priority: AI,
    phase: 'precombatMain',
    step: 'MAIN1',
    turnNumber: 3,
    stack: [],
    battlefield: [
      { id: 'perm_1', controller: AI, owner: AI, tapped: false, counters: {}, card: { id: 'c1', name: 'Bear', type_line: 'Creature' } },
    ],
    life: { [AI]: 40, [second]: 40 },
    zones: {
      [AI]: { hand: [{ id: 'h1' }], handCount: 1, graveyard: [], graveyardCount: 0, exile: [], libraryCount: 50 },
      [second]: { hand: [{ id: 'h2' }], handCount: 1, graveyard: [], graveyardCount: 0, exile: [], libraryCount: 50 },
    },
    manaPool: {},
    priorityPassedBy: new Set<string>(),
  });
  return game;
}

function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe('game stall detector', () => {
  let detections: GameStallDetection[];

  beforeEach(() => {
    resetAllGameStallTrackersForTests();
    resetGameStallRuntimeForTests();
    resetGameStallConfigOverrides();
    setGameStallConfigOverrides({ minStallDurationMs: 0, recoveryCooldownMs: 60_000 });
    detections = [];
    registerGameStallRuntime({
      onStall: (detection) => {
        detections.push(detection);
      },
    });
  });

  afterEach(() => {
    resetGameStallConfigOverrides();
    resetGameStallRuntimeForTests();
    resetAllGameStallTrackersForTests();
  });

  it('fingerprint is stable when nothing changes and moves when state changes', () => {
    const game = makeGame('stall_fp');
    const a = computeGameStallFingerprint(game, 'stall_fp');
    const b = computeGameStallFingerprint(game, 'stall_fp');
    expect(a.board).toBe(b.board);
    expect(a.full).toBe(b.full);

    // Priority rotation alone is not progress for the board hash, but is visible in the full hash.
    game.state.priority = AI2;
    const rotated = computeGameStallFingerprint(game, 'stall_fp');
    expect(rotated.board).toBe(a.board);
    expect(rotated.full).not.toBe(a.full);

    const mutations: Array<() => void> = [
      () => { game.state.battlefield[0].counters = { '+1/+1': 1 }; },
      () => { game.state.battlefield.push({ id: 'tok_1', controller: AI, counters: {} }); },
      () => { game.state.life[AI] = 39; },
      () => { game.state.stack.push({ id: 'stack_1', controller: AI, type: 'spell' }); },
      () => { game.state.manaPool[AI] = { green: 1 }; },
      () => { game.state.zones[AI].graveyard.push({ id: 'gy_1' }); },
      () => { game.state.step = 'BEGIN_COMBAT'; },
    ];
    let previous = computeGameStallFingerprint(game, 'stall_fp').board;
    for (const mutate of mutations) {
      mutate();
      const next = computeGameStallFingerprint(game, 'stall_fp').board;
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  it('flags priority ping-pong with no state change after N passes', async () => {
    setGameStallConfigOverrides({ noProgressPriorityPassThreshold: 30 });
    const game = makeGame('stall_pingpong');
    let changedPasses = 0;
    for (let i = 0; i < 29; i++) {
      const holder = game.state.priority;
      const result = game.passPriority(holder, false);
      if (result.changed) changedPasses += 1;
    }
    await flushTimers();
    expect(changedPasses).toBe(29);
    expect(detections).toHaveLength(0);

    game.passPriority(game.state.priority, false);
    await flushTimers();
    expect(detections).toHaveLength(1);
    expect(detections[0].rule).toBe('priorityPingPong');
    expect(detections[0].counts.priorityPasses).toBe(30);
    expect(getGameStallTracker('stall_pingpong')?.window.length).toBeGreaterThan(0);
  });

  it('flags the same failed AI action repeating K times', async () => {
    setGameStallConfigOverrides({ repeatedAiFailureThreshold: 5 });
    const game = makeGame('stall_ai_fail');
    registerGameStallRuntime({ resolveGame: () => game });
    for (let i = 0; i < 4; i++) {
      noteGameStallAiFailure('stall_ai_fail', AI, new Error('cast failed: no legal targets'), 'test');
      observeGameStallAiActionById('stall_ai_fail', AI, 'priority');
    }
    await flushTimers();
    expect(detections).toHaveLength(0);

    noteGameStallAiFailure('stall_ai_fail', AI, new Error('cast failed: no legal targets'), 'test');
    observeGameStallAiActionById('stall_ai_fail', AI, 'priority');
    await flushTimers();
    expect(detections).toHaveLength(1);
    expect(detections[0].rule).toBe('repeatedAiFailure');
    expect(detections[0].stuckSeat).toBe(AI);
    expect(getGameStallTracker('stall_ai_fail')?.lastAiError?.message).toContain('no legal targets');
  });

  it('does not fire while waiting on an open human prompt', async () => {
    const gameId = 'stall_human_wait';
    const game = makeGame(gameId, { humanSeat: true });
    registerGameStallRuntime({ resolveGame: () => game });
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: HUMAN as any,
      sourceName: 'Test',
      description: 'Pick one',
      mandatory: true,
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    for (let i = 0; i < 80; i++) game.passPriority(game.state.priority, true);
    for (let i = 0; i < 20; i++) game.nextStep();
    for (let i = 0; i < 40; i++) observeGameStallAiActionById(gameId, AI, 'priority');
    checkGameStallIdle(game, gameId, Date.now() + 60 * 60_000);
    await flushTimers();
    expect(detections).toHaveLength(0);
    expect(game.state.step).toBe('MAIN1');
  });

  it('does not fire while a human defender still has to declare blockers', async () => {
    const gameId = 'stall_human_blockers';
    const game = makeGame(gameId, { humanSeat: true });
    registerGameStallRuntime({ resolveGame: () => game });
    Object.assign(game.state, { phase: 'combat', step: 'DECLARE_BLOCKERS', blockersDeclaredBy: [] });
    game.state.battlefield[0].attacking = HUMAN;
    game.state.battlefield.push({ id: 'perm_h', controller: HUMAN, owner: HUMAN, tapped: false, counters: {}, card: { id: 'c2', name: 'Wall', type_line: 'Creature' } });

    for (let i = 0; i < 40; i++) observeGameStallAiActionById(gameId, AI, 'priority');
    checkGameStallIdle(game, gameId, Date.now() + 60 * 60_000);
    await flushTimers();
    expect(detections).toHaveLength(0);

    // Once the human has declared, the same AI churn is eligible again.
    game.state.blockersDeclaredBy = [HUMAN];
    for (let i = 0; i < 40; i++) observeGameStallAiActionById(gameId, AI, 'priority');
    checkGameStallIdle(game, gameId, Date.now() + 60 * 60_000);
    await flushTimers();
    expect(detections.length).toBeGreaterThan(0);
  });

  it('does not fire on a state-changing loop (counter and token growth)', async () => {
    setGameStallConfigOverrides({ noProgressPriorityPassThreshold: 10, repeatedAiActionThreshold: 5 });
    const gameId = 'stall_combo';
    const game = makeGame(gameId);
    registerGameStallRuntime({ resolveGame: () => game });
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        game.state.battlefield[0].counters = { '+1/+1': i + 1 };
      } else {
        game.state.battlefield.push({ id: `tok_${i}`, controller: AI, counters: {} });
      }
      observeGameStallAiActionById(gameId, game.state.priority, 'priority');
      game.passPriority(game.state.priority, false);
    }
    await flushTimers();
    expect(detections).toHaveLength(0);
  });

  it('never observes during undo/restart replay', async () => {
    setGameStallConfigOverrides({ noProgressPriorityPassThreshold: 5 });
    const game = makeGame('stall_replay');
    game.isReplaying = true;
    for (let i = 0; i < 50; i++) {
      observeGameStall(game, 'stall_replay', { kind: 'priorityPass', playerId: AI, args: { changed: true } });
    }
    await flushTimers();
    expect(detections).toHaveLength(0);
    expect(getGameStallTracker('stall_replay')).toBeUndefined();
  });

  it('recovery runs stage 1 then stage 2, advances the phase, and writes a report', async () => {
    setGameStallConfigOverrides({ noProgressPriorityPassThreshold: 10 });
    const gameId = 'stall_recovery';
    const game = makeGame(gameId);
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-report-test-'));

    for (let i = 0; i < 10; i++) game.passPriority(game.state.priority, false);
    await flushTimers();
    expect(detections).toHaveLength(1);
    const detection = detections[0];
    // Detector admitted the recovery: a second automatic one is blocked while in flight.
    expect(admitGameStallRecovery(gameId, game).ok).toBe(false);

    const chat: string[] = [];
    const forcedPasses: string[] = [];
    const deps: GameStallRecoveryDeps = {
      getGame: () => game,
      isAiSeat: (_g, playerId) => playerId === AI || playerId === AI2,
      cancelAiPendingAction: (_g, playerId) => [`cleared scheduled AI action for ${playerId}`],
      // Simulates the stuck AI: passing changes nothing on the board.
      forcePassPriority: (_g, playerId) => {
        forcedPasses.push(playerId);
      },
      resolveTopOfStack: () => false,
      advanceStep: () => {
        game.nextStep();
        return true;
      },
      cancelResolutionStep: (g, stepId) => Boolean(ResolutionQueueManager.cancelStep(g, stepId)),
      broadcast: () => {},
      emitSystemChat: (_g, message) => chat.push(message),
      wait: async () => {},
      reportDir,
    };

    const outcome = await runGameStallRecovery(detection, deps, { admitted: true });

    expect(forcedPasses).toEqual([AI]);
    expect(outcome.record.stagesApplied.map((s) => s.stage)).toEqual([1, 2]);
    expect(outcome.record.stagesApplied[0].boardChanged).toBe(false);
    expect(outcome.record.stagesApplied[1].boardChanged).toBe(true);
    expect(outcome.status).toBe('recovered');
    expect(outcome.gameAdvanced).toBe(true);
    expect(game.state.step).not.toBe('MAIN1');
    expect(chat.some((line) => line.startsWith('Stall detected — advanced to'))).toBe(true);

    expect(outcome.reportPath).toBeTruthy();
    const files = fs.readdirSync(reportDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-stall_recovery\.json$/);
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, files[0]), 'utf8'));
    expect(report.status).toBe('new');
    expect(report.gameId).toBe(gameId);
    expect(report.detection.rule).toBe('priorityPingPong');
    expect(report.recovery.status).toBe('recovered');
    expect(report.recovery.gameAdvanced).toBe(true);
    expect(report.recovery.stagesApplied).toHaveLength(2);
    expect(report.seats.map((s: any) => s.kind)).toEqual(['ai', 'ai']);
    expect(Array.isArray(report.actionWindow)).toBe(true);
    expect(report.actionWindow.length).toBeGreaterThan(0);
    expect(Array.isArray(report.serverLog)).toBe(true);

    // Rate limit: inside the cooldown no new automatic recovery is admitted.
    expect(admitGameStallRecovery(gameId, game).ok).toBe(false);
    // Manual escape hatch bypasses the cooldown once nothing is in flight.
    expect(admitGameStallRecovery(gameId, game, { manual: true }).ok).toBe(true);
    fs.rmSync(reportDir, { recursive: true, force: true });
  });


  it('still detects repeated AI failures when RQ step ids and pendingSpellCasts churn (busy cast loop)', async () => {
    // G1 Horizon Chimera: every cast attempt minted a new payment RQ step id and
    // pendingSpellCasts entry. Those used to flip the board fingerprint and reset
    // the stall run, so auto-unstuck never fired on the busy loop.
    setGameStallConfigOverrides({ repeatedAiFailureThreshold: 5, minStallDurationMs: 0 });
    const gameId = 'stall_busy_cast';
    const game = makeGame(gameId);
    registerGameStallRuntime({ resolveGame: () => game });

    // Seed the same RQ shape the busy loop keeps regenerating (unique ids each time).
    ResolutionQueueManager.addStep(gameId, {
      id: 'pay_seed',
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: AI as any,
      sourceName: 'Horizon Chimera',
      status: 'pending',
    } as any);
    (game.state as any).pendingSpellCasts = { cast_seed: { cardId: 'chimera', playerId: AI } };
    const baseFp = computeGameStallFingerprint(game, gameId).board;

    for (let i = 0; i < 5; i++) {
      (game.state as any).pendingSpellCasts = {
        [`cast_effect_${i}_${Date.now()}`]: { cardId: 'chimera', playerId: AI },
      };
      ResolutionQueueManager.removeQueue(gameId);
      ResolutionQueueManager.addStep(gameId, {
        id: `pay_${i}_${Date.now()}`,
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: AI as any,
        sourceName: 'Horizon Chimera',
        status: 'pending',
      } as any);
      const churnFp = computeGameStallFingerprint(game, gameId).board;
      expect(churnFp).toBe(baseFp);

      noteGameStallAiFailure(
        gameId,
        AI,
        new Error(`duplicate completeCastSpell for chimera already on stack`),
        'completeCastSpellAlreadyOnStack',
      );
      observeGameStallAiActionById(gameId, AI, 'priority');
    }
    await flushTimers();
    expect(detections).toHaveLength(1);
    expect(detections[0].rule).toBe('repeatedAiFailure');
    expect(detections[0].stuckSeat).toBe(AI);
  });

  it('aiIdleNoProgress measures AI hold time, not board age (human thinking then passing)', async () => {
    const gameId = 'stall_idle_human_think';
    const game = makeGame(gameId, { humanSeat: true });
    registerGameStallRuntime({ resolveGame: () => game, isAiSeat: (_g: string, pid: string) => pid === AI } as any);
    const t0 = Date.now();
    game.state.priority = HUMAN;
    expect(checkGameStallIdle(game, gameId, t0)).toBeNull();
    // Human holds priority for 60s with a frozen board, then passes to the AI.
    game.state.priority = AI;
    expect(checkGameStallIdle(game, gameId, t0 + 60_000)).toBeNull();
    await flushTimers();
    expect(detections).toHaveLength(0);
    // AI then really holds priority past the idle timeout.
    expect(checkGameStallIdle(game, gameId, t0 + 60_000 + 46_000)).not.toBeNull();
    await flushTimers();
    expect(detections).toHaveLength(1);
    expect(detections[0].rule).toBe('aiIdleNoProgress');
  });

  it('only treats clearly invalid stack items as orphaned', () => {
    const state = { players: [{ id: AI }] };
    expect(isOrphanedStackItem(null, state)).toBe(true);
    expect(isOrphanedStackItem({ controller: AI, type: 'spell' }, state)).toBe(true);
    expect(isOrphanedStackItem({ id: 's1', controller: 'ghost', type: 'spell' }, state)).toBe(true);
    expect(isOrphanedStackItem({ id: 's1', controller: AI }, state)).toBe(true);
    expect(isOrphanedStackItem({ id: 's1', controller: AI, type: 'spell', card: { name: 'Shock' } }, state)).toBe(false);
  });
});
