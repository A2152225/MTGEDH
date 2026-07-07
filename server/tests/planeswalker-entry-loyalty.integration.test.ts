import { beforeAll, describe, expect, it } from 'vitest';
import { initDb } from '../src/db/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { resolvePermanentSpellBattlefieldEntry } from '../src/state/modules/stackResolvePermanentEntryUtils.js';
import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import { applyStateBasedActions } from '../src/rules-engine/index.js';

describe('planeswalker entry loyalty (integration)', () => {
  beforeAll(async () => {
    await initDb();
    ensureLocalCardLookupIndexSync();
  });

  it('enters Nissa with printed loyalty when the stack card omitted loyalty', () => {
    const playerId = 'p1';
    const ctx = createContext('test_planeswalker_entry_loyalty') as GameContext;
    ctx.state.players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    ctx.state.life = { [playerId]: 40 };
    ctx.state.battlefield = [];
    ctx.state.stack = [];

    const card = {
      id: 'nissa_stack_card',
      name: 'Nissa, Who Shakes the World',
      type_line: 'Legendary Planeswalker — Nissa',
      oracle_text: 'Whenever you tap a Forest for mana, add an additional {G}.\n+1: Put three +1/+1 counters on up to one target noncreature land you control. Untap it. It becomes a 0/0 Elemental creature with vigilance and haste that\'s still a land.\n−8: You get an emblem with "Lands you control have indestructible." Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle.',
      mana_cost: '{3}{G}{G}',
      colors: ['G'],
    };

    const outcome = resolvePermanentSpellBattlefieldEntry(ctx, {
      controller: playerId,
      card,
      effectiveCard: card,
      effectiveTypeLine: card.type_line,
      item: { card, source: 'hand' },
      targets: [],
      fallbackOracleText: card.oracle_text,
    });

    expect(outcome.newPermanent).toBeTruthy();
    expect(Number(outcome.newPermanent.counters?.loyalty || 0)).toBe(5);
    expect(Number(outcome.newPermanent.loyalty || 0)).toBe(5);
    expect(Number(outcome.newPermanent.baseLoyalty || 0)).toBe(5);

    ctx.state.battlefield.push(outcome.newPermanent);
    const sba = applyStateBasedActions(ctx.state as any);
    expect(sba.destroys).not.toContain(outcome.newPermId);
  });
});
