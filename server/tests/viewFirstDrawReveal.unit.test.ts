import { describe, expect, it } from 'vitest';
import { applyFirstDrawRevealToZones } from '../src/state/modules/viewFirstDrawReveal.js';

describe('applyFirstDrawRevealToZones', () => {
  const mk = () => ({ p1: { hand: [{ id: 'c1', name: 'Forest', known: false, revealedOnDraw: ['Primitive Etchings'] }, { id: 'c2', name: 'X', known: false }] } });
  it('shows the revealed first draw to everyone during that turn only', () => {
    const state: any = { turn: 5, revealedDraws: [{ playerId: 'p1', cardId: 'c1', turn: 5 }] };
    const z: any = mk();
    applyFirstDrawRevealToZones(state, z);
    expect(z.p1.hand[0].known).toBe(true);
    expect(z.p1.hand[0].revealedBy).toEqual(['Primitive Etchings']);
    expect(z.p1.hand[1].known).toBe(false);
    const later: any = mk();
    applyFirstDrawRevealToZones({ ...state, turn: 6 }, later);
    expect(later.p1.hand[0].known).toBe(false);
  });
  it('keeps face-down cards hidden', () => {
    const z: any = { p1: { hand: [{ id: 'c1', faceDown: true, known: false, revealedOnDraw: ['Rowen'] }] } };
    applyFirstDrawRevealToZones({ turn: 1, revealedDraws: [{ playerId: 'p1', cardId: 'c1', turn: 1 }] }, z);
    expect(z.p1.hand[0].known).toBe(false);
  });
});
