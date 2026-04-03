import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';

describe('castSpell via applyEvent', () => {
  it('should remove card from hand and add to stack when casting', () => {
    const g = createInitialGameState('cast_via_apply');
    
    const p1 = 'p1' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      { 
        id: 'enchant_1', 
        name: 'Ghostly Prison', 
        type_line: 'Enchantment',
        oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
        mana_cost: '{2}{W}',
        image_uris: undefined
      },
    ];
    
    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);
    
    // Set up game state for casting
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Verify the card is in hand
    const handBefore = g.state.zones?.[p1]?.hand as any[];
    expect(handBefore.length).toBe(1);
    expect(handBefore[0].id).toBe('enchant_1');
    expect(g.state.zones?.[p1]?.handCount).toBe(1);
    expect(g.state.stack.length).toBe(0);
    
    // Cast the spell via applyEvent
    g.applyEvent({ 
      type: 'castSpell', 
      playerId: p1, 
      cardId: 'enchant_1',
      targets: []
    });
    
    // Verify the card was removed from hand
    const handAfter = g.state.zones?.[p1]?.hand as any[];
    expect(handAfter.length).toBe(0);
    expect(g.state.zones?.[p1]?.handCount).toBe(0);
    
    // Verify the spell was added to the stack
    expect(g.state.stack.length).toBe(1);
    const stackItem = g.state.stack[0];
    expect((stackItem as any).controller).toBe(p1);
    expect((stackItem as any).card.name).toBe('Ghostly Prison');
    expect((stackItem as any).card.zone).toBe('stack');
  });

  it('should not add card to stack if not found in hand', () => {
    const g = createInitialGameState('cast_not_in_hand');
    
    const p1 = 'p1' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    // Set up game state
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Try to cast a card that's not in hand
    g.applyEvent({ 
      type: 'castSpell', 
      playerId: p1, 
      cardId: 'nonexistent_card',
      targets: []
    });
    
    // Stack should remain empty
    expect(g.state.stack.length).toBe(0);
  });

  it('should handle instant spell casting', () => {
    const g = createInitialGameState('cast_instant_apply');
    
    const p1 = 'p1' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      { 
        id: 'bolt_1', 
        name: 'Lightning Bolt', 
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        mana_cost: '{R}',
        image_uris: undefined
      },
    ];
    
    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);
    
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Cast with targets
    g.applyEvent({ 
      type: 'castSpell', 
      playerId: p1, 
      cardId: 'bolt_1',
      targets: [{ kind: 'player', id: 'opponent_id' }]
    });
    
    // Verify spell is on stack with targets
    expect(g.state.stack.length).toBe(1);
    const stackItem = g.state.stack[0];
    expect((stackItem as any).card.name).toBe('Lightning Bolt');
    expect((stackItem as any).targets).toEqual([{ kind: 'player', id: 'opponent_id' }]);
    expect(g.state.zones?.[p1]?.handCount).toBe(0);
  });

  it('should remove a library card and preserve library provenance when replaying a library-origin cast', () => {
    const g = createInitialGameState('cast_from_library_apply');

    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });

    (g as any).libraries = new Map<string, any[]>();
    (g as any).libraries.set(p1, [
      {
        id: 'pang_1',
        name: 'Panglacial Wurm',
        type_line: 'Creature — Wurm',
        oracle_text: 'While you\'re searching your library, you may cast Panglacial Wurm from your library.',
        mana_cost: '{5}{G}{G}',
        image_uris: undefined,
      },
    ]);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent({
      type: 'castSpell',
      playerId: p1,
      cardId: 'pang_1',
      card: {
        id: 'pang_1',
        name: 'Panglacial Wurm',
        type_line: 'Creature — Wurm',
        oracle_text: 'While you\'re searching your library, you may cast Panglacial Wurm from your library.',
        mana_cost: '{5}{G}{G}',
      },
      fromZone: 'library',
      targets: [],
    } as any);

    expect(((g as any).libraries.get(p1) as any[]).length).toBe(0);
    expect(g.state.stack.length).toBe(1);
    expect((g.state.stack[0] as any).card.id).toBe('pang_1');
    expect((g.state.stack[0] as any).castFromLibrary).toBe(true);
    expect((g.state.stack[0] as any).fromZone).toBe('library');
  });

  it('should handle multiple spells being cast sequentially', () => {
    const g = createInitialGameState('cast_multiple_spells');
    
    const p1 = 'p1' as PlayerID;
    
    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });
    
    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      { 
        id: 'spell_1', 
        name: 'Shock', 
        type_line: 'Instant',
        oracle_text: 'Shock deals 2 damage to any target.',
        mana_cost: '{R}',
        image_uris: undefined
      },
      { 
        id: 'spell_2', 
        name: 'Lightning Strike', 
        type_line: 'Instant',
        oracle_text: 'Lightning Strike deals 3 damage to any target.',
        mana_cost: '{1}{R}',
        image_uris: undefined
      },
    ];
    
    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 2);
    
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    expect(g.state.zones?.[p1]?.handCount).toBe(2);
    
    // Cast first spell
    g.applyEvent({ 
      type: 'castSpell', 
      playerId: p1, 
      cardId: 'spell_1',
      targets: []
    });
    
    expect(g.state.stack.length).toBe(1);
    expect(g.state.zones?.[p1]?.handCount).toBe(1);
    
    // Cast second spell
    g.applyEvent({ 
      type: 'castSpell', 
      playerId: p1, 
      cardId: 'spell_2',
      targets: []
    });
    
    expect(g.state.stack.length).toBe(2);
    expect(g.state.zones?.[p1]?.handCount).toBe(0);
    
    // Verify both spells are on stack
    expect((g.state.stack[0] as any).card.name).toBe('Shock');
    expect((g.state.stack[1] as any).card.name).toBe('Lightning Strike');
  });

  it('should restore tapped mana sources from persisted castSpell payment evidence', () => {
    const g = createInitialGameState('cast_spell_replay_tapped_sources');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Player 1' });

    (g.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land - Forest',
          oracle_text: '{T}: Add {G}.',
          zone: 'battlefield',
        },
      },
    ];

    const hand = g.state.zones?.[p1]?.hand as any[];
    hand.push({
      id: 'giant_growth_1',
      name: 'Giant Growth',
      type_line: 'Instant',
      oracle_text: 'Target creature gets +3/+3 until end of turn.',
      mana_cost: '{G}',
      zone: 'hand',
    });
    if (g.state.zones?.[p1]) {
      g.state.zones[p1].handCount = hand.length;
    }

    g.applyEvent({
      type: 'castSpell',
      playerId: p1,
      cardId: 'giant_growth_1',
      targets: [],
      tappedPermanents: ['forest_1'],
    } as any);

    const forest = (g.state.battlefield || []).find((entry: any) => entry?.id === 'forest_1');
    expect(Boolean((forest as any)?.tapped)).toBe(true);
    expect(g.state.stack.length).toBe(1);
  });
});
