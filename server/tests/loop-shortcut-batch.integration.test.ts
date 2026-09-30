/**
 * Server-side Loop Shortcut batch: N iterations without client round-trips.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { executeLoopShortcutBatch } from '../src/socket/loopShortcutBatch.js';

function createNoopIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Loop Shortcut batch execute', () => {
  let testSeq = 0;
  let gameId = '';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
  });

  beforeEach(async () => {
    testSeq += 1;
    gameId = `test_loop_shortcut_batch_${testSeq}`;
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
  });

  afterEach(async () => {
    if (gameId) await resetGame(gameId);
  });

  it('runs Ashnod\'s Altar ×3 via server batch (sacrifice + mana, no mid-batch broadcast)', async () => {
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    const bears = Array.from({ length: 5 }, (_, i) => ({
      id: `bear_${i}`,
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSickness: false,
      isToken: true,
      card: {
        id: `bear_card_${i}`,
        name: 'Merfolk Token',
        type_line: 'Creature — Merfolk',
        oracle_text: '',
        power: '1',
        toughness: '1',
        isToken: true,
      },
    }));
    (game.state as any).battlefield = [
      {
        id: 'altar_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'altar_card',
          name: "Ashnod's Altar",
          type_line: 'Artifact',
          oracle_text: 'Sacrifice a creature: Add {C}{C}.',
        },
      },
      ...bears,
    ];
    (game.state as any).zones = {
      [playerId]: { hand: [], graveyard: [], library: [], exile: [] },
    };

    const io = createNoopIo();
    const result = await executeLoopShortcutBatch({
      io,
      gameId,
      playerId,
      name: 'Altar loop',
      iterations: 3,
      items: [
        {
          kind: 'emit',
          event: 'activateBattlefieldAbility',
          payload: {
            gameId,
            permanentId: 'altar_1',
            abilityId: 'ability-0',
          },
          label: "Ashnod's Altar",
        },
        {
          kind: 'resolution_response',
          fingerprint: {
            stepType: 'target_selection',
            sourceName: "Ashnod's Altar",
          },
          template: {
            kind: 'select_valid_targets',
            count: 1,
            preferTokens: true,
          },
          label: 'Sacrifice a creature',
        },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.iterationsCompleted).toBe(3);
    expect(((game.state as any).manaPool?.[playerId]?.colorless) || 0).toBe(6);
    expect(((game.state as any).battlefield || []).filter((p: any) => String(p.id || '').startsWith('bear_'))).toHaveLength(2);
    expect(Number((game.state as any)._suppressBroadcastCount || 0)).toBe(0);
    expect((game.state as any).loopShortcutStackDrain?.[playerId]).toBeUndefined();
  });

  it('stops cleanly when the loop runs out of legal sacrifices', async () => {
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'altar_1',
        controller: playerId,
        owner: playerId,
        card: {
          id: 'altar_card',
          name: "Ashnod's Altar",
          type_line: 'Artifact',
          oracle_text: 'Sacrifice a creature: Add {C}{C}.',
        },
      },
      {
        id: 'bear_0',
        controller: playerId,
        owner: playerId,
        isToken: true,
        card: {
          id: 'bear_card_0',
          name: 'Merfolk Token',
          type_line: 'Creature — Merfolk',
          power: '1',
          toughness: '1',
          isToken: true,
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: { hand: [], graveyard: [], library: [], exile: [] },
    };

    const result = await executeLoopShortcutBatch({
      io: createNoopIo(),
      gameId,
      playerId,
      iterations: 5,
      items: [
        {
          kind: 'emit',
          event: 'activateBattlefieldAbility',
          payload: { gameId, permanentId: 'altar_1', abilityId: 'ability-0' },
          label: "Ashnod's Altar",
        },
        {
          kind: 'resolution_response',
          fingerprint: {
            stepType: 'target_selection',
            sourceName: "Ashnod's Altar",
          },
          template: {
            kind: 'select_valid_targets',
            count: 1,
            preferTokens: true,
          },
          label: 'Sacrifice a creature',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.iterationsCompleted).toBe(1);
    expect(((game.state as any).manaPool?.[playerId]?.colorless) || 0).toBe(2);
    expect(result.error).toBeTruthy();
  });

  it('caps non-sustaining loops at 50 and writes a compressed replay event', async () => {
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    const bears = Array.from({ length: 60 }, (_, i) => ({
      id: `bear_${i}`,
      controller: playerId,
      owner: playerId,
      isToken: true,
      card: {
        id: `bear_card_${i}`,
        name: 'Merfolk Token',
        type_line: 'Creature — Merfolk',
        power: '1',
        toughness: '1',
        isToken: true,
      },
    }));
    (game.state as any).battlefield = [
      {
        id: 'altar_1',
        controller: playerId,
        owner: playerId,
        card: {
          id: 'altar_card',
          name: "Ashnod's Altar",
          type_line: 'Artifact',
          oracle_text: 'Sacrifice a creature: Add {C}{C}.',
        },
      },
      ...bears,
    ];
    (game.state as any).zones = {
      [playerId]: { hand: [], graveyard: [], library: [], exile: [] },
    };

    const result = await executeLoopShortcutBatch({
      io: createNoopIo(),
      gameId,
      playerId,
      iterations: 200,
      items: [
        {
          kind: 'emit',
          event: 'activateBattlefieldAbility',
          payload: { gameId, permanentId: 'altar_1', abilityId: 'ability-0' },
          label: "Ashnod's Altar",
        },
        {
          kind: 'resolution_response',
          fingerprint: {
            stepType: 'target_selection',
            sourceName: "Ashnod's Altar",
          },
          template: {
            kind: 'select_valid_targets',
            count: 1,
            preferTokens: true,
          },
          label: 'Sacrifice a creature',
        },
      ],
    });

    expect(result.selfSustaining).toBe(false);
    expect(result.cappedForSustainability).toBe(true);
    expect(result.compressed).toBe(true);
    expect(result.iterationsCompleted).toBe(50);
    expect(((game.state as any).manaPool?.[playerId]?.colorless) || 0).toBe(100);
    expect(
      ((game.state as any).battlefield || []).filter((p: any) => String(p.id || '').startsWith('bear_')),
    ).toHaveLength(10);

    const { getEvents } = await import('../src/db/index.js');
    const events = getEvents(gameId);
    const types = events.map((e) => e.type);
    expect(types).toContain('loopShortcutBatchApply');
    expect(types.filter((t) => t === 'activateBattlefieldAbility').length).toBe(0);
    const apply = events.find((e) => e.type === 'loopShortcutBatchApply') as any;
    expect(apply?.payload?.iterationsCompleted).toBe(50);
    expect(apply?.payload?.statePatch?.battlefield).toBeTruthy();
    // 50 real activations take ~2 minutes on a loaded machine; the 120s global default is too tight.
  }, 600_000);
});
