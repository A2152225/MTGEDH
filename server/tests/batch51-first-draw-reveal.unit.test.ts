import { describe, expect, it } from 'vitest';
import { applyFirstDrawReveal, firstDrawRevealSources } from '../src/state/modules/firstDrawRevealStatic.js';

// B51: "Reveal the first card you draw each turn" static.
const ETCHINGS = { id: 'pe', controller: 'p1', card: { name: 'Primitive Etchings', oracle_text: 'Reveal the first card you draw each turn. Whenever you reveal a creature card this way, draw a card.' } };
const KERANOS = { id: 'kr', controller: 'p1', card: { name: 'Keranos, God of Storms', oracle_text: 'Reveal the first card you draw on each of your turns. Whenever you reveal a land card this way, draw a card.' } };

describe('B51 first-draw reveal static', () => {
  it('reveals the first draw and records the source', () => {
    const ctx: any = { state: { battlefield: [ETCHINGS], turnPlayer: 'p2' } };
    const card: any = { id: 'c1', name: 'Grizzly Bears', type_line: 'Creature - Bear' };
    expect(applyFirstDrawReveal(ctx, 'p1', 1, card)).toEqual(['Primitive Etchings']);
    expect(card.revealedOnDraw).toEqual(['Primitive Etchings']);
    expect(ctx.state.lastRevealedDraw).toMatchObject({ playerId: 'p1', cardId: 'c1', name: 'Grizzly Bears' });
  });
  it('does not reveal the second draw or an opponent draw', () => {
    const ctx: any = { state: { battlefield: [ETCHINGS], turnPlayer: 'p1' } };
    expect(applyFirstDrawReveal(ctx, 'p1', 2, { id: 'c2' })).toEqual([]);
    expect(applyFirstDrawReveal(ctx, 'p2', 1, { id: 'c3' })).toEqual([]);
    expect(ctx.state.revealedDraws).toBeUndefined();
  });
  it('"on each of your turns" only applies on the controller turn', () => {
    expect(firstDrawRevealSources({ battlefield: [KERANOS], turnPlayer: 'p2' }, 'p1')).toEqual([]);
    expect(firstDrawRevealSources({ battlefield: [KERANOS], turnPlayer: 'p1' }, 'p1')).toEqual(['Keranos, God of Storms']);
  });
});
