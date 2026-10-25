import { describe, it, expect } from 'vitest';
import { applyRevealedInformationToZones, revealSourcesByPlayer } from '../src/state/modules/viewRevealedInformation.js';
import { computeRevealedInformation } from '../src/state/modules/revealedInformationFlags.js';

const mk = () => {
  const state: any = {
    players: [{ id: 'p1' }, { id: 'p2' }],
    battlefield: [
      { id: 't', controller: 'p1', owner: 'p1', card: { name: 'Telepathy', type_line: 'Enchantment', oracle_text: 'Your opponents play with their hands revealed.' } },
      { id: 'f', controller: 'p2', owner: 'p2', card: { name: 'Future Sight', type_line: 'Enchantment', oracle_text: 'Play with the top card of your library revealed.\nYou may play lands and cast spells from the top of your library.' } },
    ],
  };
  state.revealedInformation = computeRevealedInformation(state);
  return state;
};

describe('viewRevealedInformation', () => {
  it('attributes sources per player', () => {
    const s = mk();
    const src = revealSourcesByPlayer(s);
    expect(src.hand.get('p2')).toEqual(['Telepathy']);
    expect(src.hand.has('p1')).toBe(false);
    expect(src.top.get('p2')).toEqual(['Future Sight']);
  });
  it('marks revealed hands known and sends revealed library top', () => {
    const s = mk();
    const zones: any = {
      p1: { hand: [{ id: 'a', known: false }] },
      p2: { hand: [{ id: 'b', name: 'Bolt', known: false }, { id: 'c', faceDown: true, known: false }] },
    };
    applyRevealedInformationToZones(s, zones, (pid) => (pid === 'p2' ? { id: 'top', name: 'Island', type_line: 'Basic Land' } : undefined));
    expect(zones.p1.hand[0].known).toBe(false);
    expect(zones.p2.hand[0]).toMatchObject({ known: true, revealedBy: ['Telepathy'] });
    expect(zones.p2.hand[1].known).toBe(false);
    expect(zones.p2.handRevealedBy).toEqual(['Telepathy']);
    expect(zones.p2.libraryTop).toMatchObject({ id: 'top', name: 'Island', revealedToAll: true, revealedBy: ['Future Sight'] });
    expect(zones.p1.libraryTop).toBeUndefined();
  });
  it('no-op without revealedInformation', () => {
    const zones: any = { p1: { hand: [{ id: 'a', known: false }] } };
    applyRevealedInformationToZones({ battlefield: [] }, zones, () => ({ id: 'x' }));
    expect(zones.p1.hand[0].known).toBe(false);
  });
});
