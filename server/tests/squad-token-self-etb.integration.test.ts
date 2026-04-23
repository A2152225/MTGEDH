import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import { deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  await deleteGame(gameId);
}

describe('Squad token self ETB persistence', () => {
  const gameId = 'test_squad_token_self_etb';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues and persists self ETB triggers for Squad token copies', () => {
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId, name: 'Player 1' } as any);
    game.applyEvent({ type: 'join', playerId: opponentId, name: 'Player 2' } as any);

    (game.state as any).phase = 'main1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [
      {
        id: 'spell_squad_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'squad_card_1',
          name: 'Squad Visionary',
          type_line: 'Creature - Human Wizard',
          oracle_text: 'When Squad Visionary enters, draw a card.\nSquad {0}',
          power: '2',
          toughness: '2',
          squadTimesPaid: 2,
          zone: 'stack',
        },
        targets: [],
      },
    ];

    const eventStart = getEvents(gameId).length;

    game.resolveTopOfStack();

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const tokens = battlefield.filter((permanent: any) => permanent?.isToken === true);
    const tokenIds = tokens.map((permanent: any) => String(permanent?.id || '')).sort();
    expect(tokens).toHaveLength(2);

    const liveTokenTriggers = ((game.state as any).stack || []).filter(
      (entry: any) => entry?.sourceName === 'Squad Visionary' && tokenIds.includes(String(entry?.source || '')),
    );
    expect(liveTokenTriggers).toHaveLength(2);

    const persistedTokenTriggers = getEvents(gameId)
      .slice(eventStart)
      .filter(
        (event: any) =>
          event.type === 'pushTriggeredAbility' &&
          event.payload?.sourceName === 'Squad Visionary' &&
          tokenIds.includes(String(event.payload?.sourceId || '')),
      );
    expect(persistedTokenTriggers).toHaveLength(2);
  });
});