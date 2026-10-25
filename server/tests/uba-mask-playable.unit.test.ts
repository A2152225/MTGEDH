import { describe, it, expect } from 'vitest';
import { getPlayableExileCardsForPlayer } from '../src/state/modules/playable-from-exile';

const mk = (turn: number, mask: boolean) => ({
  turnNumber: turn, turn,
  battlefield: mask ? [{ id: 'mask', controller: 'p1', card: { name: 'Uba Mask' } }] : [],
  zones: { p1: { exile: [{ id: 'c1', name: 'Bear', zone: 'exile', faceUp: true, exiledWithSourceId: 'mask', ubaMaskExiledTurn: 3,
    canBePlayedBy: 'p1', playableUntilTurn: 3, playFromExileRequiresSourcePermanentId: 'mask', exiledBy: 'p1' }] } },
});
describe('Uba Mask playable from exile', () => {
  it('is playable this turn while the Mask stays', () => {
    expect(getPlayableExileCardsForPlayer(mk(3, true), 'p1').map((c: any) => c.id)).toContain('c1');
  });
  it('not after the Mask leaves or next turn', () => {
    expect(getPlayableExileCardsForPlayer(mk(3, false), 'p1').map((c: any) => c.id)).not.toContain('c1');
    expect(getPlayableExileCardsForPlayer(mk(4, true), 'p1').map((c: any) => c.id)).not.toContain('c1');
  });
});
