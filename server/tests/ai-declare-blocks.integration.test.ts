import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { cleanupGameAI, registerAIPlayer, scheduleAIPriority, unregisterAIPlayer } from '../src/socket/ai.js';
import { aiPriorityWillPass, clearAIFastPassDecisionsForTests } from '../src/socket/ai-handlers/aiFastPassPrecheck.js';
import { clearScheduledAIActionsForGame } from '../src/socket/ai-handlers/aiScheduler.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

// Robert, Oct 11: "AIs never block". The defending AI must get a real block decision (no fast
// pass at DECLARE_BLOCKERS) and the declaration must reach the battlefield.
const ai = 'ai1';
const tracked: string[] = [];
const io: any = { to: () => ({ emit: () => undefined }), emit: () => undefined };

function creature(id: string, controller: string, p: string, t: string, extra: Record<string, any> = {}) {
  return {
    id, controller, owner: controller, tapped: false, summoningSickness: false, counters: {},
    basePower: Number(p), baseToughness: Number(t),
    card: { id: `${id}_c`, name: id, type_line: 'Creature — Beast', power: p, toughness: t, oracle_text: extra.oracle_text || '' },
    ...extra,
  };
}

function seed(battlefield: any[], life = 40) {
  const gameId = `test_ai_blocks_${Math.random().toString(36).slice(2, 8)}`;
  tracked.push(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId);
  const zone = () => ({ hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 });
  game.state.players = [
    { id: ai, name: 'AI', spectator: false, isAI: true, life },
    { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
  ];
  game.state.life = { [ai]: life, opp1: 40 };
  game.state.turnPlayer = 'opp1';
  game.state.activePlayer = 'opp1';
  game.state.priority = ai;
  game.state.phase = 'combat';
  game.state.step = 'DECLARE_BLOCKERS';
  game.state.blockersDeclaredBy = [];
  game.state.stack = [];
  game.state.battlefield = battlefield;
  game.state.zones = { [ai]: zone(), opp1: zone() };
  registerAIPlayer(gameId, ai as any);
  return { gameId, game };
}

async function waitDeclared(game: any) {
  const start = Date.now();
  while (!(game.state.blockersDeclaredBy || []).includes(ai) && String(game.state.step) === 'DECLARE_BLOCKERS' && Date.now() - start < 12000) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('AI declares real blocks on the server', () => {
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

  it('the fast-pass precheck never skips the declare-blockers decision', async () => {
    const { gameId } = seed([creature('bear', 'opp1', '3', '3', { attacking: ai }), creature('wall', ai, '1', '4')]);
    expect(await aiPriorityWillPass(gameId, ai as any)).toBe(false);
  });

  it('a free block is declared and stamped on the battlefield', async () => {
    const attacker = creature('bear', 'opp1', '3', '3', { attacking: ai });
    const wall = creature('wall', ai, '1', '4');
    const { gameId, game } = seed([attacker, wall]);
    scheduleAIPriority(io, gameId, ai as any, 0);
    await waitDeclared(game);
    expect((wall as any).blocking).toEqual(['bear']);
    expect((attacker as any).blockedBy).toEqual(['wall']);
  }, 30000);

  it('chumps a lethal attacker using state.life (not a stale players[].life)', async () => {
    const attacker = creature('giant', 'opp1', '9', '9', { attacking: ai });
    const token = creature('token', ai, '1', '1');
    const { gameId, game } = seed([attacker, token], 40);
    game.state.life[ai] = 5; // players[].life still says 40
    scheduleAIPriority(io, gameId, ai as any, 0);
    await waitDeclared(game);
    expect((token as any).blocking).toEqual(['giant']);
  }, 30000);
});

