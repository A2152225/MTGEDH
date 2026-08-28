import { describe, expect, it, vi } from 'vitest';
import { processOpponentSpellCastTriggersForCast } from '../src/socket/game-actions-handlers/gameActionsSpellCastTriggerProcessing.js';

const POSSIBILITY_STORM_ORACLE =
  'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with Possibility Storm on the bottom of their library in a random order.';

function makeGame() {
  return {
    seq: 1,
    state: {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        {
          id: 'perm_storm',
          controller: 'p1',
          card: {
            id: 'storm_card',
            name: 'Possibility Storm',
            type_line: 'Enchantment',
            oracle_text: POSSIBILITY_STORM_ORACLE,
          },
        },
      ],
      stack: [
        {
          id: 'stack_bolt',
          type: 'spell',
          controller: 'p2',
          card: { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
        },
      ],
    },
  };
}

describe('Possibility Storm opponent-cast trigger binding', () => {
  it('stamps triggeringStackItemId when a player casts from hand', () => {
    const game = makeGame();
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'g1',
      game,
      io,
      'p2',
      { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
      'hand',
      'stack_bolt',
    );
    const trigger = (game.state.stack || []).find((item: any) => item?.type === 'triggered_ability');
    expect(trigger?.sourceName).toBe('Possibility Storm');
    expect(trigger?.triggeringStackItemId).toBe('stack_bolt');
    expect(trigger?.effectData?.triggeringSpell?.type_line).toBe('Instant');
  });

  it('does not fire Possibility Storm when the spell was not cast from hand', () => {
    const game = makeGame();
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'g1',
      game,
      io,
      'p2',
      { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
      'graveyard',
      'stack_bolt',
    );
    expect((game.state.stack || []).some((item: any) => item?.type === 'triggered_ability')).toBe(false);
  });

  it('does not fire Possibility Storm when the spell was cast from exile', () => {
    const game = makeGame();
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'g1',
      game,
      io,
      'p2',
      { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
      'exile',
      'stack_bolt',
    );
    expect((game.state.stack || []).some((item: any) => item?.type === 'triggered_ability')).toBe(false);
  });
});
