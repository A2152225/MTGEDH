import { describe, it, expect } from 'vitest';
import {
  isLibraryTopPlotPlayableId,
  libraryTopPlotPlayableId,
  toLibraryTopPlotActionView,
} from '../src/state/modules/libraryTopPlotView.js';

describe('library-top plot special action ids', () => {
  it('uses a distinct playable id from ordinary library-top casts', () => {
    expect(libraryTopPlotPlayableId('p1')).toBe('library-plot-p1');
    expect(isLibraryTopPlotPlayableId('library-plot-p1', 'p1')).toBe(true);
    expect(isLibraryTopPlotPlayableId('library-p1', 'p1')).toBe(false);
  });

  it('projects the server plot action into a view listing', () => {
    const view = toLibraryTopPlotActionView({
      card: { id: 'c1', name: 'Shock', mana_cost: '{R}' },
      cost: '{R}',
      playerId: 'p1',
    });
    expect(view).toEqual({ cardId: 'c1', cardName: 'Shock', cost: '{R}', playerId: 'p1' });
    expect(toLibraryTopPlotActionView(null)).toBeNull();
  });
});
