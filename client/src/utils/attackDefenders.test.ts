import { describe, expect, it } from 'vitest';
import { buildAttackDefenders } from './attackDefenders';

describe('buildAttackDefenders', () => {
  it("offers opponents' planeswalkers and battles, never your own", () => {
    const players = [{ id: 'p1', name: 'Me' }, { id: 'p2', name: 'Opp' }];
    const battlefield = [
      { id: 'pw2', controller: 'p2', card: { name: "Freyalise, Llanowar's Fury", type_line: 'Legendary Planeswalker — Freyalise' } },
      { id: 'pw1', controller: 'p1', card: { name: 'Mine', type_line: 'Legendary Planeswalker — X' } },
      { id: 'bt', controller: 'p1', protector: 'p2', card: { name: 'Invasion of Ikoria', type_line: 'Battle — Siege' } },
      { id: 'c2', controller: 'p2', card: { name: 'Bear', type_line: 'Creature — Bear' } },
    ];
    expect(buildAttackDefenders(players, battlefield, 'p1').map((d) => d.id)).toEqual(['p2', 'pw2', 'bt']);
  });
});