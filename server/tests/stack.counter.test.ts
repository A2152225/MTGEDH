import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { counterStackItem } from '../src/state/modules/stack-mechanics';
import type { PlayerID, TargetRef, KnownCardRef } from '../../shared/src';

describe('Counterspell flow (COUNTER_TARGET_SPELL)', () => {
  it('removes targeted stack item and moves it to the controller’s graveyard', () => {
    const g = createInitialGameState('t_counter_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    // Join players (sets up life/zones)
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Put a spell from P1 on the stack
    const lightningBolt: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
      id: 'card_bolt',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      image_uris: undefined
    };
    const stackId = 'st_abc123';
    g.applyEvent({
      type: 'pushStack',
      item: {
        id: stackId,
        controller: p1,
        card: lightningBolt,
        targets: []
      }
    });

    expect(g.state.stack.length).toBe(1);

    // Resolve "Counter target spell" from p2 targeting that stack item
    g.applyEvent({
      type: 'resolveSpell',
      caster: p2,
      cardId: 'card_counter',
      spec: { op: 'COUNTER_TARGET_SPELL', filter: 'ANY', minTargets: 1, maxTargets: 1 },
      chosen: [{ kind: 'stack', id: stackId } as TargetRef]
    });

    // Countered: stack is empty, and the countered spell is in P1's graveyard
    expect(g.state.stack.length).toBe(0);
    const gy = g.state.zones?.[p1]?.graveyard ?? [];
    expect(gy.find(c => (c as any).id === 'card_bolt')).toBeTruthy();
  });

  it('resolves a counterspell stack item whose target was persisted as a string stack id', () => {
    const g = createInitialGameState('t_counter_2');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const swordsToPlowshares: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
      id: 'card_swords',
      name: 'Swords to Plowshares',
      type_line: 'Instant',
      oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
      image_uris: undefined,
    };

    g.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_swords',
        controller: p1,
        card: swordsToPlowshares,
        targets: [],
      },
    });

    const forceOfWill: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
      id: 'card_force',
      name: 'Force of Will',
      type_line: 'Instant',
      oracle_text: 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost.\nCounter target spell.',
      image_uris: undefined,
    };

    g.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_force',
        controller: p2,
        card: forceOfWill,
        targets: ['stack_swords'],
      },
    });

    expect(g.state.stack.map(item => item.id)).toEqual(['stack_swords', 'stack_force']);

    g.resolveTopOfStack();

    expect(g.state.stack).toHaveLength(0);

    const p1Graveyard = g.state.zones?.[p1]?.graveyard ?? [];
    const p2Graveyard = g.state.zones?.[p2]?.graveyard ?? [];
    expect(p1Graveyard.find(card => (card as any).id === 'card_swords')).toBeTruthy();
    expect(p2Graveyard.find(card => (card as any).id === 'card_force')).toBeTruthy();
  });

  it('exiles a flashback spell countered by a resolving counterspell stack item', () => {
    const game = createInitialGameState('t_counter_flashback_live');

    const playerOne = 'p1' as PlayerID;
    const playerTwo = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: playerOne, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: playerTwo, name: 'P2' });

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_think_twice_flashback',
        type: 'spell',
        controller: playerOne,
        castFromGraveyard: true,
        card: {
          id: 'card_think_twice_flashback',
          name: 'Think Twice',
          type_line: 'Instant',
          oracle_text: 'Draw a card.\nFlashback {2}{U}',
          castFromGraveyard: true,
          castWithAbility: 'flashback',
        },
        targets: [],
      },
    });

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_counterspell_flashback',
        type: 'spell',
        controller: playerTwo,
        card: {
          id: 'card_counterspell_flashback',
          name: 'Counterspell',
          type_line: 'Instant',
          oracle_text: 'Counter target spell.',
        },
        targets: ['stack_think_twice_flashback'],
      },
    });

    game.resolveTopOfStack();

    expect(game.state.stack).toHaveLength(0);
    const playerOneZones = game.state.zones?.[playerOne];
    expect((playerOneZones?.exile || []).map(card => (card as any).id)).toContain('card_think_twice_flashback');
    expect((playerOneZones?.graveyard || []).map(card => (card as any).id)).not.toContain('card_think_twice_flashback');
    expect((game.state.zones?.[playerTwo]?.graveyard || []).map(card => (card as any).id)).toContain('card_counterspell_flashback');
  });

  it('replays resolveSpell countering a flashback spell into exile', () => {
    const game = createInitialGameState('t_counter_flashback_replay');

    const playerOne = 'p1' as PlayerID;
    const playerTwo = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: playerOne, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: playerTwo, name: 'P2' });

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_faithless_looting_flashback',
        type: 'spell',
        controller: playerOne,
        castFromGraveyard: true,
        card: {
          id: 'card_faithless_looting_flashback',
          name: 'Faithless Looting',
          type_line: 'Sorcery',
          oracle_text: 'Draw two cards, then discard two cards.\nFlashback {2}{R}',
          castFromGraveyard: true,
          castWithAbility: 'flashback',
        },
        targets: [],
      },
    });

    game.applyEvent({
      type: 'resolveSpell',
      caster: playerTwo,
      cardId: 'card_counterspell_replay',
      spec: { op: 'COUNTER_TARGET_SPELL', filter: 'ANY', minTargets: 1, maxTargets: 1 },
      chosen: [{ kind: 'stack', id: 'stack_faithless_looting_flashback' } as TargetRef],
    });

    expect(game.state.stack).toHaveLength(0);
    const playerOneZones = game.state.zones?.[playerOne];
    expect((playerOneZones?.exile || []).map(card => (card as any).id)).toContain('card_faithless_looting_flashback');
    expect((playerOneZones?.graveyard || []).map(card => (card as any).id)).not.toContain('card_faithless_looting_flashback');
  });

  it('exiles a flashback spell countered by ward-style stack mechanics', () => {
    const game = createInitialGameState('t_counter_flashback_ward');

    const playerOne = 'p1' as PlayerID;
    const playerTwo = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: playerOne, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: playerTwo, name: 'P2' });

    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_artful_dodge_flashback',
        type: 'spell',
        controller: playerOne,
        canBeCountered: true,
        castFromGraveyard: true,
        card: {
          id: 'card_artful_dodge_flashback',
          name: 'Artful Dodge',
          type_line: 'Sorcery',
          oracle_text: "Target creature can't be blocked this turn.\nFlashback {U}",
          castFromGraveyard: true,
          castWithAbility: 'flashback',
        },
        targets: [],
      },
    });

    const result = counterStackItem({
      state: game.state,
      zones: game.state.zones,
      bumpSeq: game.bumpSeq.bind(game),
    } as any, 'stack_artful_dodge_flashback', playerTwo);

    expect(result.success).toBe(true);
    expect(game.state.stack).toHaveLength(0);
    const playerOneZones = game.state.zones?.[playerOne];
    expect((playerOneZones?.exile || []).map(card => (card as any).id)).toContain('card_artful_dodge_flashback');
    expect((playerOneZones?.graveyard || []).map(card => (card as any).id)).not.toContain('card_artful_dodge_flashback');
  });
});

