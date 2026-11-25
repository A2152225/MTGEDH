/**
 * Live-path routing for the AI builder fixes: handleAIResolutionStep (resolution.ts) must send
 * COUNTER_DISTRIBUTION steps to the target-selection builder (a { targetId: amount } object) and
 * Phyrexian MANA_PAYMENT_CHOICE steps to chooseAIPhyrexianManaChoiceSelections, instead of the
 * generic empty decline / no response it used before.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { handleAIResolutionStep } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';

const io = { to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }), emit: (_event: string, _payload: any) => undefined } as any;
const gameId = 'test_ai_resolution_live_routing';
const playerId = 'ai1';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function setupGame(life = 40) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const state = game.state as any;
  state.players = [
    { id: playerId, name: 'AI', spectator: false, life },
    { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
  ];
  state.life = { [playerId]: life, opp1: 40 };
  state.turnPlayer = playerId;
  state.priority = playerId;
  state.phase = 'main';
  state.step = 'precombat_main';
  state.stack = [];
  state.battlefield = [
    { id: 'own_bears', controller: playerId, owner: playerId, tapped: false, counters: {}, card: { id: 'own_bears_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } },
    { id: 'opp_giant', controller: 'opp1', owner: 'opp1', tapped: false, counters: {}, card: { id: 'opp_giant_card', name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3' } },
  ];
  return game;
}

/** Runs the step through handleAIResolutionStep and captures the response it submits (side effects skipped). */
async function answerFromLivePath(stepInput: Record<string, any>) {
  const queued = ResolutionQueueManager.addStep(gameId, { playerId, description: 'test', mandatory: true, ...stepInput } as any);
  ResolutionQueueManager.activateStep(gameId, queued.id);
  const submitted: Array<{ stepId: string; response: any }> = [];
  const spy = vi.spyOn(ResolutionQueueManager, 'completeStep').mockImplementation(((_game: string, stepId: string, response: any) => {
    submitted.push({ stepId, response });
    return false;
  }) as any);
  try {
    await handleAIResolutionStep(io, gameId, queued, { force: true });
  } finally {
    spy.mockRestore();
  }
  return submitted.find((entry) => String(entry.stepId) === String(queued.id))?.response;
}

describe('handleAIResolutionStep live routing for AI builder fixes', () => {
  beforeAll(async () => {
    await initDb();
  });
  beforeEach(resetGame);
  afterEach(resetGame);

  it('answers COUNTER_DISTRIBUTION through the target-selection builder with a target-to-amount object', async () => {
    setupGame();
    const response = await answerFromLivePath({
      type: ResolutionStepType.COUNTER_DISTRIBUTION,
      totalAmount: 3,
      minPerTarget: 1,
      counterType: '+1/+1',
      validTargets: [{ id: 'opp_giant' }, { id: 'own_bears' }],
    });
    expect(response?.cancelled).toBe(false);
    expect(response?.selections).toEqual({ own_bears: 3 });
  });

  it('answers a Phyrexian MANA_PAYMENT_CHOICE with an index/payWithLife array', async () => {
    setupGame();
    const response = await answerFromLivePath({
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      phyrexianManaChoice: true,
      parsedCost: { colors: {}, generic: 0 },
      phyrexianCosts: [['B', 'LIFE:2']],
    });
    expect(response?.cancelled).toBe(false);
    expect(response?.selections).toEqual([{ index: 0, payWithLife: true }]);
  });

  it('does not pay Phyrexian costs with lethal life on the live path', async () => {
    setupGame(2);
    const response = await answerFromLivePath({
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      phyrexianManaChoice: true,
      parsedCost: { colors: {}, generic: 0 },
      phyrexianCosts: [['B', 'LIFE:2']],
    });
    expect(response?.selections).toEqual([{ index: 0, payWithLife: false }]);
  });

  it('still leaves other MANA_PAYMENT_CHOICE prompts unanswered', async () => {
    setupGame();
    const response = await answerFromLivePath({ type: ResolutionStepType.MANA_PAYMENT_CHOICE });
    expect(response).toBeUndefined();
  });
});
