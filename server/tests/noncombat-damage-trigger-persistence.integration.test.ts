import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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

describe('noncombat damage-to-player triggers (integration)', () => {
  const gameId = 'test_noncombat_damage_trigger_persistence';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('persists source damage-to-player triggers with damaged-player context', () => {
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
        id: 'pinger_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'pinger_card',
          name: 'Test Pinger',
          type_line: 'Creature - Wizard',
          oracle_text: '{T}: Test Pinger deals 1 damage to any target.\nWhenever Test Pinger deals damage to a player, draw a card.',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'pinger_damage_ability',
        type: 'ability',
        controller: p1,
        source: 'pinger_perm',
        sourceName: 'Test Pinger',
        description: 'deals 1 damage to any target',
        abilityType: 'generic',
        targets: [p2],
      },
    ];

    game.resolveTopOfStack();

    expect((game.state.life as any)[p2]).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[p2]).toBe(1);

    const damageTriggers = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'pinger_perm');
    expect(damageTriggers).toHaveLength(1);
    expect(damageTriggers[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'deals_damage',
      sourceName: 'Test Pinger',
      permanentId: 'pinger_perm',
      targetPlayer: p2,
      defendingPlayer: p2,
      effect: 'draw a card.',
    }));
    expect(damageTriggers[0]?.card?.name).toBe('Test Pinger');
    expect(damageTriggers[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'pinger_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({ name: 'Test Pinger' }),
    }));
    expect(damageTriggers[0]?.damageSourcePermanentIds).toEqual(['pinger_perm']);
    expect(damageTriggers[0]?.damageIncludedWarriorSource).toBe(false);
    expect(damageTriggers[0]?.effectData).toEqual(expect.objectContaining({
      sourcePermanentId: 'pinger_perm',
      damagedPlayerId: p2,
      damageAmount: 1,
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Test Pinger'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload).toEqual(expect.objectContaining({
      permanentId: 'pinger_perm',
      damagedPlayerId: p2,
      damageAmount: 1,
      damageSourcePermanentIds: ['pinger_perm'],
      damageIncludedWarriorSource: false,
      card: expect.objectContaining({ name: 'Test Pinger' }),
      sourcePermanentSnapshot: expect.objectContaining({
        id: 'pinger_perm',
        controller: p1,
        owner: p1,
        card: expect.objectContaining({ name: 'Test Pinger' }),
      }),
    }));
    expect(triggerEvents[0]?.payload?.effectData).toEqual(expect.objectContaining({
      sourcePermanentId: 'pinger_perm',
      damagedPlayerId: p2,
      damageAmount: 1,
    }));

    (game.state as any).stack = [];
    game.applyEvent({ type: 'pushTriggeredAbility', ...(triggerEvents[0]?.payload || {}) } as any);
    const replayedTrigger = ((game.state as any).stack || [])[0] as any;
    expect(replayedTrigger).toEqual(expect.objectContaining({
      source: 'pinger_perm',
      permanentId: 'pinger_perm',
      targetPlayer: p2,
      defendingPlayer: p2,
      damagedPlayerId: p2,
      damageAmount: 1,
      damageSourcePermanentIds: ['pinger_perm'],
      damageIncludedWarriorSource: false,
    }));
    expect(replayedTrigger?.sourcePermanentSnapshot?.card?.name).toBe('Test Pinger');
  });
});