describe('Target fizzle stack leave-zone replacement', () => {
  it('moves an ordinary spell with no remaining legal targets to graveyard', () => {
    const game = createInitialGameState('t_fizzle_normal_spell');
    const playerOne = 'p1' as PlayerID;
    const playerTwo = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: playerOne, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: playerTwo, name: 'P2' });
    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_normal_fizzle',
        type: 'spell',
        controller: playerOne,
        card: {
          id: 'card_normal_fizzle',
          name: 'Slip Through Space',
          type_line: 'Sorcery',
          oracle_text: "Target creature can't be blocked this turn.\nDraw a card.",
        },
        targets: ['missing_creature_1'],
      },
    });

    game.resolveTopOfStack();

    expect(game.state.stack).toHaveLength(0);
    const playerOneZones = game.state.zones?.[playerOne];
    expect((playerOneZones?.graveyard || []).map(card => (card as any).id)).toContain('card_normal_fizzle');
    expect((playerOneZones?.exile || []).map(card => (card as any).id)).not.toContain('card_normal_fizzle');
  });

  it('exiles a flashback spell with no remaining legal targets', () => {
    const game = createInitialGameState('t_fizzle_flashback_spell');
    const playerOne = 'p1' as PlayerID;
    const playerTwo = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: playerOne, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: playerTwo, name: 'P2' });
    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_flashback_fizzle',
        type: 'spell',
        controller: playerOne,
        castFromGraveyard: true,
        card: {
          id: 'card_flashback_fizzle',
          name: 'Artful Dodge',
          type_line: 'Sorcery',
          oracle_text: "Target creature can't be blocked this turn.\nFlashback {U}",
          castFromGraveyard: true,
          castWithAbility: 'flashback',
        },
        targets: ['missing_creature_1'],
      },
    });

    game.resolveTopOfStack();

    expect(game.state.stack).toHaveLength(0);
    const playerOneZones = game.state.zones?.[playerOne];
    expect((playerOneZones?.exile || []).map(card => (card as any).id)).toContain('card_flashback_fizzle');
    expect((playerOneZones?.graveyard || []).map(card => (card as any).id)).not.toContain('card_flashback_fizzle');
  });

  it('replays a fizzled flashback spell into exile', () => {
    const game = createInitialGameState('t_fizzle_flashback_replay');
    const playerOne = 'p1' as PlayerID;
    const playerTwo = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: playerOne, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: playerTwo, name: 'P2' });
    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'stack_flashback_fizzle_replay',
        type: 'spell',
        controller: playerOne,
        castFromGraveyard: true,
        card: {
          id: 'card_flashback_fizzle_replay',
          name: 'Artful Dodge',
          type_line: 'Sorcery',
          oracle_text: "Target creature can't be blocked this turn.\nFlashback {U}",
          castFromGraveyard: true,
          castWithAbility: 'flashback',
        },
        targets: ['missing_creature_1'],
      },
    });

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect(game.state.stack).toHaveLength(0);
    const playerOneZones = game.state.zones?.[playerOne];
    expect((playerOneZones?.exile || []).map(card => (card as any).id)).toContain('card_flashback_fizzle_replay');
    expect((playerOneZones?.graveyard || []).map(card => (card as any).id)).not.toContain('card_flashback_fizzle_replay');
  });
});