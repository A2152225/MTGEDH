import { afterEach, describe, expect, it, vi } from 'vitest';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { ResolutionStepStatus, ResolutionStepType } from '../src/state/resolution/types.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { handleAIGameFlow, cleanupGameAI, registerAIPlayer } from '../src/socket/ai.js';
import { checkAndTriggerAI } from '../src/socket/util.js';

describe('AI resume kick after reconnect', () => {
  const gameId = 'ai_resume_kick_priority';
  const extraGameIds = ['ai_resume_kick_pregame', 'ai_resume_kick_pregame_human_priority', 'ai_resume_kick_restoring'];

  afterEach(() => {
    for (const id of [gameId, ...extraGameIds]) {
      cleanupGameAI(id);
      ResolutionQueueManager.removeQueue(id);
      games.delete(id);
    }
    vi.restoreAllMocks();
  });

  it('checkAndTriggerAI schedules the AI priority holder after a join-style sync', async () => {
    const game = createInitialGameState(gameId);
    games.set(gameId, game as any);

    (game.state as any).players = [
      { id: 'human_1', name: 'Human', isAI: false },
      { id: 'ai_1', name: 'Chaos', isAI: true, difficulty: 0.5 },
    ];
    (game.state as any).priority = 'ai_1';
    (game.state as any).turnPlayer = 'human_1';
    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, 'ai_1' as any, 'Chaos', 0.5);

    const scheduleCalls: Array<{ playerId: string }> = [];
    const io = { to: () => ({ emit: () => undefined }) } as any;

    const aiModule = await import('../src/socket/ai.js');
    // In-game join-style sync uses scheduleAIPriority. scheduleAIGameFlow is
    // pre-game commander/mulligan only (stacking both added a second 300ms hop).
    const originalSchedule = aiModule.scheduleAIPriority;
    vi.spyOn(aiModule, 'scheduleAIPriority').mockImplementation(((_io, _gameId, playerId) => {
      scheduleCalls.push({ playerId: String(playerId) });
    }) as any);

    checkAndTriggerAI(io, game as any, gameId);

    // Dynamic import inside checkAndTriggerAI resolves on a microtask.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(scheduleCalls.some((call) => call.playerId === 'ai_1')).toBe(true);
    // Keep reference so tree-shaking / unused lint does not strip the import in some setups.
    expect(typeof originalSchedule).toBe('function');
  });

  it('handleAIGameFlow resolves an AI pending player_choice even without priority', async () => {
    const game = createInitialGameState(gameId);
    games.set(gameId, game as any);

    (game.state as any).players = [
      { id: 'human_1', name: 'Human', isAI: false },
      { id: 'ai_1', name: 'King', isAI: true, difficulty: 0.5 },
      { id: 'ai_2', name: 'Chaos', isAI: true, difficulty: 0.5 },
    ];
    (game.state as any).priority = 'ai_2';
    (game.state as any).turnPlayer = 'human_1';
    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'humble_1',
        controller: 'ai_1',
        owner: 'ai_1',
        tapped: true,
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of this creature. Activate only during your turn.',
        },
      },
    ];

    registerAIPlayer(gameId, 'ai_1' as any, 'King', 0.5);
    registerAIPlayer(gameId, 'ai_2' as any, 'Chaos', 0.5);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.PLAYER_CHOICE,
      playerId: 'ai_1' as any,
      description: '{T}: Draw two cards. Target opponent gains control of this creature.',
      mandatory: true,
      status: ResolutionStepStatus.PENDING,
      permanentId: 'humble_1',
      sourceId: 'humble_1',
      sourceName: 'Humble Defector',
      opponentOnly: true,
      effectData: { type: 'control_change', permanentId: 'humble_1', drawCards: 2 },
    } as any);

    const io = {
      to: () => ({ emit: () => undefined }),
    } as any;

    await handleAIGameFlow(io, gameId, 'ai_1' as any);

    const remaining = (ResolutionQueueManager.getQueue(gameId).steps || []).filter(
      (step: any) =>
        step?.playerId === 'ai_1'
        && String(step?.type || '') === ResolutionStepType.PLAYER_CHOICE
        && String(step?.status || '') === ResolutionStepStatus.PENDING,
    );
    expect(remaining).toHaveLength(0);
  });

  it('checkAndTriggerAI schedules a non-priority AI that has not kept in PRE_GAME', async () => {
    const pregameId = 'ai_resume_kick_pregame';
    const game = createInitialGameState(pregameId);
    games.set(pregameId, game as any);

    (game.state as any).players = [
      { id: 'human_1', name: 'Human', isAI: false },
      { id: 'ai_old', name: 'Chaos', isAI: true, difficulty: 0.5 },
      { id: 'ai_new', name: 'King', isAI: true, difficulty: 0.5 },
    ];
    (game.state as any).priority = 'ai_old';
    (game.state as any).turnPlayer = 'ai_old';
    (game.state as any).phase = 'PRE_GAME';
    (game.state as any).commandZone = {
      ai_old: { commanderIds: ['cmd_old'] },
      ai_new: { commanderIds: ['cmd_new'] },
    };
    (game.state as any).zones = {
      ai_old: { handCount: 7, hand: [{ id: 'h1' }] },
      ai_new: { handCount: 7, hand: [{ id: 'h2' }] },
    };
    (game.state as any).mulliganState = {
      ai_old: { hasKeptHand: true, mulligansTaken: 0 },
    };

    registerAIPlayer(pregameId, 'ai_old' as any, 'Chaos', 0.5);
    registerAIPlayer(pregameId, 'ai_new' as any, 'King', 0.5);

    const scheduleCalls: string[] = [];
    const io = { to: () => ({ emit: () => undefined }) } as any;

    const aiModule = await import('../src/socket/ai.js');
    const originalSchedule = aiModule.scheduleAIGameFlow;
    vi.spyOn(aiModule, 'scheduleAIGameFlow').mockImplementation(((_io, _gameId, playerId) => {
      scheduleCalls.push(String(playerId));
    }) as any);
    const prioritySpy = vi.spyOn(aiModule, 'scheduleAIPriority').mockImplementation((() => undefined) as any);

    checkAndTriggerAI(io, game as any, pregameId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(scheduleCalls).toContain('ai_new');
    expect(scheduleCalls).toContain('ai_old');
    expect(prioritySpy).not.toHaveBeenCalled();
    expect(typeof originalSchedule).toBe('function');

    cleanupGameAI(pregameId);
    games.delete(pregameId);
  });

  it('checkAndTriggerAI still kicks an unfinished PRE_GAME AI when a human holds priority', async () => {
    const pregameId = 'ai_resume_kick_pregame_human_priority';
    const game = createInitialGameState(pregameId);
    games.set(pregameId, game as any);

    (game.state as any).players = [
      { id: 'human_1', name: 'Human', isAI: false },
      { id: 'ai_restored', name: 'Chaos', isAI: true, difficulty: 0.5 },
    ];
    (game.state as any).priority = 'human_1';
    (game.state as any).turnPlayer = 'human_1';
    (game.state as any).phase = 'PRE_GAME';
    (game.state as any).commandZone = {
      ai_restored: { commanderIds: ['cmd_restored'] },
    };
    (game.state as any).zones = {
      ai_restored: { handCount: 7, hand: [{ id: 'h1' }] },
    };
    (game.state as any).mulliganState = {};

    registerAIPlayer(pregameId, 'ai_restored' as any, 'Chaos', 0.5);

    const scheduleCalls: string[] = [];
    const io = { to: () => ({ emit: () => undefined }) } as any;

    const aiModule = await import('../src/socket/ai.js');
    vi.spyOn(aiModule, 'scheduleAIGameFlow').mockImplementation(((_io, _gameId, playerId) => {
      scheduleCalls.push(String(playerId));
    }) as any);

    checkAndTriggerAI(io, game as any, pregameId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(scheduleCalls).toContain('ai_restored');

    cleanupGameAI(pregameId);
    games.delete(pregameId);
  });

  it('checkAndTriggerAI does not schedule AI while undo/restore is replaying', async () => {
    const restoringId = 'ai_resume_kick_restoring';
    const game = createInitialGameState(restoringId);
    games.set(restoringId, game as any);
    (game as any).isReplaying = true;

    (game.state as any).players = [
      { id: 'human_1', name: 'Human', isAI: false },
      { id: 'ai_1', name: 'Chaos', isAI: true, difficulty: 0.5 },
    ];
    (game.state as any).priority = 'ai_1';
    (game.state as any).turnPlayer = 'human_1';
    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).stack = [];

    registerAIPlayer(restoringId, 'ai_1' as any, 'Chaos', 0.5);

    const io = { to: () => ({ emit: () => undefined }) } as any;
    const aiModule = await import('../src/socket/ai.js');
    const prioritySpy = vi.spyOn(aiModule, 'scheduleAIPriority').mockImplementation((() => undefined) as any);

    checkAndTriggerAI(io, game as any, restoringId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(prioritySpy).not.toHaveBeenCalled();

    cleanupGameAI(restoringId);
    games.delete(restoringId);
  });
});
