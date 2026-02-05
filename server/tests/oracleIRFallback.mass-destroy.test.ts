import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';

describe('Oracle IR fallback (server) - mass battlefield actions', () => {
  it('applies "Destroy all creatures" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_creatures');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    // Ensure zones exist (move-to-graveyard writes into zones[owner]).
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p1] = (g.state as any).zones[p1] || {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    };
    (g.state as any).zones[p2] = (g.state as any).zones[p2] || {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    };

    // Battlefield: 2 creatures + 1 artifact.
    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Test Creature 1',
          type_line: 'Creature — Human',
          oracle_text: '',
        } as any,
      },
      {
        id: 'c2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c2_card',
          name: 'Test Creature 2',
          type_line: 'Creature — Beast',
          oracle_text: '',
        } as any,
      },
      {
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Test Artifact',
          type_line: 'Artifact',
          oracle_text: '',
        } as any,
      },
    ] as any;

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'wipe_1',
        name: 'Test Wrath',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all creatures.',
        mana_cost: '{2}{W}{W}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'wipe_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'a1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'c2')).toBe(false);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];

    expect(gy1.some((c: any) => c?.id === 'c1_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'c2_card')).toBe(true);
  });
});
