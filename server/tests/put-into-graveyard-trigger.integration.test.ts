import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { recordCardPutIntoGraveyardThisTurn } from '../src/state/modules/turn-tracking.js';

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

describe('put-into-graveyard triggers (integration)', () => {
  const gameId = 'test_put_into_graveyard_trigger_vulturous_zombie';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues Vulturous Zombie-style triggers with graveyard card context', () => {
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
        id: 'vulturous_zombie_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'vulturous_zombie_card',
          name: 'Vulturous Zombie',
          type_line: 'Creature - Plant Zombie',
          oracle_text: "Flying\nWhenever a card is put into an opponent's graveyard from anywhere, put a +1/+1 counter on this creature.",
          power: '3',
          toughness: '3',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const milledCard = {
      id: 'milled_card',
      name: 'Island',
      type_line: 'Basic Land - Island',
      oracle_text: '',
      zone: 'graveyard',
    };
    (game.state as any).zones[p2].graveyard.push(milledCard);
    (game.state as any).zones[p2].graveyardCount = 1;

    recordCardPutIntoGraveyardThisTurn(game as any, p2, milledCard, { fromBattlefield: false });

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'card_put_into_graveyard',
      sourceName: 'Vulturous Zombie',
      effect: 'put a +1/+1 counter on this creature.',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      graveyardCardId: 'milled_card',
      graveyardCardName: 'Island',
      graveyardCardOwner: p2,
      graveyardCardController: p2,
      graveyardCardTypeLine: 'Basic Land - Island',
      fromZone: 'nonbattlefield',
      toZone: 'graveyard',
    }));
    expect(stackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'vulturous_zombie_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: 'Vulturous Zombie',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Vulturous Zombie'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload).toMatchObject({
      sourceId: 'vulturous_zombie_perm',
      permanentId: 'vulturous_zombie_perm',
    });
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'vulturous_zombie_perm',
      controller: p1,
      owner: p1,
    }));

    (game.state as any).stack = [];
    game.applyEvent({ type: 'pushTriggeredAbility', ...(triggerEvents[0]?.payload || {}) } as any);

    const replayedTrigger = (((game.state as any).stack || []) as any[]).find((item: any) => item?.source === 'vulturous_zombie_perm');
    expect(replayedTrigger).toEqual(expect.objectContaining({
      source: 'vulturous_zombie_perm',
      permanentId: 'vulturous_zombie_perm',
      effectData: expect.objectContaining({
        graveyardCardId: 'milled_card',
      }),
    }));

    game.resolveTopOfStack();

    const vulturousZombie = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === 'vulturous_zombie_perm');
    expect(vulturousZombie?.counters?.['+1/+1']).toBe(1);
  });

  it('orders simultaneous graveyard triggers by APNAP before stack push', () => {
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
    (game.state as any).activePlayer = p1;
    (game.state as any).turnPlayer = p1;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p3]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'nonactive_vulturous_zombie_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'nonactive_vulturous_zombie_card',
          name: 'Nonactive Vulturous Zombie',
          type_line: 'Creature - Plant Zombie',
          oracle_text: "Whenever a card is put into an opponent's graveyard from anywhere, put a +1/+1 counter on this creature.",
        },
      },
      {
        id: 'active_vulturous_zombie_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'active_vulturous_zombie_card',
          name: 'Active Vulturous Zombie',
          type_line: 'Creature - Plant Zombie',
          oracle_text: "Whenever a card is put into an opponent's graveyard from anywhere, put a +1/+1 counter on this creature.",
        },
      },
    ];
    (game.state as any).stack = [];

    const milledCard = {
      id: 'p3_milled_card',
      name: 'Island',
      type_line: 'Basic Land - Island',
      oracle_text: '',
      zone: 'graveyard',
    };

    recordCardPutIntoGraveyardThisTurn(game as any, p3, milledCard, { fromBattlefield: false });

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems.map((item) => item.source)).toEqual([
      'active_vulturous_zombie_perm',
      'nonactive_vulturous_zombie_perm',
    ]);

    const triggerEvents = getEvents(gameId).filter((event: any) => event?.type === 'pushTriggeredAbility');
    expect(triggerEvents.map((event: any) => event?.payload?.sourceId)).toEqual([
      'active_vulturous_zombie_perm',
      'nonactive_vulturous_zombie_perm',
    ]);
  });

  it('supports Syr Konrad-style creature-card graveyard entries from nonbattlefield zones', () => {
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
        id: 'syr_konrad_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'syr_konrad_card',
          name: 'Syr Konrad, the Grim',
          type_line: 'Legendary Creature - Human Knight',
          oracle_text:
            'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.\n{1}{B}: Each player mills a card.',
        },
      },
    ];
    (game.state as any).stack = [];

    const milledCreature = {
      id: 'milled_creature_card',
      name: 'Runeclaw Bear',
      type_line: 'Creature - Bear',
      oracle_text: '',
      zone: 'graveyard',
    };

    recordCardPutIntoGraveyardThisTurn(game as any, p2, milledCreature, { fromBattlefield: false });

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'card_put_into_graveyard',
      sourceName: 'Syr Konrad, the Grim',
      effect: 'Syr Konrad deals 1 damage to each opponent.',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      graveyardCardId: 'milled_creature_card',
      graveyardCardName: 'Runeclaw Bear',
      graveyardCardOwner: p2,
      graveyardCardTypeLine: 'Creature - Bear',
      fromZone: 'nonbattlefield',
      toZone: 'graveyard',
    }));

    game.resolveTopOfStack();

    expect((game.state as any).life[p1]).toBe(40);
    expect((game.state as any).life[p2]).toBe(39);
  });

  it('replays zone-change trigger source permanent snapshots', () => {
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
      triggerId: 'zone_change_source_snapshot_replay_trigger',
      sourceId: 'vulturous_zombie_perm',
      sourceName: 'Vulturous Zombie',
      controllerId: p1,
      description: 'put a +1/+1 counter on this creature',
      triggerType: 'card_put_into_graveyard',
      effect: 'put a +1/+1 counter on this creature',
      mandatory: true,
      effectData: {
        graveyardCardId: 'milled_card',
        graveyardCardName: 'Island',
        graveyardCardOwner: p2,
        graveyardCardController: p2,
        graveyardCardTypeLine: 'Basic Land - Island',
        fromZone: 'nonbattlefield',
        toZone: 'graveyard',
      },
      sourcePermanentSnapshot: {
        id: 'vulturous_zombie_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'vulturous_zombie_card',
          name: 'Vulturous Zombie',
          type_line: 'Creature - Plant Zombie',
        },
      },
    } as any);

    const replayed = ((game.state as any).stack || []).find((item: any) => item?.id === 'zone_change_source_snapshot_replay_trigger');
    expect(replayed?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'vulturous_zombie_perm',
      controller: p1,
      owner: p1,
    }));
    expect(replayed?.effectData).toEqual(expect.objectContaining({
      graveyardCardId: 'milled_card',
      graveyardCardOwner: p2,
    }));
  });

  it('does not rediscover live graveyard-entry triggers while replaying', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).isReplaying = true;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'vulturous_zombie_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'vulturous_zombie_card',
          name: 'Vulturous Zombie',
          type_line: 'Creature - Plant Zombie',
          oracle_text: "Whenever a card is put into an opponent's graveyard from anywhere, put a +1/+1 counter on this creature.",
        },
      },
    ];
    (game.state as any).stack = [];

    recordCardPutIntoGraveyardThisTurn(game as any, p2, {
      id: 'replayed_milled_card',
      name: 'Island',
      type_line: 'Basic Land - Island',
      oracle_text: '',
      zone: 'graveyard',
    }, { fromBattlefield: false });

    expect((game.state as any).stack).toEqual([]);
    expect(getEvents(gameId).filter((event: any) => event?.type === 'pushTriggeredAbility')).toEqual([]);
  });
});