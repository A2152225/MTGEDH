import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';
import { movePermanentToHand } from '../src/state/modules/zones';

describe('Intervening-if: "if a creature card was put into your graveyard from anywhere this turn"', () => {
  const clause = 'if a creature card was put into your graveyard from anywhere this turn';

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_creature_card_put_gy_missing');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).creatureCardPutIntoYourGraveyardThisTurn;

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);
  });

  it('is false when tracking exists and is false', () => {
    const g = createInitialGameState('t_if_creature_card_put_gy_false');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).creatureCardPutIntoYourGraveyardThisTurn = { [String(p1)]: false };

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);
  });

  it('becomes true when a creature card is discarded to graveyard', () => {
    const g = createInitialGameState('t_if_creature_card_put_gy_true');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).creatureCardPutIntoYourGraveyardThisTurn = { [String(p1)]: false };

    (g.state as any).zones[String(p1)].hand.push({
      id: 'c1',
      name: 'Test Creature',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    (g.state as any).zones[String(p1)].handCount = (g.state as any).zones[String(p1)].hand.length;

    g.applyEvent({ type: 'cleanupDiscard', playerId: p1, cardIds: ['c1'] } as any);

    expect((g.state as any).creatureCardPutIntoYourGraveyardThisTurn[String(p1)]).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(true);
  });

  it('stays false when only a noncreature card was put into your graveyard', () => {
    const g = createInitialGameState('t_if_creature_card_put_gy_noncreature_only');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).creatureCardPutIntoYourGraveyardThisTurn = { [String(p1)]: false };

    (g.state as any).zones[String(p1)].hand.push({
      id: 'c1',
      name: 'Test Sorcery',
      type_line: 'Sorcery',
      oracle_text: '',
    });
    (g.state as any).zones[String(p1)].handCount = (g.state as any).zones[String(p1)].hand.length;

    g.applyEvent({ type: 'cleanupDiscard', playerId: p1, cardIds: ['c1'] } as any);

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);
  });
});

describe('Intervening-if: "if a permanent was put into your hand from the battlefield this turn"', () => {
  const clause = 'if a permanent was put into your hand from the battlefield this turn';

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_perm_put_hand_missing');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).permanentPutIntoHandFromBattlefieldThisTurn;

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);
  });

  it('is false when tracking exists and is false', () => {
    const g = createInitialGameState('t_if_perm_put_hand_false');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).permanentPutIntoHandFromBattlefieldThisTurn = { [String(p1)]: false };

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);
  });

  it('becomes true when a nontoken permanent is bounced from battlefield to hand', () => {
    const g = createInitialGameState('t_if_perm_put_hand_true');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).permanentPutIntoHandFromBattlefieldThisTurn = { [String(p1)]: false };

    (g.state as any).battlefield = [
      {
        id: 'perm1',
        owner: p1,
        controller: p1,
        isToken: false,
        card: { id: 'card1', name: 'Test Permanent', type_line: 'Artifact', oracle_text: '' },
      },
    ];

    expect(movePermanentToHand(g as any, 'perm1')).toBe(true);

    expect((g.state as any).permanentPutIntoHandFromBattlefieldThisTurn[String(p1)]).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(true);
  });
});

describe('Intervening-if: "if another <subtype> entered ... this turn" (generic)', () => {
  it('excludes the source permanent itself when it entered this turn', () => {
    const g = createInitialGameState('t_if_another_human_entered_excludes_self');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = {
      [String(p1)]: { human: 1 },
    };

    const sourcePermanent = {
      controller: p1,
      enteredThisTurn: true,
      card: { type_line: 'Creature — Human Soldier' },
    };

    expect(
      evaluateInterveningIfClause(
        g as any,
        String(p1),
        'if another Human entered the battlefield under your control this turn',
        sourcePermanent
      )
    ).toBe(false);
  });

  it('is true when there was an additional matching creature', () => {
    const g = createInitialGameState('t_if_another_human_entered_true');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = {
      [String(p1)]: { human: 2 },
    };

    const sourcePermanent = {
      controller: p1,
      enteredThisTurn: true,
      card: { type_line: 'Creature — Human Soldier' },
    };

    expect(
      evaluateInterveningIfClause(
        g as any,
        String(p1),
        'if another Human entered the battlefield under your control this turn',
        sourcePermanent
      )
    ).toBe(true);
  });
});
