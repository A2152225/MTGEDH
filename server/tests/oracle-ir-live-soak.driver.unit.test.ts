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
    expect(cast.telemetryEvents).toEqual([]);
  }, 30000);
});
