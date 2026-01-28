import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';
import { movePermanentToHand } from '../src/state/modules/zones';
import { recordCardPutIntoGraveyardThisTurn } from '../src/state/modules/turn-tracking';

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

describe('Intervening-if: graveyard card-count thresholds', () => {
  it('supports "if three or more cards were put into your graveyard this turn from anywhere"', () => {
    const clause = 'if three or more cards were put into your graveyard this turn from anywhere';
    const g = createInitialGameState('t_if_3_cards_put_gy_anywhere');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).cardsPutIntoYourGraveyardThisTurn;
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).cardsPutIntoYourGraveyardThisTurn = { [String(p1)]: 0 };

    recordCardPutIntoGraveyardThisTurn(g as any, String(p1), { id: 'c1', type_line: 'Instant' }, { fromBattlefield: false });
    recordCardPutIntoGraveyardThisTurn(g as any, String(p1), { id: 'c2', type_line: 'Sorcery' }, { fromBattlefield: false });
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);

    recordCardPutIntoGraveyardThisTurn(g as any, String(p1), { id: 'c3', type_line: 'Creature — Bear' }, { fromBattlefield: false });
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(true);
  });

  it('supports "if three or more cards were put into your graveyard from anywhere other than the battlefield this turn"', () => {
    const clause = 'if three or more cards were put into your graveyard from anywhere other than the battlefield this turn';
    const g = createInitialGameState('t_if_3_cards_put_gy_nonbattlefield');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn;
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn = { [String(p1)]: 0 };

    // A battlefield->graveyard event should NOT increment the nonbattlefield counter.
    recordCardPutIntoGraveyardThisTurn(g as any, String(p1), { id: 'b1', type_line: 'Artifact' }, { fromBattlefield: true });
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);

    recordCardPutIntoGraveyardThisTurn(g as any, String(p1), { id: 'c1', type_line: 'Instant' }, { fromBattlefield: false });
    recordCardPutIntoGraveyardThisTurn(g as any, String(p1), { id: 'c2', type_line: 'Sorcery' }, { fromBattlefield: false });
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);

    recordCardPutIntoGraveyardThisTurn(g as any, String(p1), { id: 'c3', type_line: 'Creature — Bear' }, { fromBattlefield: false });
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(true);
  });
});

describe('Intervening-if: "if a land you controlled was put into a graveyard from the battlefield this turn"', () => {
  const clause = 'if a land you controlled was put into a graveyard from the battlefield this turn';

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_land_controlled_put_gy_bf_missing');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).landYouControlledPutIntoGraveyardFromBattlefieldThisTurn;

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);
  });

  it('is false when tracking exists and is false', () => {
    const g = createInitialGameState('t_if_land_controlled_put_gy_bf_false');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).landYouControlledPutIntoGraveyardFromBattlefieldThisTurn = { [String(p1)]: false };

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);
  });

  it('becomes true when a land you controlled is recorded as put into a graveyard from the battlefield', () => {
    const g = createInitialGameState('t_if_land_controlled_put_gy_bf_true');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).landYouControlledPutIntoGraveyardFromBattlefieldThisTurn = { [String(p1)]: false };

    recordCardPutIntoGraveyardThisTurn(
      g as any,
      String(p1),
      { id: 'l1', name: 'Test Land', type_line: 'Land', oracle_text: '' },
      { fromBattlefield: true, controllerId: String(p1) }
    );

    expect((g.state as any).landYouControlledPutIntoGraveyardFromBattlefieldThisTurn[String(p1)]).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(true);
  });
});

describe('Intervening-if: "if an enchantment was put into your graveyard from the battlefield this turn"', () => {
  const clause = 'if an enchantment was put into your graveyard from the battlefield this turn';

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_enchant_put_gy_bf_missing');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn;

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);
  });

  it('is false when tracking exists and is false', () => {
    const g = createInitialGameState('t_if_enchant_put_gy_bf_false');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn = { [String(p1)]: false };

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);
  });

  it('becomes true when an enchantment is recorded as put into your graveyard from the battlefield', () => {
    const g = createInitialGameState('t_if_enchant_put_gy_bf_true');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn = { [String(p1)]: false };

    recordCardPutIntoGraveyardThisTurn(
      g as any,
      String(p1),
      { id: 'e1', name: 'Test Enchantment', type_line: 'Enchantment', oracle_text: '' },
      { fromBattlefield: true, controllerId: String(p1) }
    );

    expect((g.state as any).enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn[String(p1)]).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(true);
  });
});

describe('Intervening-if: "if an artifact or creature was put into a graveyard from the battlefield this turn"', () => {
  const clause = 'if an artifact or creature was put into a graveyard from the battlefield this turn';

  it('is null when tracking is missing', () => {
    const g = createInitialGameState('t_if_art_or_creature_put_gy_bf_missing');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    delete (g.state as any).artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn;

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(null);
  });

  it('is false when tracking exists and is false', () => {
    const g = createInitialGameState('t_if_art_or_creature_put_gy_bf_false');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    (g.state as any).artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn = false;

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);
  });

  it('becomes true when an artifact is recorded as put into a graveyard from the battlefield', () => {
    const g = createInitialGameState('t_if_art_or_creature_put_gy_bf_true');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn = false;

    recordCardPutIntoGraveyardThisTurn(
      g as any,
      String(p1),
      { id: 'a1', name: 'Test Artifact', type_line: 'Artifact', oracle_text: '' },
      { fromBattlefield: true }
    );

    expect((g.state as any).artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(true);
  });

  it('stays false when only a nonbattlefield card was recorded as put into graveyard', () => {
    const g = createInitialGameState('t_if_art_or_creature_put_gy_bf_nonbattlefield_only');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    // Initialize per-turn tracking like nextTurn() would.
    (g.state as any).artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn = false;

    recordCardPutIntoGraveyardThisTurn(
      g as any,
      String(p1),
      { id: 'a1', name: 'Test Artifact', type_line: 'Artifact', oracle_text: '' },
      { fromBattlefield: false }
    );

    expect(evaluateInterveningIfClause(g as any, String(p1), clause)).toBe(false);
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
