import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if evaluator (more templates)', () => {
  it('supports "all nonland permanents you control are white" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_all_nonland_white');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if all nonland permanents you control are white, draw a card.';

    (g.state as any).battlefield = [
      { id: 'l1', controller: p1, card: { type_line: 'Land', colors: [] } },
      { id: 'c1', controller: p1, card: { type_line: 'Creature', colors: ['W'] } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature', colors: ['W'] } },
      { id: 'a1', controller: p1, card: { type_line: 'Artifact', colors: ['U'] } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature', colors: ['W'] } },
      { id: 'u1', controller: p1, card: { type_line: 'Artifact' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "creatures you control have total toughness N or greater" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_total_toughness');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if creatures you control have total toughness ten or greater, draw a card.';

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, toughness: '4' },
      { id: 'c2', controller: p1, card: { type_line: 'Creature' }, toughness: '6' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, toughness: '3' },
      { id: 'c2', controller: p1, card: { type_line: 'Creature' }, toughness: '4' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Conservative: missing toughness info prevents a definitive false.
    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, toughness: '4' },
      { id: 'cX', controller: p1, card: { type_line: 'Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "it was blocked this turn" (positive evidence only)', () => {
    const g = createInitialGameState('t_intervening_if_blocked_this_turn');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature attacks, if it was blocked this turn, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { blockedThisTurn: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { blockedBy: ['x'] })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if no creatures died this turn"', () => {
    const g = createInitialGameState('t_intervening_if_no_creatures_died');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if no creatures died this turn, draw a card.';

    (g.state as any).creatureDiedThisTurn = false;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).creatureDiedThisTurn = true;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    delete (g.state as any).creatureDiedThisTurn;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if no permanents left the battlefield this turn" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_no_permanents_left');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'At the beginning of your upkeep, if no permanents left the battlefield this turn, draw a card.';

    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: false, [p2]: false };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: false, [p2]: true };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Conservative: missing per-player entry => null
    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: false };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if it was cast from your graveyard"', () => {
    const g = createInitialGameState('t_intervening_if_cast_from_graveyard');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature enters the battlefield, if it was cast from your graveyard, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { castSourceZone: 'graveyard' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { castSourceZone: 'hand' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if this creature wasn\'t kicked" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_not_kicked');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When this creature enters the battlefield, if this creature wasn't kicked, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { wasKicked: false })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { wasKicked: true })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if there are no Reflection tokens on the battlefield"', () => {
    const g = createInitialGameState('t_intervening_if_no_reflection_tokens');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if there are no Reflection tokens on the battlefield, draw a card.';

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 't1', controller: p1, isToken: true, card: { name: 'Reflection', type_line: 'Token Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "if this creature is named <Name>"', () => {
    const g = createInitialGameState('t_intervening_if_this_named');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature enters the battlefield, if this creature is named Awestruck Cygnet, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Awestruck Cygnet' } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Not It' } })).toBe(false);
  });

  it('supports "if it didn\'t have decayed" (keyword; conservative)', () => {
    const g = createInitialGameState('t_intervening_if_not_decayed');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When this creature dies, if it didn't have decayed, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { oracle_text: 'Decayed' } })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { oracle_text: 'Flying' } })).toBe(true);

    // Conservative: no keyword info at all => null
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { oracle_text: '' } })).toBe(null);
  });
});
