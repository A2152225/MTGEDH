import { describe, expect, it } from 'vitest';
import { calculateDevotion } from './devotionUtils';

describe('calculateDevotion (shared counter)', () => {
  it('counts hybrid once, ignores other players and phased-out permanents', () => {
    const bf: any[] = [
      { id: 'a', controller: 'p1', card: { mana_cost: '{1}{G}{G}' } },
      { id: 'b', controller: 'p1', card: { mana_cost: '{G/W}' } },
      { id: 'c', controller: 'p2', card: { mana_cost: '{G}' } },
      { id: 'd', controller: 'p1', phasedOut: true, card: { mana_cost: '{G}' } },
    ];
    expect(calculateDevotion(bf, 'p1', 'G')).toBe(3);
    expect(calculateDevotion(bf, 'p1', 'W')).toBe(1);
  });
});
