import { describe, it, expect } from 'vitest';
import { canBlockShadowAsThough } from '../src/state/modules/blockAsThoughShadow.js';

const perm = (controller: string, name: string, oracle: string) => ({ id: name, controller, card: { name, type_line: 'Creature', oracle_text: oracle } });

describe('batch22 block shadow as though', () => {
  it('self clause', () => {
    const dryad = perm('p1', 'Heartwood Dryad', 'Heartwood Dryad can block creatures with shadow as though it had shadow.');
    expect(canBlockShadowAsThough(dryad, [dryad])).toBe(true);
    const bear = perm('p1', 'Bear', '');
    expect(canBlockShadowAsThough(bear, [bear, dryad])).toBe(false);
  });
  it('team clause applies to own creatures only', () => {
    const lord = perm('p1', 'Lord', 'Creatures you control can block creatures with shadow as though they had shadow.');
    expect(canBlockShadowAsThough(perm('p1', 'Bear', ''), [lord])).toBe(true);
    expect(canBlockShadowAsThough(perm('p2', 'Bear', ''), [lord])).toBe(false);
  });
});
