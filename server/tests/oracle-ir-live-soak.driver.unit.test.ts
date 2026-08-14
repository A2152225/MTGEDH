import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initDb } from '../src/db/index.js';
import {
  castLiveSoakCard,
  createLiveSoakSession,
  endLiveSoakSession,
} from '../src/oracleIrLiveSoak.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const created: string[] = [];

describe('oracle IR live soak driver', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    for (const gameId of created.splice(0, created.length)) {
      try {
        await endLiveSoakSession(gameId);
      } catch {
        ResolutionQueueManager.removeQueue(gameId);
      }
    }
  });

  it('creates a table with AI seats, imports a deck, and free-casts Opt onto the live path', async () => {
    const session = await createLiveSoakSession({
      playerCount: 2,
      soakId: 'driver-opt',
      cardNames: ['Opt'],
    });
    created.push(session.gameId);

    expect(session.humanPlayerId).toBeTruthy();
    expect(session.aiPlayerIds.length).toBe(1);

    const cast = await castLiveSoakCard({
      gameId: session.gameId,
      cardName: 'Opt',
      setup: 'main',
    });

    expect(cast.found).toBe(true);
    const queueTypes = cast.queuedSteps.map((step) => step.type);
    const onStack = cast.stack.some((item) => item.name === 'Opt');
    const leftHand = !cast.handNames.includes('Opt');
    expect(queueTypes.includes('scry') || onStack || leftHand).toBe(true);
    expect(cast.telemetryEvents).toEqual([]);
  }, 30000);

  it('provisions a creature and a stack spell so Path / Force Spike can actually start', async () => {
    const session = await createLiveSoakSession({
      playerCount: 2,
      soakId: 'driver-board',
      cardNames: ['Path to Exile', 'Force Spike'],
    });
    created.push(session.gameId);

    const path = await castLiveSoakCard({
      gameId: session.gameId,
      cardName: 'Path to Exile',
      setup: 'main',
    });
    const pathQueues = [...new Set([...(path.queuedSteps || []).map((step) => step.type), ...(path.seenQueueTypes || [])])];
    const pathError = (path.errors || []).map((entry) => entry.code).join(';');
    expect(path.found).toBe(true);
    expect(pathError).not.toContain('NO_VALID_TARGETS');
    expect(
      pathQueues.includes('target_selection')
      || pathQueues.includes('library_search')
      || path.stack.some((item) => item.name === 'Path to Exile')
      || !path.handNames.includes('Path to Exile'),
    ).toBe(true);

    const spike = await castLiveSoakCard({
      gameId: session.gameId,
      cardName: 'Force Spike',
      setup: 'main',
    });
    const spikeQueues = [...new Set([...(spike.queuedSteps || []).map((step) => step.type), ...(spike.seenQueueTypes || [])])];
    const spikeError = (spike.errors || []).map((entry) => entry.code).join(';');
    expect(spike.found).toBe(true);
    expect(spikeError).not.toContain('NO_VALID_TARGETS');
    expect(
      spikeQueues.includes('target_selection')
      || spike.stack.some((item) => item.name === 'Force Spike')
      || !spike.handNames.includes('Force Spike'),
    ).toBe(true);
  }, 30000);

  it('injects named permanents with real oracle and fires mill / search / combat', async () => {
    const session = await createLiveSoakSession({
      playerCount: 3,
      soakId: 'driver-inject',
      cardNames: ['Bruvac the Grandiloquent', 'Leonin Arbiter', 'Szadek, Lord of Secrets'],
    });
    created.push(session.gameId);

    const mill = await castLiveSoakCard({
      gameId: session.gameId,
      cardName: 'Bruvac the Grandiloquent',
      setup: 'main',
      action: 'mill',
      millCount: 3,
      inject: [{ name: 'Bruvac the Grandiloquent', controller: 'human' }],
    });
    expect(mill.found).toBe(true);
    expect(mill.board?.millApplied).toBe(6);
    expect(mill.board?.millOpponent).toBe(6);
    expect(mill.board?.millOther).toBe(0);
    expect(mill.telemetryEvents).toEqual([]);

    const search = await castLiveSoakCard({
      gameId: session.gameId,
      cardName: 'Leonin Arbiter',
      setup: 'main',
      action: 'search',
      inject: [{ name: 'Leonin Arbiter', controller: 'ai' }],
    });
    expect(search.found).toBe(true);
    expect(search.board?.search?.canSearch).toBe(true);
    expect(search.board?.search?.paymentAmount).toBe('{2}');
    expect(search.telemetryEvents).toEqual([]);

    const combat = await castLiveSoakCard({
      gameId: session.gameId,
      cardName: 'Szadek, Lord of Secrets',
      setup: 'main',
      action: 'combat',
      inject: [{ name: 'Szadek, Lord of Secrets', controller: 'human', attacking: true }],
    });
    expect(combat.found).toBe(true);
    expect(combat.board?.lifeUnchanged).toBe(true);
    expect(Number(combat.board?.millOpponent || 0)).toBeGreaterThan(0);
    expect(Number(combat.board?.attackerPlusOne || 0)).toBeGreaterThan(0);
    expect(combat.board?.millOther).toBe(0);
    expect(combat.telemetryEvents).toEqual([]);
  }, 60000);
});
