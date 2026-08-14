import { describe, expect, it } from 'vitest';
import { createContext, type GameContext } from '../src/state/context.js';
import { resolvePermanentSpellBattlefieldEntry } from '../src/state/modules/stackResolvePermanentEntryUtils.js';

const GRENZO_ORACLE =
  'Grenzo enters with X +1/+1 counters on it.\n{2}: Put the bottom card of your library into your graveyard. If it\'s a creature card with power less than or equal to Grenzo\'s power, put it onto the battlefield.';

describe('Grenzo, Dungeon Warden X-cost entry counters', () => {
  it('enters with X +1/+1 counters from the spell X value', () => {
    const playerId = 'p1';
    const ctx = createContext('test_grenzo_x_entry_counters') as GameContext;
    ctx.state.players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    ctx.state.life = { [playerId]: 40 };
    ctx.state.battlefield = [];
    ctx.state.stack = [];

    const card = {
      id: 'grenzo_stack_card',
      name: 'Grenzo, Dungeon Warden',
      type_line: 'Legendary Creature — Goblin Rogue',
      oracle_text: GRENZO_ORACLE,
      mana_cost: '{X}{B}{R}',
      power: '2',
      toughness: '2',
    };

    const outcome = resolvePermanentSpellBattlefieldEntry(ctx, {
      controller: playerId,
      card,
      effectiveCard: card,
      effectiveTypeLine: card.type_line,
      item: { card, source: 'hand', xValue: 4 },
      targets: [],
      fallbackOracleText: card.oracle_text,
    });

    expect(outcome.newPermanent).toBeTruthy();
    expect(outcome.newPermanent.counters).toEqual({ '+1/+1': 4 });
    expect(outcome.newPermanent.basePower).toBe(2);
    expect(outcome.newPermanent.baseToughness).toBe(2);
  });
});
