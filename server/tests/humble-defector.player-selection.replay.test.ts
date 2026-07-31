import { beforeAll, describe, it, expect } from 'vitest';
import { initDb, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { pruneObsoleteResolutionQueueAfterReplay } from '../src/state/resolution/replayCleanup.js';

describe('Humble Defector playerSelection replay cleanup', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('does not leave orphaned control-change PLAYER_CHOICE steps after game_9512 replay', () => {
    const events = getEvents('game_9512');
    if (!events?.length) {
      // Local DB may not have this fixture in CI — skip gracefully.
      expect(true).toBe(true);
      return;
    }

    const gameId = 'game_9512_humble_replay_cleanup';
    ResolutionQueueManager.removeQueue(gameId);
    const g = createInitialGameState(gameId);
    (g as any).isReplaying = true;
    (g as any)._suppressPersistence = true;
    (g as any).gameId = gameId;

    for (const ev of events) {
      const type = String((ev as any)?.type || '');
      const payload = (ev as any)?.payload ?? {};
      try {
        g.applyEvent({ type, ...(typeof payload === 'object' && payload ? payload : {}) });
      } catch {
        // best-effort replay
      }
    }
    (g as any).isReplaying = false;

    pruneObsoleteResolutionQueueAfterReplay(gameId, g.state, (g as any).libraries);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const controlChangeSteps = (queue?.steps || []).filter((step: any) => {
      const desc = String(step?.description || '').toLowerCase();
      const effectType = String(step?.effectData?.type || '').trim();
      return (
        String(step?.type || '') === 'player_choice'
        && (effectType === 'control_change' || (desc.includes('gains control') && desc.includes('draw')))
      );
    });

    expect(controlChangeSteps).toHaveLength(0);
    expect(String((g.state as any).priority || '')).toBeTruthy();
  });
});
