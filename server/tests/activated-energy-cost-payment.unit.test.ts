import { describe, expect, it } from 'vitest';
import { parseEnergyCost, payEnergyCost, energyCostError } from '../src/state/modules/equipNonManaCosts.js';

describe('activated ability energy cost payment', () => {
  it('parses Pay {E}{E} and bare {E}{E} costs', () => {
    expect(parseEnergyCost('Pay {E}{E}')).toBe(2);
    expect(parseEnergyCost('{E}{E}')).toBe(2);
    expect(parseEnergyCost('{E}{E}{E}')).toBe(3);
  });

  it('pays energy from the player pool', () => {
    const state: any = { energy: { p1: 3 } };
    expect(energyCostError(state, 'p1', 'Pay {E}{E}')).toBeNull();
    expect(payEnergyCost(state, 'p1', 'Pay {E}{E}')).toBe(true);
    expect(state.energy.p1).toBe(1);
  });

  it('rejects when the player lacks energy', () => {
    const state: any = { energy: { p1: 1 } };
    expect(energyCostError(state, 'p1', 'Pay {E}{E}')).toMatch(/need 2 energy/i);
    expect(payEnergyCost(state, 'p1', 'Pay {E}{E}')).toBe(false);
    expect(state.energy.p1).toBe(1);
  });
});
