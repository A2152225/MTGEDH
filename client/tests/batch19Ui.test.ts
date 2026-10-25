import { describe, expect, it } from 'vitest';
import { createStateEventTracker, collectStateEventToasts } from '../src/utils/stateEventToasts';
import { parseExileAbilities, isPlayableThisTurnFromExile } from '../src/components/ExileViewModal';

const players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];
function toasts(entries: any[], key = 'batch18DrawReplacements') {
  const tr = createStateEventTracker();
  collectStateEventToasts(tr, { id: 'g', players }, 'g');
  return collectStateEventToasts(tr, { id: 'g', players, [key]: entries }, 'g');
}

describe('Batch 19 UI', () => {
  it('draw-replacement toasts read well', () => {
    expect(toasts([
      { playerId: 'p1', sourceName: 'Possessed Portal', effect: 'skipped that draw', timestamp: 1 },
      { playerId: 'p1', sourceName: 'Uba Mask', effect: 'exiled the top card face up instead of drawing', timestamp: 2 },
      { playerId: 'p1', sourceName: 'Forbidden Crypt', effect: 'lost the game (no card to return)', timestamp: 3 },
      { playerId: 'p1', sourceName: 'Notion Thief', effect: 'skipped that draw; p2 draws instead', timestamp: 4 },
    ])).toEqual([
      'Alice (Possessed Portal): skipped that draw.',
      'Alice (Uba Mask): exiled the top card face up instead of drawing.',
      'Alice (Forbidden Crypt): lost the game (no card to return).',
      'Alice (Notion Thief): skipped that draw; Bob draws instead.',
    ]);
  });
  it('combat replacement and prevention-shield messages toast', () => {
    expect(toasts([{ messages: ['Bob: prevented 3 combat damage from Grizzly Bears'], original: 3, amount: 0, timestamp: 5 }], 'damageReplacementLog'))
      .toEqual(['Damage prevented \u2014 Bob: prevented 3 combat damage from Grizzly Bears']);
  });
  it('Uba Mask exile card is playable this turn only', () => {
    const c: any = { id: 'x', name: 'Shock', oracle_text: 'Shock deals 2 damage.', exiledWithSourceId: 'm', ubaMaskExiledTurn: 4 };
    expect(isPlayableThisTurnFromExile(c, 4)).toBe(true);
    expect(parseExileAbilities(c, 4)[0].label).toBe('Playable this turn');
    expect(parseExileAbilities(c, 5)).toEqual([]);
  });
});
