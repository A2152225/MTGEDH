import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { sacrificePermanent } from '../src/state/modules/upkeep-triggers.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('sacrifice triggers (integration)', () => {
  const gameId = 'test_sacrifice_trigger_mirkwood_bats';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues token sacrifice triggers with sacrificed permanent context', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mirkwood_bats_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'mirkwood_bats_card',
          name: 'Mirkwood Bats',
          type_line: 'Creature - Bat',
          oracle_text: 'Flying\nWhenever you create or sacrifice a token, each opponent loses 1 life.',
          power: '2',
          toughness: '3',
          zone: 'battlefield',
        },
      },
      {
        id: 'treasure_token_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const sacrificedName = sacrificePermanent(game as any, 'treasure_token_1', p1);
    expect(sacrificedName).toBe('Treasure');

    expect((((game.state as any).battlefield || []) as any[]).some((perm: any) => perm?.id === 'treasure_token_1')).toBe(false);
    expect((game.state as any).permanentsSacrificedThisTurn?.[p1]).toBe(1);

    const sacrificeStackItems = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'mirkwood_bats_perm');
    expect(sacrificeStackItems).toHaveLength(1);
    expect(sacrificeStackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'you_sacrifice',
      sourceName: 'Mirkwood Bats',
      triggeringPlayer: p1,
      effect: 'each opponent loses 1 life.',
    }));
    expect(sacrificeStackItems[0]?.effectData?.sacrificedPermanentId).toBe('treasure_token_1');
    expect(sacrificeStackItems[0]?.effectData?.sacrificedPermanentWasToken).toBe(true);
    expect(sacrificeStackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'mirkwood_bats_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: 'Mirkwood Bats',
      }),
    }));
    expect(sacrificeStackItems[0]?.sacrificedPermanent).toEqual(expect.objectContaining({
      id: 'treasure_token_1',
      controller: p1,
      owner: p1,
      isToken: true,
      card: expect.objectContaining({
        name: 'Treasure',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Mirkwood Bats'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'mirkwood_bats_perm',
      controller: p1,
      owner: p1,
    }));
    expect(triggerEvents[0]?.payload?.sacrificedPermanent).toEqual(expect.objectContaining({
      id: 'treasure_token_1',
      controller: p1,
      owner: p1,
      isToken: true,
    }));

    game.resolveTopOfStack();

    expect((game.state.life as any)[p2]).toBe(39);
    expect((game.state as any).lifeLostThisTurn?.[p2]).toBe(1);
  });

  it('replays sacrifice trigger source and sacrificed permanent snapshots', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'sacrifice_source_snapshot_replay_trigger',
      sourceId: 'mirkwood_bats_perm',
      sourceName: 'Mirkwood Bats',
      controllerId: p1,
      description: 'each opponent loses 1 life',
      triggerType: 'you_sacrifice',
      effect: 'each opponent loses 1 life.',
      mandatory: true,
      targetPlayer: p1,
      triggeringPlayer: p1,
      effectData: {
        sacrificingPlayerId: p1,
        sacrificedPermanentId: 'treasure_token_1',
        sacrificedCardName: 'Treasure',
        sacrificedPermanentWasToken: true,
      },
      sourcePermanentSnapshot: {
        id: 'mirkwood_bats_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'mirkwood_bats_card',
          name: 'Mirkwood Bats',
          type_line: 'Creature - Bat',
        },
      },
      sacrificedPermanent: {
        id: 'treasure_token_1',
        controller: p1,
        owner: p1,
        isToken: true,
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
        },
      },
    } as any);

    const replayed = ((game.state as any).stack || []).find((item: any) => item?.id === 'sacrifice_source_snapshot_replay_trigger');
    expect(replayed?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'mirkwood_bats_perm',
      controller: p1,
      owner: p1,
    }));
    expect(replayed?.sacrificedPermanent).toEqual(expect.objectContaining({
      id: 'treasure_token_1',
      controller: p1,
      owner: p1,
      isToken: true,
    }));
    expect(replayed?.effectData).toEqual(expect.objectContaining({
      sacrificingPlayerId: p1,
      sacrificedPermanentId: 'treasure_token_1',
    }));
  });

  it('queues simultaneous sacrifice triggers in APNAP order', () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).activePlayer = p3;
    (game.state as any).turnPlayer = p3;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p3]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'p1_sac_trigger_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'p1_sac_trigger_card',
          name: 'P1 Sac Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player sacrifices a permanent, you gain 1 life.',
        },
      },
      {
        id: 'p3_sac_trigger_perm',
        controller: p3,
        owner: p3,
        tapped: false,
        counters: {},
        card: {
          id: 'p3_sac_trigger_card',
          name: 'P3 Sac Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player sacrifices a permanent, you gain 1 life.',
        },
      },
      {
        id: 'treasure_token_1',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const sacrificedName = sacrificePermanent(game as any, 'treasure_token_1', p2);
    expect(sacrificedName).toBe('Treasure');

    expect((((game.state as any).stack || []) as any[]).map((item: any) => item.sourceName)).toEqual([
      'P3 Sac Trigger',
      'P1 Sac Trigger',
    ]);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && (
        event?.payload?.sourceName === 'P1 Sac Trigger' ||
        event?.payload?.sourceName === 'P3 Sac Trigger'
      )
    );
    expect(triggerEvents.map((event: any) => event?.payload?.sourceName)).toEqual([
      'P3 Sac Trigger',
      'P1 Sac Trigger',
    ]);
  });
});