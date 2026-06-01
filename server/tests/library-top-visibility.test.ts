import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

describe('Library Top Visibility security checks', () => {
  it('should prevent players from seeing their own or opponents library top unless permitted', () => {
    const g = createInitialGameState('lib_visibility_test');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Player 2' });

    // Set up libraries
    const p1Library = [
      {
        id: 'card_lotus',
        name: 'Black Lotus',
        type_line: 'Artifact',
        oracle_text: '{T}, Sacrifice Black Lotus: Add three mana of any one color.',
        mana_cost: '{0}',
      },
    ];
    const p2Library = [
      {
        id: 'card_mountain',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '{T}: Add {R}.',
        mana_cost: '',
      },
    ];

    (g as any).libraries.set(p1, p1Library);
    (g as any).libraries.set(p2, p2Library);

    // Initial check: No effects in play. Top card of library should be hidden to everyone.
    const viewRef1P1 = g.viewFor(p1);
    const viewRef1P2 = g.viewFor(p2);

    expect(viewRef1P1.zones?.[p1]?.hand).toBeDefined();
    // Library count is visible, but libraryTop should be undefined for owner
    expect(viewRef1P1.zones?.[p1]?.libraryCount).toBe(1);
    expect(viewRef1P1.zones?.[p1]?.libraryTop).toBeUndefined();
    // Library top of opponent should be undefined
    expect(viewRef1P1.zones?.[p2]?.libraryTop).toBeUndefined();

    // Opponent's view
    expect(viewRef1P2.zones?.[p2]?.libraryTop).toBeUndefined();
    expect(viewRef1P2.zones?.[p1]?.libraryTop).toBeUndefined();

    // CASE 1: "Conspicuous Snoop" (Look only) is controlled by P1.
    // P1 should be able to see their own library top. P2 should NOT be able to see P1's library top.
    const snoopPerm = {
      id: 'snoop_1',
      controller: p1,
      card: {
        id: 'card_snoop',
        name: 'Conspicuous Snoop',
        type_line: 'Creature — Goblin Rogue',
        oracle_text: 'You may look at the top card of your library any time.',
        mana_cost: '{R}{R}',
      },
      counters: {},
      attachments: [],
    };
    g.state.battlefield = [snoopPerm];

    const viewRef2P1 = g.viewFor(p1);
    const viewRef2P2 = g.viewFor(p2);

    // Owner (P1) should see their top card now
    expect(viewRef2P1.zones?.[p1]?.libraryTop).toBeDefined();
    expect(viewRef2P1.zones?.[p1]?.libraryTop?.name).toBe('Black Lotus');
    
    // Opponent (P2) should NOT see P1's top card
    expect(viewRef2P2.zones?.[p1]?.libraryTop).toBeUndefined();

    // CASE 2: "Oracle of Mul Daya" (Reveal to all) is controlled by P1.
    // Everyone should be able to see P1's library top.
    const oraclePerm = {
      id: 'oracle_1',
      controller: p1,
      card: {
        id: 'card_oracle',
        name: 'Oracle of Mul Daya',
        type_line: 'Creature — Elf Shaman',
        oracle_text: 'You may play lands from the top of your library.\nPlay with the top card of your library revealed.',
        mana_cost: '{3}{G}',
      },
      counters: {},
      attachments: [],
    };
    g.state.battlefield = [oraclePerm];

    const viewRef3P1 = g.viewFor(p1);
    const viewRef3P2 = g.viewFor(p2);

    // Owner (P1) should see their top card
    expect(viewRef3P1.zones?.[p1]?.libraryTop).toBeDefined();
    expect(viewRef3P1.zones?.[p1]?.libraryTop?.name).toBe('Black Lotus');

    // Opponent (P2) can see P1's top card because of Oracle's reveal effect
    expect(viewRef3P2.zones?.[p1]?.libraryTop).toBeDefined();
    expect(viewRef3P2.zones?.[p1]?.libraryTop?.name).toBe('Black Lotus');

    // Neither player can see P2's library top
    expect(viewRef3P1.zones?.[p2]?.libraryTop).toBeUndefined();
    expect(viewRef3P2.zones?.[p2]?.libraryTop).toBeUndefined();
  });
});
