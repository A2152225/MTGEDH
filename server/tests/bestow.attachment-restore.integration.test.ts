import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

describe('Bestow attachment restore (integration)', () => {
  const gameId = 'test_bestow_attachment_restore';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('persists bestowed attachment state so restore rebuilds attachedTo and target attachments', () => {
    const persistentGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    ResolutionQueueManager.removeQueue(persistentGameId);
    games.delete(persistentGameId as any);

    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachments: [],
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'spell_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'bestow_card_1',
          name: 'Hypnotic Siren',
          type_line: 'Enchantment Creature - Siren',
          oracle_text: 'Bestow {5}{U}{U}\nEnchant creature\nFlying\nYou control enchanted creature.\nEnchanted creature gets +1/+1 and has flying.',
          zone: 'stack',
          power: '1',
          toughness: '1',
        },
        targets: ['creature_1'],
      },
    ];

    game.resolveTopOfStack();

    const bestowPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry.card?.name === 'Hypnotic Siren');
    const targetCreature = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'creature_1');
    expect(bestowPermanent?.attachedTo).toBe('creature_1');
    expect(targetCreature?.attachments || []).toContain(bestowPermanent?.id);

    const persisted = [...getEvents(persistentGameId)].reverse().find((event: any) => event.type === 'attachEnchantmentPermanent') as any;
    expect(persisted?.payload?.enchantmentName).toBe('Hypnotic Siren');
    expect(persisted?.payload?.targetPermanentId).toBe('creature_1');

    const replayGame = createInitialGameState(`${persistentGameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (replayGame.state as any).battlefield = [
      {
        id: String(persisted?.payload?.enchantmentId || 'bestow_1'),
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'bestow_card_1',
          name: 'Hypnotic Siren',
          type_line: 'Enchantment Creature - Siren',
          oracle_text: 'Bestow {5}{U}{U}\nEnchant creature\nFlying\nYou control enchanted creature.\nEnchanted creature gets +1/+1 and has flying.',
          zone: 'battlefield',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachments: [],
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];

    replayGame.applyEvent({ type: 'attachEnchantmentPermanent', ...(persisted.payload || {}) } as any);

    const replayBestow = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.card?.name === 'Hypnotic Siren');
    const replayTarget = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'creature_1');
    expect(replayBestow?.attachedTo).toBe('creature_1');
    expect(replayTarget?.attachments || []).toContain(String(persisted?.payload?.enchantmentId || ''));
  });
});