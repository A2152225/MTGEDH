import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: "if a card left your graveyard this turn"', () => {
  it('is false when tracking exists and is false', () => {
    const g = createInitialGameState('t_if_card_left_gy_false');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).cardLeftGraveyardThisTurn = { [String(p1)]: false };

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a card left your graveyard this turn')
    ).toBe(false);
  });

  it('becomes true when a card is moved from your graveyard via confirmGraveyardTargets', () => {
    const g = createInitialGameState('t_if_card_left_gy_true');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).cardLeftGraveyardThisTurn = { [String(p1)]: false };
    g.state.zones = g.state.zones || {};
    (g.state.zones as any)[String(p1)] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [{ id: 'c1', name: 'Test Card', type_line: 'Sorcery', oracle_text: '', zone: 'graveyard' }],
      graveyardCount: 1,
    };

    g.applyEvent(
      {
        type: 'confirmGraveyardTargets',
        playerId: p1,
        selectedCardIds: ['c1'],
        destination: 'hand',
      } as any
    );

    expect(((g.state as any).cardLeftGraveyardThisTurn || {})[String(p1)]).toBe(true);
    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a card left your graveyard this turn')
    ).toBe(true);
  });

  it("is false when only an opponent's graveyard had a card leave", () => {
    const g = createInitialGameState('t_if_card_left_gy_opponent_only');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

    (g.state as any).cardLeftGraveyardThisTurn = { [String(p1)]: false, [String(p2)]: false };
    g.state.zones = g.state.zones || {};
    (g.state.zones as any)[String(p2)] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [{ id: 'c2', name: 'Opponent Card', type_line: 'Instant', oracle_text: '', zone: 'graveyard' }],
      graveyardCount: 1,
    };

    g.applyEvent(
      {
        type: 'confirmGraveyardTargets',
        playerId: p2,
        selectedCardIds: ['c2'],
        destination: 'hand',
      } as any
    );

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a card left your graveyard this turn')
    ).toBe(false);
  });

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_card_left_gy_null');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).cardLeftGraveyardThisTurn;

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a card left your graveyard this turn')
    ).toBe(null);
  });
});

describe('Intervening-if: "if a creature card left your graveyard this turn"', () => {
  it('is false when tracking exists and is false', () => {
    const g = createInitialGameState('t_if_creature_card_left_gy_false');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).creatureCardLeftGraveyardThisTurn = { [String(p1)]: false };

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a creature card left your graveyard this turn')
    ).toBe(false);
  });

  it('becomes true when a creature card is moved from your graveyard', () => {
    const g = createInitialGameState('t_if_creature_card_left_gy_true');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).creatureCardLeftGraveyardThisTurn = { [String(p1)]: false };
    (g.state as any).cardLeftGraveyardThisTurn = { [String(p1)]: false };

    g.state.zones = g.state.zones || {};
    (g.state.zones as any)[String(p1)] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [{ id: 'c1', name: 'Test Creature', type_line: 'Creature — Bear', oracle_text: '', zone: 'graveyard' }],
      graveyardCount: 1,
    };

    g.applyEvent(
      {
        type: 'confirmGraveyardTargets',
        playerId: p1,
        selectedCardIds: ['c1'],
        destination: 'hand',
      } as any
    );

    expect(((g.state as any).creatureCardLeftGraveyardThisTurn || {})[String(p1)]).toBe(true);
    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a creature card left your graveyard this turn')
    ).toBe(true);
  });

  it('stays false when only a noncreature card left your graveyard', () => {
    const g = createInitialGameState('t_if_creature_card_left_gy_noncreature_only');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).creatureCardLeftGraveyardThisTurn = { [String(p1)]: false };
    (g.state as any).cardLeftGraveyardThisTurn = { [String(p1)]: false };

    g.state.zones = g.state.zones || {};
    (g.state.zones as any)[String(p1)] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [{ id: 'c1', name: 'Test Noncreature', type_line: 'Sorcery', oracle_text: '', zone: 'graveyard' }],
      graveyardCount: 1,
    };

    g.applyEvent(
      {
        type: 'confirmGraveyardTargets',
        playerId: p1,
        selectedCardIds: ['c1'],
        destination: 'hand',
      } as any
    );

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a creature card left your graveyard this turn')
    ).toBe(false);
  });

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_creature_card_left_gy_null');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).creatureCardLeftGraveyardThisTurn;

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if a creature card left your graveyard this turn')
    ).toBe(null);
  });
});
