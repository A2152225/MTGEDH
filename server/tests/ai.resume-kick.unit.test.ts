import { afterEach, describe, expect, it, vi } from 'vitest';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { ResolutionStepStatus, ResolutionStepType } from '../src/state/resolution/types.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { handleAIGameFlow, cleanupGameAI, registerAIPlayer } from '../src/socket/ai.js';
import { checkAndTriggerAI } from '../src/socket/util.js';

describe('AI resume kick after reconnect', () => {
  const gameId = 'ai_resume_kick_priority';

  afterEach(() => {
    cleanupGameAI(gameId);
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId);
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
    const originalSchedule = aiModule.scheduleAIGameFlow;
    vi.spyOn(aiModule, 'scheduleAIGameFlow').mockImplementation(((_io, _gameId, playerId) => {
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
});
