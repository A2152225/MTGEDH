import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';

describe('Turn advancement and land-per-turn tracking', () => {
  it('increments landsPlayedThisTurn on playLand and resets on nextTurn', () => {
    const g = createInitialGameState('turn_land_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    // Join players; turn player becomes p1
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Start main phase to match socket-side enforcement (state-level does not enforce, we just simulate)
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;

    const land: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
      id: 'land_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '',
      image_uris: undefined
    };

    // Play a land via event (state increments counter)
    g.applyEvent({ type: 'playLand', playerId: p1, card: land });
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(1);

    // Next turn resets counters, advances turn and priority
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);
    expect(g.state.priority).toBe(p2);
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(0);
    expect(g.state.landsPlayedThisTurn?.[p2]).toBe(0);
  });

  it('removes land from hand when played', () => {
    const g = createInitialGameState('turn_land_hand');

    const p1 = 'p1' as PlayerID;

    // Join player
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Import a small deck with lands
    const lands: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
      { id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: undefined },
      { id: 'island_1', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', image_uris: undefined },
      { id: 'swamp_1', name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '', image_uris: undefined },
    ];

    g.importDeckResolved(p1, lands);

    // Draw 2 cards
    g.drawCards(p1, 2);

    const handBefore = g.state.zones?.[p1]?.handCount || 0;
    expect(handBefore).toBe(2);

    const handCards = g.state.zones?.[p1]?.hand as any[];
    expect(handCards.length).toBe(2);
    const cardToPlay = handCards[0];
    expect(cardToPlay.id).toBe('plains_1');

    // Set to main phase
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;

    // Play the land by ID (as socket handler would)
    g.playLand(p1, cardToPlay.id);

    // Verify land was removed from hand
    const handAfter = g.state.zones?.[p1]?.handCount || 0;
    expect(handAfter).toBe(1);

    const handCardsAfter = g.state.zones?.[p1]?.hand as any[];
    expect(handCardsAfter.length).toBe(1);
    expect(handCardsAfter[0].id).toBe('island_1'); // The second card should remain

    // Verify land was added to battlefield
    expect(g.state.battlefield.length).toBe(1);
    const perm = g.state.battlefield[0];
    expect(perm.controller).toBe(p1);
    expect(perm.owner).toBe(p1);
    expect((perm.card as any).id).toBe('plains_1');
    expect((perm.card as any).name).toBe('Plains');
    expect((perm.card as any).type_line).toBe('Basic Land — Plains');

    // Verify counter was incremented
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(1);
  });

  it('allows playing another land after turn advancement', () => {
    const g = createInitialGameState('turn_land_multi');

    const p1 = 'p1' as PlayerID;

    // Join player
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Import a small deck with lands
    const lands: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>> = [
      { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: undefined },
      { id: 'forest_2', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: undefined },
      { id: 'forest_3', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: undefined },
    ];

    g.importDeckResolved(p1, lands);
    g.drawCards(p1, 3);

    // Set to main phase
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;

    // Play first land
    const handCards1 = g.state.zones?.[p1]?.hand as any[];
    g.playLand(p1, handCards1[0].id);
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(1);
    expect(g.state.zones?.[p1]?.handCount).toBe(2);

    // Advance turn
    g.applyEvent({ type: 'nextTurn' });

    // Counter should be reset
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(0);

    // Advance to main phase of new turn
    g.applyEvent({ type: 'nextStep' }); // UPKEEP
    g.applyEvent({ type: 'nextStep' }); // DRAW (will draw a card)
    g.applyEvent({ type: 'nextStep' }); // MAIN1

    expect(g.state.phase).toBe(GamePhase.PRECOMBAT_MAIN);

    // Play second land
    const handCards2 = g.state.zones?.[p1]?.hand as any[];
    expect(handCards2.length).toBeGreaterThan(0);
    g.playLand(p1, handCards2[0].id);
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(1);

    // Verify 2 lands on battlefield
    expect(g.state.battlefield.length).toBe(2);
  });
});