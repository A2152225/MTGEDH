import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context.js';
import { calculateModifiedDamage } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsMillDamage.js';

type S = { battlefield: unknown[]; players: Array<{ id: string; life: number }>; life: Record<string, number> };
// Single fixture adapter: tests build plain state objects, the API takes a GameContext.
const ctxOf = (state: S): GameContext => ({ state, libraries: new Map() }) as unknown as GameContext;
const base = (bf: unknown[]): S => ({ battlefield: bf, players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 } });
const FATED = 'If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus an amount of damage equal to the number of fire counters on this enchantment instead.';
const TUSK = 'Trample\nIf this creature would deal combat damage to a player, it deals double that damage to that player instead.';
const fated = (fire: number) => ({ id: 'ff', controller: 'p1', owner: 'p1', counters: { fire }, card: { name: 'Fated Firepower', type_line: 'Enchantment', oracle_text: FATED } });
const tusk = { id: 'ct', controller: 'p1', owner: 'p1', card: { name: 'Charging Tuskodon', type_line: 'Creature — Dinosaur', oracle_text: TUSK } };
const bear = { id: 'gb', controller: 'p1', owner: 'p1', card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' } };

describe('batch21 damage scaling replacements', () => {
  it('Fated Firepower adds its fire counters to damage dealt to an opponent', () => {
    const s = base([fated(3), bear]);
    expect(calculateModifiedDamage(ctxOf(s), 2, 'p1', 'p2', 'gb', false).amount).toBe(5);
  });
  it('Fated Firepower does not boost damage to its controller, nor with 0 counters', () => {
    expect(calculateModifiedDamage(ctxOf(base([fated(3), bear])), 2, 'p1', 'p1', 'gb', false).amount).toBe(2);
    expect(calculateModifiedDamage(ctxOf(base([fated(0), bear])), 2, 'p1', 'p2', 'gb', false).amount).toBe(2);
  });
  it('Far Fortune adds 1 only at max speed', () => {
    const ff = { id: 'fo', controller: 'p1', owner: 'p1', card: { name: 'Far Fortune, End Boss', type_line: 'Legendary Creature', oracle_text: 'Max speed \u2014 If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.' } };
    expect(calculateModifiedDamage(ctxOf(base([ff, bear])), 2, 'p1', 'p2', 'gb', false).amount).toBe(2);
    const fast = { ...base([ff, bear]), speed: { p1: 4 } };
    expect(calculateModifiedDamage(ctxOf(fast), 2, 'p1', 'p2', 'gb', false).amount).toBe(3);
  });
  it('Charging Tuskodon doubles only its own combat damage to a player', () => {
    const s = base([tusk, bear]);
    expect(calculateModifiedDamage(ctxOf(s), 4, 'p1', 'p2', 'ct', true).amount).toBe(8);
    expect(calculateModifiedDamage(ctxOf(s), 4, 'p1', 'p2', 'ct', false).amount).toBe(4);
    expect(calculateModifiedDamage(ctxOf(s), 2, 'p1', 'p2', 'gb', true).amount).toBe(2);
  });
});
