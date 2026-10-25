import { describe, expect, it } from 'vitest';
import { hasLegalMustAttackDefender } from '../src/socket/combat-handlers/combatDeclareAttackersSupport.js';

describe('ui31 graveyard attack gate in hasLegalMustAttackDefender', () => {
  const terror: any = { id: 't', controller: 'p1', owner: 'p1', card: { name: 'Deep-Sea Terror', type_line: 'Creature', oracle_text: "Deep-Sea Terror can't attack unless there are seven or more cards in your graveyard." } };
  const players = [{ id: 'p1' }, { id: 'p2' }];
  it('is not offered with a small graveyard', () => {
    expect(hasLegalMustAttackDefender(terror, 'p1', players, { zones: { p1: { graveyard: [1, 2] } } })).toBe(false);
  });
  it('is offered with seven cards', () => {
    expect(hasLegalMustAttackDefender(terror, 'p1', players, { zones: { p1: { graveyard: [1, 2, 3, 4, 5, 6, 7] } } })).toBe(true);
  });
});
