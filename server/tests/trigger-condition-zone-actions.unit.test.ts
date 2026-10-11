import { describe, expect, it } from 'vitest';
import { getLibrarySearchTriggers } from '../src/state/modules/triggers/search.js';
import { getTokenCreatedTriggers } from '../src/state/modules/triggers/tokens.js';
import { getCounterRemovedTriggers } from '../src/state/modules/triggers/counters.js';
import { getExiledFromBattlefieldTriggers, getPutIntoGraveyardTriggers, getLeftGraveyardTriggers } from '../src/state/modules/triggers/zone-change.js';

function watcher(id: string, controller: string, oracle: string) {
  return {
    id,
    controller,
    card: { name: 'Watcher', type_line: 'Creature', oracle_text: oracle },
  };
}

describe('parsed zone and player-action trigger sentences', () => {
  it('queues an opponent searching any library on another player\'s permanent', () => {
    const ctx = {
      state: {
        battlefield: [watcher('w', 'p1', 'Whenever an opponent searches a library, you gain 1 life.')],
      },
    } as any;
    expect(getLibrarySearchTriggers(ctx, 'p2', 'p1').map((trigger) => trigger.effect)).toEqual(['you gain 1 life']);
    expect(getLibrarySearchTriggers(ctx, 'p1', 'p1')).toEqual([]);
  });

  it('does not queue a second copy of a library search the detector already found', () => {
    const ctx = {
      state: {
        battlefield: [watcher('w', 'p1', 'Whenever an opponent searches their library, you gain 1 life.')],
      },
    } as any;
    expect(getLibrarySearchTriggers(ctx, 'p2', 'p2')).toHaveLength(1);
  });

  it('queues an opponent creating a token from a permanent that player does not control', () => {
    const ctx = {
      state: {
        battlefield: [watcher('w', 'p1', 'Whenever an opponent creates a token, draw a card.')],
      },
    } as any;
    expect(getTokenCreatedTriggers(ctx, 'p2', { typeLine: 'Creature — Goblin' }).map((trigger) => trigger.effect)).toEqual(['draw a card']);
    const yours = {
      state: {
        battlefield: [watcher('w', 'p1', 'Whenever you create a creature token, draw a card.')],
      },
    } as any;
    expect(getTokenCreatedTriggers(yours, 'p2', { typeLine: 'Creature — Goblin' })).toEqual([]);
    expect(getTokenCreatedTriggers(yours, 'p1', { typeLine: 'Creature — Goblin' })).toHaveLength(1);
  });

  it('queues a typed counter-removed sentence and a graveyard sentence the old filter can miss', () => {
    const ctx = {
      state: {
        battlefield: [
          watcher('counters', 'p1', 'Whenever a +1/+1 counter is removed from a Goblin you control, draw a card.'),
          watcher('yard', 'p1', 'Whenever a Goblin card is put into a graveyard from anywhere, you gain 1 life.'),
          watcher('left', 'p1', 'Whenever a Goblin card leaves a graveyard, you gain 1 life.'),
          watcher('exile', 'p1', 'Whenever a Goblin is exiled from the battlefield, you gain 1 life.'),
        ],
      },
    } as any;
    const removed = getCounterRemovedTriggers(ctx, {
      id: 'bear',
      controller: 'p1',
      card: { name: 'Goblin', type_line: 'Creature — Goblin' },
    }, { '+1/+1': 1 });
    expect(removed.map((trigger) => trigger.effect)).toEqual(['draw a card']);

    const card = { name: 'Goblin', type_line: 'Creature — Goblin' };
    expect(getPutIntoGraveyardTriggers(ctx, 'p2', card).map((trigger) => trigger.effect)).toContain('you gain 1 life');
    expect(getLeftGraveyardTriggers(ctx, 'p2', card).map((trigger) => trigger.effect)).toContain('you gain 1 life');
    expect(getExiledFromBattlefieldTriggers(ctx, {
      id: 'bear',
      controller: 'p2',
      card,
    }).map((trigger) => trigger.effect)).toContain('you gain 1 life');
  });
});
