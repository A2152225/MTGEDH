import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { cleanupGameAI, registerAIPlayer, scheduleAIPriority, unregisterAIPlayer } from '../src/socket/ai.js';
import { getAIHandlerDeps, setAIHandlerDeps } from '../src/socket/aiHandlerDeps.js';
import { aiPriorityWillPass, clearAIFastPassDecisionsForTests } from '../src/socket/ai-handlers/aiFastPassPrecheck.js';
import { clearScheduledAIActionsForGame } from '../src/socket/ai-handlers/aiScheduler.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

// Robert, Oct 11: an AI that is handed priority and won't act should pass immediately instead of
// sitting through the ~300ms reaction pacing (G1.txt: two AIs ping-ponging every combat step).
// Pacing stays in front of real actions.
const ai = 'ai1';
const tracked: string[] = [];
const io: any = { to: () => ({ emit: () => undefined }), emit: () => undefined };

function land(id: string) {
  return {
    id, controller: ai, owner: ai, tapped: false, summoningSickness: false, counters: {},
    card: { id: `${id}_c`, name: 'Island', type_line: 'Basic Land - Island', oracle_text: '{T}: Add {U}.' },
  };
}

function seed(label: string, withResponse: boolean) {
  const gameId = `test_ai_fast_pass_${label}_${Math.random().toString(36).slice(2, 8)}`;
  tracked.push(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId);
  const zone = (hand: any[]) => ({ hand, handCount: hand.length, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 });
  game.state.players = [
    { id: ai, name: 'AI', spectator: false, isAI: true, life: 40 },
    { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
  ];
  game.state.turnPlayer = 'opp1';
  game.state.activePlayer = 'opp1';
  game.state.priority = ai;
  game.state.phase = 'combat';
  game.state.step = 'BEGIN_COMBAT';
  game.state.stack = [];
  game.state.manaPool = { [ai]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
  game.state.battlefield = withResponse ? [land('island_1')] : [];
  game.state.zones = {
    [ai]: zone(withResponse ? [{ id: 'opt_hand', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1, then draw a card.', mana_cost: '{U}', cmc: 1, zone: 'hand' }] : []),
    opp1: zone([]),
  };
  registerAIPlayer(gameId, ai as any);
  return { gameId, game };
}

async function timeUntilHandlerRuns(gameId: string, budgetMs: number): Promise<number | null> {
  const realHandler = getAIHandlerDeps().handleAIPriority;
  const start = Date.now();
  let ranAt: number | null = null;
  setAIHandlerDeps({ handleAIPriority: async () => { ranAt = Date.now() - start; } });
  try {
    scheduleAIPriority(io, gameId, ai as any, 300);
    while (ranAt === null && Date.now() - start < budgetMs) await new Promise((r) => setTimeout(r, 5));
    return ranAt;
  } finally {
    setAIHandlerDeps({ handleAIPriority: realHandler });
  }
}

describe('AI fast pass: no pacing delay when the AI will just pass', () => {
  beforeAll(async () => { await initDb(); });
  afterEach(async () => {
    clearAIFastPassDecisionsForTests();
    for (const gameId of tracked.splice(0)) {
      clearScheduledAIActionsForGame(gameId);
      cleanupGameAI(gameId);
      unregisterAIPlayer(gameId, ai as any);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
  });

  it('an AI with nothing to do is run immediately instead of after the 300ms delay', async () => {
    const { gameId } = seed('idle', false);
    expect(await aiPriorityWillPass(gameId, ai as any)).toBe(true);
    clearAIFastPassDecisionsForTests();
    const elapsed = await timeUntilHandlerRuns(gameId, 1000);
    expect(elapsed).not.toBeNull();
    expect(elapsed!).toBeLessThan(150);
  });

  it('end to end: the idle AI has passed priority well before the pacing delay would end', async () => {
    const { gameId, game } = seed('idle_e2e', false);
    scheduleAIPriority(io, gameId, ai as any, 300);
    const start = Date.now();
    while (game.state.priority === ai && Date.now() - start < 1000) await new Promise((r) => setTimeout(r, 5));
    expect(game.state.priority).not.toBe(ai);
    expect(Date.now() - start).toBeLessThan(250);
  });

  it('an AI that will act (castable instant) still waits for the pacing delay', async () => {
    const { gameId } = seed('acting', true);
    expect(await aiPriorityWillPass(gameId, ai as any)).toBe(false);
    const elapsed = await timeUntilHandlerRuns(gameId, 1500);
    expect(elapsed).not.toBeNull();
    expect(elapsed!).toBeGreaterThanOrEqual(280);
  });

  it('own turn with an empty stack keeps the pacing (land/attack/advance decisions)', async () => {
    const { gameId, game } = seed('own_turn', false);
    game.state.turnPlayer = ai;
    game.state.activePlayer = ai;
    expect(await aiPriorityWillPass(gameId, ai as any)).toBe(false);
  });
});
