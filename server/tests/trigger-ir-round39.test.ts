import { describe, expect, it } from 'vitest';
import { getOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { getCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
import { isInterveningIfSatisfied, evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if.js';

const zone = () => ({ hand: [], graveyard: [] as any[], exile: [], library: [] });
const perm = (id: string, controller: string, name: string, type_line: string, oracle_text: string, extra: any = {}) => ({ id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name, type_line, oracle_text } });
const ctxOf = (battlefield: any[], extra: any = {}) => ({ gameId: 'r39', isReplaying: false, state: { battlefield, stack: [] as any[], turnPlayer: 'p1', activePlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }], zones: { p1: zone(), p2: zone() }, ...extra } } as any);

describe('round 39', () => {
  it('Kai Winn: opponent spell with the chosen name only', () => {
    const kai = perm('kai', 'p1', 'Kai Winn', 'Legendary Creature', 'As Kai Winn enters, choose a card name.\nWhenever an opponent casts a spell with the chosen name or activates an ability of a source with the chosen name, that player loses 3 life.', { chosenCardName: 'Lightning Bolt' });
    const bf = [kai];
    const bolt = getOpponentSpellCastTriggers(bf, 'p2', { name: 'Lightning Bolt', type_line: 'Instant' }, ['p1', 'p2']);
    expect(bolt).toHaveLength(1);
    expect(String((bolt[0] as any).benefitIfNotPaid || (bolt[0] as any).effect)).toMatch(/^that player loses 3 life/);
    expect(getOpponentSpellCastTriggers(bf, 'p2', { name: 'Shock', type_line: 'Instant' }, ['p1', 'p2'])).toHaveLength(0);
    expect(getOpponentSpellCastTriggers(bf, 'p1', { name: 'Lightning Bolt', type_line: 'Instant' }, ['p1', 'p2'])).toHaveLength(0);
    const unnamed = perm('kai2', 'p1', 'Kai Winn', 'Legendary Creature', kai.card.oracle_text);
    expect(getOpponentSpellCastTriggers([unnamed], 'p2', { name: 'Lightning Bolt', type_line: 'Instant' }, ['p1', 'p2'])).toHaveLength(0);
  });

  it('Enterprise-D keeps the impulse play rider', () => {
    const ent = perm('ent', 'p1', 'U.S.S. Enterprise-D, Galaxy-Class', 'Legendary Artifact - Spacecraft', 'Whenever one or more charge counters are put on U.S.S. Enterprise-D for the first time each turn, exile the top card of your library. You may play that card this turn.');
    const hits = getCounterPlacedTriggers(ctxOf([ent]), ent, { charge: 1 });
    expect(hits[0].effect).toBe('exile the top card of your library. You may play that card this turn.');
  });

  it('Miles: permanent returned to your hand from the battlefield this turn', () => {
    const text = 'At the beginning of each end step, if a permanent was returned to your hand from the battlefield this turn, draw a card.';
    const miles = perm('m', 'p1', "Miles O'Brien", 'Legendary Creature', text);
    expect(isInterveningIfSatisfied(ctxOf([miles], { permanentPutIntoHandFromBattlefieldThisTurn: { p1: false } }), 'p1', text, miles)).toBe(false);
    expect(isInterveningIfSatisfied(ctxOf([miles], { permanentPutIntoHandFromBattlefieldThisTurn: { p1: true } }), 'p1', text, miles)).toBe(true);
  });

  it('Sulu: Equipment or Spacecraft entered under your control this turn', () => {
    const text = 'Whenever Sulu becomes tapped, if an Equipment or Spacecraft entered the battlefield under your control this turn, draw a card.';
    const sulu = perm('s', 'p1', 'Sulu', 'Legendary Creature', text);
    const ship = perm('ship', 'p1', 'Shuttle', 'Artifact - Spacecraft', '', { enteredThisTurn: true });
    const oppShip = perm('ship2', 'p2', 'Shuttle', 'Artifact - Spacecraft', '', { enteredThisTurn: true });
    expect(isInterveningIfSatisfied(ctxOf([sulu, oppShip]), 'p1', text, sulu)).toBe(false);
    expect(isInterveningIfSatisfied(ctxOf([sulu, ship]), 'p1', text, sulu)).toBe(true);
  });

  it('Targ Wrangler: this creature attacked this turn', () => {
    const text = 'At the beginning of your end step, if this creature attacked this turn, sacrifice a nonland permanent.';
    const targ = perm('t', 'p1', 'Targ Wrangler', 'Creature', text);
    (targ as any).attackedThisTurn = false; // reset at turn start
    expect(isInterveningIfSatisfied(ctxOf([targ]), 'p1', text, targ)).toBe(false);
    (targ as any).attackedThisTurn = true;
    expect(isInterveningIfSatisfied(ctxOf([targ]), 'p1', text, targ)).toBe(true);
  });

  it('unknown intervening-if clauses are recorded and do not fire as if met', () => {
    const text = 'At the beginning of your upkeep, if the moon is made of cheese tonight, draw a card.';
    const src = perm('x', 'p1', 'Odd', 'Creature', text);
    const ctx = ctxOf([src]);
    expect(isInterveningIfSatisfied(ctx, 'p1', text, src)).toBe(false);
    expect(ctx.state.unknownInterveningIfClauses['if the moon is made of cheese tonight']).toBe(1);
  });
});
