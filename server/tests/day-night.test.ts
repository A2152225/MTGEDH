import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { nextTurn } from '../src/state/modules/turn';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack';

describe('Day/Night state tracking', () => {
  it('changes day->night based on spells cast by previous active player', () => {
    const g = createInitialGameState('t_day_night_turn_change_day_to_night');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Pretend the game has already become day.
    (g.state as any).dayNight = 'day';

    // nextTurn uses current turnPlayer to compute "last turn" stats.
    (g.state as any).turnPlayer = p1;

    // Previous active player cast 0 spells last turn => becomes night.
    (g.state as any).spellsCastLastTurnByActivePlayerCount = 0;
    nextTurn(g as any);
    expect((g.state as any).dayNight).toBe('night');
    expect((g.state as any).dayNightChangedThisTurn).toBe(true);
    expect((g.state as any).dayNightChangedTo).toBe('night');
  });

  it('changes night->day based on spells cast by previous active player', () => {
    const g = createInitialGameState('t_day_night_turn_change_night_to_day');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).dayNight = 'night';
    (g.state as any).turnPlayer = p1;

    // Previous active player cast 2 spells last turn => becomes day.
    (g.state as any).spellsCastLastTurnByActivePlayerCount = 2;
    nextTurn(g as any);
    expect((g.state as any).dayNight).toBe('day');
    expect((g.state as any).dayNightChangedThisTurn).toBe(true);
    expect((g.state as any).dayNightChangedTo).toBe('day');
  });

  it('applies explicit "it becomes day" / "it becomes night" during resolution', () => {
    const g = createInitialGameState('t_day_night_explicit_effects');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const cards = [
      {
        id: 'day_spell',
        name: 'Day Spell',
        type_line: 'Instant',
        oracle_text: 'It becomes day.',
        mana_cost: '{1}{W}',
        image_uris: undefined,
      },
      {
        id: 'toggle_spell',
        name: 'Toggle Spell',
        type_line: 'Artifact',
        oracle_text: "If it's night, it becomes day. Otherwise, it becomes night.",
        mana_cost: '{3}',
        image_uris: undefined,
      },
      {
        id: 'toggle_spell_2',
        name: 'Toggle Spell 2',
        type_line: 'Artifact',
        oracle_text: "If it's night, it becomes day. Otherwise, it becomes night.",
        mana_cost: '{3}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 3);

    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    // Explicit set-to-day.
    g.applyEvent({ type: 'castSpell', playerId: p1, cardId: 'day_spell' });
    expect(((g.state as any).stack || []).length).toBe(1);
    g.resolveTopOfStack();
    expect((g.state as any).dayNight).toBe('day');
    expect((g.state as any).dayNightChangedThisTurn).toBe(true);
    expect((g.state as any).dayNightChangedTo).toBe('day');

    // Toggle: day -> night.
    g.applyEvent({ type: 'castSpell', playerId: p1, cardId: 'toggle_spell' });
    g.resolveTopOfStack();
    expect((g.state as any).dayNight).toBe('night');
    expect((g.state as any).dayNightChangedThisTurn).toBe(true);
    expect((g.state as any).dayNightChangedTo).toBe('night');

    // Toggle: night -> day.
    g.applyEvent({ type: 'castSpell', playerId: p1, cardId: 'toggle_spell_2' });
    g.resolveTopOfStack();
    expect((g.state as any).dayNight).toBe('day');
    expect((g.state as any).dayNightChangedThisTurn).toBe(true);
    expect((g.state as any).dayNightChangedTo).toBe('day');
  });

  it('does not apply conditional-only day/night changes when the condition is false (or neither day nor night)', () => {
    const g = createInitialGameState('t_day_night_conditional_only_noop');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const cards = [
      {
        id: 'cond_spell_day_to_night',
        name: 'Conditional Spell',
        type_line: 'Instant',
        oracle_text: "If it's day, it becomes night.",
        mana_cost: '{1}{U}',
        image_uris: undefined,
      },
      {
        id: 'cond_spell_night_to_day',
        name: 'Conditional Spell 2',
        type_line: 'Instant',
        oracle_text: "If it's night, it becomes day.",
        mana_cost: '{1}{U}',
        image_uris: undefined,
      },
    ];

    g.importDeckResolved(p1, cards as any);
    g.drawCards(p1, 2);
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    // Neither day nor night: conditional-only text should NOT set dayNight.
    delete (g.state as any).dayNight;
    g.applyEvent({ type: 'castSpell', playerId: p1, cardId: 'cond_spell_day_to_night' });
    g.resolveTopOfStack();
    expect((g.state as any).dayNight).toBe(undefined);

    g.applyEvent({ type: 'castSpell', playerId: p1, cardId: 'cond_spell_night_to_day' });
    g.resolveTopOfStack();
    expect((g.state as any).dayNight).toBe(undefined);
  });

  it('transforms daybound/nightbound permanents when day/night changes', () => {
    const g = createInitialGameState('t_day_night_transforms_dfcs');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const dfc = {
      id: 'dfc_1',
      controller: p1,
      owner: p1,
      transformed: false,
      card: {
        id: 'dfc_card',
        name: 'Front Face',
        layout: 'transform',
        type_line: 'Creature — Werewolf',
        oracle_text: 'Daybound',
        power: '2',
        toughness: '2',
        card_faces: [
          {
            name: 'Front Face',
            type_line: 'Creature — Human Werewolf',
            oracle_text: 'Daybound',
            power: '2',
            toughness: '2',
          },
          {
            name: 'Back Face',
            type_line: 'Creature — Werewolf',
            oracle_text: 'Nightbound',
            power: '3',
            toughness: '3',
          },
        ],
      },
      tapped: false,
    };

    (g.state as any).battlefield.push(dfc);
    (g.state as any).turnPlayer = p1;

    // Start day; turn transition with 0 spells by previous active player makes it night.
    (g.state as any).dayNight = 'day';
    (g.state as any).spellsCastLastTurnByActivePlayerCount = 0;
    nextTurn(g as any);
    expect((g.state as any).dayNight).toBe('night');
    expect((dfc as any).transformed).toBe(true);
    expect(String((dfc as any).card?.oracle_text || '')).toMatch(/nightbound/i);
    expect(String((dfc as any).card?.name || '')).toBe('Back Face');

    // Turn transition with 2 spells by previous active player makes it day, and transforms back.
    (g.state as any).spellsCastLastTurnByActivePlayerCount = 2;
    nextTurn(g as any);
    expect((g.state as any).dayNight).toBe('day');
    expect((dfc as any).transformed).toBe(false);
    expect(String((dfc as any).card?.oracle_text || '')).toMatch(/daybound/i);
    expect(String((dfc as any).card?.name || '')).toBe('Front Face');
  });

  it('applies daybound "enters transformed if it is night" behavior at ETB time', () => {
    const g = createInitialGameState('t_day_night_daybound_enters_transformed');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (g.state as any).dayNight = 'night';

    const entering = {
      id: 'dfc_enter_1',
      controller: p1,
      owner: p1,
      transformed: false,
      card: {
        id: 'dfc_enter_card',
        name: 'Front Face',
        layout: 'transform',
        type_line: 'Creature — Werewolf',
        oracle_text: 'Daybound',
        power: '2',
        toughness: '2',
        card_faces: [
          { name: 'Front Face', type_line: 'Creature — Human Werewolf', oracle_text: 'Daybound', power: '2', toughness: '2' },
          { name: 'Back Face', type_line: 'Creature — Werewolf', oracle_text: 'Nightbound', power: '3', toughness: '3' },
        ],
      },
      tapped: false,
    };

    (g.state as any).battlefield.push(entering);
    triggerETBEffectsForPermanent(g as any, entering, p1);

    expect((entering as any).transformed).toBe(true);
    expect(String((entering as any).card?.oracle_text || '')).toMatch(/nightbound/i);
  });
});
