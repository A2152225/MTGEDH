import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: not suspected + counters-based artifacts + exiled-with-counter', () => {
  it("if it's not suspected: returns null when flag unknown", () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', "if it's not suspected", { id: 'c1' } as any)).toBe(null);
  });

  it("if it's not suspected: returns true/false from suspected flag", () => {
    const g: any = { state: {} };
    expect(evaluateInterveningIfClause(g, 'p1', "if it's not suspected", { id: 'c1', suspected: false } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g, 'p1', "if it's not suspected", { id: 'c1', isSuspected: true } as any)).toBe(false);
  });

  it('artifact loyalty counters: returns null when battlefield not tracked', () => {
    const g: any = { state: {} };
    expect(
      evaluateInterveningIfClause(g, 'p1', 'if this artifact has loyalty counters on it', { id: 'a1', card: { name: 'A' } } as any)
    ).toBe(null);
  });

  it('artifact loyalty counters: returns null when counters tracking absent everywhere', () => {
    const g: any = { state: { battlefield: [{ id: 'a1', controller: 'p1', card: { name: 'A' } }] } };
    const src: any = { id: 'a1', controller: 'p1', card: { name: 'A' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this artifact has loyalty counters on it', src)).toBe(null);
  });

  it('artifact loyalty counters: returns false when counters tracking exists and source has none', () => {
    const g: any = {
      state: {
        battlefield: [
          { id: 'tracker', controller: 'p1', card: { name: 'Tracker' }, counters: {} },
          { id: 'a1', controller: 'p1', card: { name: 'A' } },
        ],
      },
    };
    const src: any = { id: 'a1', controller: 'p1', card: { name: 'A' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this artifact has loyalty counters on it', src)).toBe(false);
  });

  it('artifact loyalty counters: returns true when loyalty > 0', () => {
    const g: any = {
      state: {
        battlefield: [
          { id: 'tracker', controller: 'p1', card: { name: 'Tracker' }, counters: {} },
          { id: 'a1', controller: 'p1', card: { name: 'A' }, counters: { loyalty: 1 } },
        ],
      },
    };
    const src: any = { id: 'a1', controller: 'p1', card: { name: 'A' }, counters: { loyalty: 1 } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this artifact has loyalty counters on it', src)).toBe(true);
  });

  it('artifact charge counters (N or more): returns deterministic false/true when tracking exists', () => {
    const g: any = {
      state: {
        battlefield: [
          { id: 'tracker', controller: 'p1', card: { name: 'Tracker' }, counters: {} },
          { id: 'a1', controller: 'p1', card: { name: 'A' }, counters: { charge: 2 } },
        ],
      },
    };
    const src: any = { id: 'a1', controller: 'p1', card: { name: 'A' }, counters: { charge: 2 } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this artifact has three or more charge counters on it', src)).toBe(false);

    src.counters.charge = 3;
    expect(evaluateInterveningIfClause(g, 'p1', 'if this artifact has three or more charge counters on it', src)).toBe(true);
  });

  it('exiled-with-counter: returns null when counters tracking absent everywhere', () => {
    const g: any = { state: { battlefield: [] } };
    const src: any = { id: 'x1', zone: 'exile', card: { name: 'Exiled Card' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this card is exiled with an oil counter on it', src)).toBe(null);
  });

  it('exiled-with-counter: returns false when tracking exists and the card has no counters object', () => {
    const g: any = {
      state: {
        battlefield: [{ id: 'tracker', controller: 'p1', card: { name: 'Tracker' }, counters: {} }],
      },
    };
    const src: any = { id: 'x1', zone: 'exile', card: { name: 'Exiled Card' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this card is exiled with an oil counter on it', src)).toBe(false);
  });

  it('exiled-with-counter: returns true when the exiled card has the counter', () => {
    const g: any = {
      state: {
        battlefield: [{ id: 'tracker', controller: 'p1', card: { name: 'Tracker' }, counters: {} }],
      },
    };
    const src: any = { id: 'x1', zone: 'exile', card: { name: 'Exiled Card' }, counters: { oil: 1 } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if this card is exiled with an oil counter on it', src)).toBe(true);
  });
});
