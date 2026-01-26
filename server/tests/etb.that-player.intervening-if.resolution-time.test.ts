import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { triggerETBEffectsForPermanent, resolveTopOfStack } from '../src/state/modules/stack';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('Intervening-if ETB triggers (that player refs)', () => {
  beforeEach(() => {
    // Avoid cross-test leakage (these suites can interact with the Resolution Queue).
    ResolutionQueueManager.removeQueue('t_etb_intervening_if_that_player_resolution_fizzle');
  });

  it('re-checks "that player" intervening-if clauses at resolution using the entering permanent\'s controller', () => {
    const g = createInitialGameState('t_etb_intervening_if_that_player_resolution_fizzle');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Ensure hand zones exist and are what intervening-if reads.
    (g.state as any).zones = {
      [p1]: { hand: [] },
      [p2]: { hand: [{ id: 'c1' }, { id: 'c2' }] },
    };

    // A watcher that triggers on ANY creature and references "that player" (the creature's controller).
    (g.state.battlefield as any).push({
      id: 'that_player_watcher_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'that_player_watcher_card_1',
        name: 'That Player ETB Watcher',
        type_line: 'Enchantment',
        oracle_text:
          'Whenever a creature enters the battlefield, if that player has two or fewer cards in hand, that player loses 1 life.',
      },
      tapped: false,
    });

    // A creature enters under p2's control.
    const enteringCreature = {
      id: 'entering_creature_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'entering_creature_card_1',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
      tapped: false,
    };
    (g.state.battlefield as any).push(enteringCreature);

    // At trigger time, p2 has 2 cards => condition true => trigger is created.
    triggerETBEffectsForPermanent(g as any, enteringCreature, p2);

    const stackItems = (g.state.stack || []) as any[];
    expect(stackItems.some((s) => s?.type === 'triggered_ability' && s?.sourceName === 'That Player ETB Watcher')).toBe(true);

    const triggerItem = stackItems.find((s) => s?.type === 'triggered_ability' && s?.sourceName === 'That Player ETB Watcher');
    expect(triggerItem?.triggeringPlayer).toBe(p2);

    // Before resolution, the condition becomes false (p2 now has 3 cards).
    (g.state as any).zones[p2].hand = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

    const lifeBefore = (g.state.life as any)[p2];
    resolveTopOfStack(g as any);

    // Intervening-if must be re-checked at resolution (CR 603.4). Since it's now false, the trigger fizzles.
    expect((g.state.life as any)[p2]).toBe(lifeBefore);
  });
});
