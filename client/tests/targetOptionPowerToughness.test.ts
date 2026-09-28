import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  formatTargetOptionPowerToughness,
  resolveTargetOptionPowerToughness,
} from '../src/utils/targetOptionPowerToughness';
import { PermanentTargetCaption } from '../src/components/TargetSelectionModal-handlers/targetSelectionModalSupport';

const bearCard = { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature - Bear', power: '2', toughness: '2' };

describe('target selection prompt shows current creature P/T', () => {
  it('uses the server-computed effective P/T from the game view, not the printed card', () => {
    const viewPerm = {
      id: 'mine',
      controller: 'p1',
      card: bearCard,
      counters: { '+1/+1': 4 },
      effectivePower: 14,
      effectiveToughness: 14,
    };
    const pt = resolveTargetOptionPowerToughness({ id: 'mine', label: 'Grizzly Bears' }, viewPerm);
    expect(pt).toEqual({ power: 14, toughness: 14, basePower: 2, baseToughness: 2 });
    expect(formatTargetOptionPowerToughness(pt)).toBe('14/14');
  });

  it('falls back to base + counters when the view has no effective P/T', () => {
    const viewPerm = { id: 'mine', controller: 'p1', card: bearCard, counters: { '+1/+1': 12 } };
    expect(resolveTargetOptionPowerToughness({ id: 'mine' }, viewPerm)).toEqual({
      power: 14,
      toughness: 14,
      basePower: 2,
      baseToughness: 2,
    });
  });

  it('omits P/T for non-creature targets', () => {
    const land = { id: 'land', card: { name: 'Forest', type_line: 'Basic Land - Forest' } };
    expect(resolveTargetOptionPowerToughness({ id: 'land' }, land)).toBeUndefined();
  });

  it('renders the current P/T in the target caption', () => {
    const html = renderToStaticMarkup(
      React.createElement(PermanentTargetCaption, {
        target: {
          id: 'mine',
          type: 'permanent',
          name: 'Grizzly Bears',
          controller: 'p1',
          powerToughness: { power: 14, toughness: 14, basePower: 2, baseToughness: 2 },
        },
        viewerPlayerId: 'p1',
      }),
    );
    expect(html).toContain('data-testid="target-option-pt"');
    expect(html).toContain('>14<');
    expect(html).toContain('printed 2/2');
    expect(html).not.toMatch(/>2<\/span><span[^>]*>\/<\/span><span[^>]*>2</);
  });
});