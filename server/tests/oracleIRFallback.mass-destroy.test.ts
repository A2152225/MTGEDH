import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';

function ensureZonesForPlayer(g: any, pid: PlayerID) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

describe('Oracle IR fallback (server) - mass battlefield actions', () => {
  it('applies "Destroy all creatures" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_creatures');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

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

    // NOTE: importDeckResolved clears zones + battlefield for that player.
    // Set up battlefield and zones AFTER importing the deck.
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

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

  it('applies "Destroy all artifacts" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_artifacts');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'shatterstorm_1',
        name: 'Test Shatterstorm',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all artifacts.',
        mana_cost: '{2}{R}{R}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

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
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Test Artifact 1',
          type_line: 'Artifact',
          oracle_text: '',
        } as any,
      },
      {
        id: 'a2',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'a2_card',
          name: 'Test Artifact 2',
          type_line: 'Artifact Creature — Golem',
          oracle_text: '',
        } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'shatterstorm_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'a1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'a2')).toBe(false);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];

    expect(gy1.some((c: any) => c?.id === 'a2_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'a1_card')).toBe(true);
  });

  it('applies "Destroy all nonland permanents" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_nonland');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'jokul_1',
        name: 'Test Jokulhaups',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all nonland permanents.',
        mana_cost: '{4}{R}{R}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'l1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'l1_card',
          name: 'Test Land',
          type_line: 'Land',
          oracle_text: '',
        } as any,
      },
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
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Test Artifact 1',
          type_line: 'Artifact',
          oracle_text: '',
        } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'jokul_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'l1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'a1')).toBe(false);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];

    expect(gy1.some((c: any) => c?.id === 'c1_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'a1_card')).toBe(true);
  });

  it('applies "Destroy all artifacts and enchantments" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_artifacts_enchantments');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'tranq_1',
        name: 'Test Tranquility',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all artifacts and enchantments.',
        mana_cost: '{1}{G}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

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
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Test Artifact 1',
          type_line: 'Artifact',
          oracle_text: '',
        } as any,
      },
      {
        id: 'e1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'e1_card',
          name: 'Test Enchantment 1',
          type_line: 'Enchantment — Aura',
          oracle_text: '',
        } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'tranq_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'a1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'e1')).toBe(false);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];

    expect(gy1.some((c: any) => c?.id === 'e1_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'a1_card')).toBe(true);
  });

  it('applies "Destroy all lands" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_lands');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'armageddon_1',
        name: 'Test Armageddon',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all lands.',
        mana_cost: '{3}{W}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'l1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'l1_card',
          name: 'Test Land 1',
          type_line: 'Land',
          oracle_text: '',
        } as any,
      },
      {
        id: 'l2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'l2_card',
          name: 'Test Land 2',
          type_line: 'Land',
          oracle_text: '',
        } as any,
      },
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
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'armageddon_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'l1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'l2')).toBe(false);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];

    expect(gy1.some((c: any) => c?.id === 'l1_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'l2_card')).toBe(true);
  });

  it('applies comma-separated destroy-all types for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_artifacts_creatures_lands');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'cataclysm_1',
        name: 'Test Cataclysm',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all artifacts, creatures, and lands.',
        mana_cost: '{2}{W}{W}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'l1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'l1_card',
          name: 'Test Land 1',
          type_line: 'Land',
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
          name: 'Test Artifact 1',
          type_line: 'Artifact',
          oracle_text: '',
        } as any,
      },
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
        id: 'e1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'e1_card',
          name: 'Test Enchantment 1',
          type_line: 'Enchantment',
          oracle_text: '',
        } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'cataclysm_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'e1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'l1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'a1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(false);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];

    expect(gy1.some((c: any) => c?.id === 'l1_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'a1_card')).toBe(true);
    expect(gy1.some((c: any) => c?.id === 'c1_card')).toBe(true);
  });

  it('applies "Destroy all planeswalkers" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_planeswalkers');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'pw_wipe_1',
        name: 'Test The Elderspell',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all planeswalkers.',
        mana_cost: '{1}{B}{B}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'pw1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'pw1_card',
          name: 'Test Walker',
          type_line: 'Planeswalker — Test',
          oracle_text: '',
        } as any,
      },
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Test Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'pw_wipe_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'pw1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(true);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    expect(gy1.some((c: any) => c?.id === 'pw1_card')).toBe(true);
  });

  it('applies "Destroy all battles" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_battles');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'battle_wipe_1',
        name: 'Test Battle Wipe',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all battles.',
        mana_cost: '{3}{R}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'b1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'b1_card',
          name: 'Test Battle',
          type_line: 'Battle — Siege',
          oracle_text: '',
        } as any,
      },
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Test Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'battle_wipe_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'b1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(true);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    expect(gy1.some((c: any) => c?.id === 'b1_card')).toBe(true);
  });

  it('applies "Destroy all creatures and planeswalkers" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_creatures_planeswalkers');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'creature_pw_wipe_1',
        name: 'Test Wipe',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all creatures and planeswalkers.',
        mana_cost: '{3}{W}{B}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'pw1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'pw1_card',
          name: 'Test Walker',
          type_line: 'Planeswalker — Test',
          oracle_text: '',
        } as any,
      },
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Test Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        } as any,
      },
      {
        id: 'l1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'l1_card',
          name: 'Test Land',
          type_line: 'Land',
          oracle_text: '',
        } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'creature_pw_wipe_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'pw1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'l1')).toBe(true);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];

    expect(gy1.some((c: any) => c?.id === 'pw1_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'c1_card')).toBe(true);
  });

  it('applies "Destroy all creatures you control" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_creatures_you_control');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'wipe_you_1',
        name: 'Test Selective Wipe',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all creatures you control.',
        mana_cost: '{3}{W}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'c1_card', name: 'P1 Creature', type_line: 'Creature — Human', oracle_text: '' } as any,
      },
      {
        id: 'c2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: { id: 'c2_card', name: 'P2 Creature', type_line: 'Creature — Beast', oracle_text: '' } as any,
      },
      {
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: { id: 'a1_card', name: 'P2 Artifact', type_line: 'Artifact', oracle_text: '' } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({ type: 'castSpell', playerId: p1, cardId: 'wipe_you_1', targets: [] });
    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(false);
    expect(battlefield.some((p: any) => p?.id === 'c2')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'a1')).toBe(true);

    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy1.some((c: any) => c?.id === 'c1_card')).toBe(true);
    expect(gy2.some((c: any) => c?.id === 'c2_card')).toBe(false);
  });

  it('applies "Destroy all creatures your opponents control" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_creatures_opponents_control');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'wipe_opp_1',
        name: 'Test Opponent Wipe',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all creatures your opponents control.',
        mana_cost: '{4}{B}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'c1_card', name: 'P1 Creature', type_line: 'Creature — Human', oracle_text: '' } as any,
      },
      {
        id: 'c2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: { id: 'c2_card', name: 'P2 Creature', type_line: 'Creature — Beast', oracle_text: '' } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({ type: 'castSpell', playerId: p1, cardId: 'wipe_opp_1', targets: [] });
    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'c2')).toBe(false);

    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((c: any) => c?.id === 'c2_card')).toBe(true);
  });

  it('applies "Destroy all creatures you don\'t control" for uncategorized spells', () => {
    const g = createInitialGameState('oracle_ir_fallback_destroy_all_creatures_you_dont_control');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'Player 1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'Player 2' });

    const cards: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost' | 'image_uris'>> = [
      {
        id: 'wipe_not_you_1',
        name: 'Test Not-You Wipe',
        type_line: 'Sorcery',
        oracle_text: "Destroy all creatures you don't control.",
        mana_cost: '{4}{B}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 1);

    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'c1_card', name: 'P1 Creature', type_line: 'Creature — Human', oracle_text: '' } as any,
      },
      {
        id: 'c2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: { id: 'c2_card', name: 'P2 Creature', type_line: 'Creature — Beast', oracle_text: '' } as any,
      },
    ] as any;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({ type: 'castSpell', playerId: p1, cardId: 'wipe_not_you_1', targets: [] });
    expect((g.state as any).stack?.length || 0).toBe(1);

    g.resolveTopOfStack();

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.some((p: any) => p?.id === 'c1')).toBe(true);
    expect(battlefield.some((p: any) => p?.id === 'c2')).toBe(false);

    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((c: any) => c?.id === 'c2_card')).toBe(true);
  });
});
