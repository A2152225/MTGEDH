import { describe, expect, it } from 'vitest';

import {
  canPayManaCostWithSpendAsThough,
  canSpendManaAs,
  getManaSpendAsThoughRules,
  payManaCostWithSpendAsThough,
} from '../src/state/modules/manaSpendAsThough.js';
import { canPayManaCost } from '../src/state/modules/mana-check-handlers/manaCheckCanPayManaCost.js';
import { canPayManaCostWithAvailableSources } from '../src/state/modules/mana-check-handlers/manaCheckCanPayWithSources.js';

const LATTICE = "All permanents are artifacts in addition to their other types.\nAll cards that aren't on the battlefield, spells, and permanents are colorless.\nPlayers may spend mana as though it were mana of any color.";
const DAWN = 'Lands you control are Plains.\nNonland permanents you control are white. The same is true for spells you control and nonland cards you own that aren\'t on the battlefield.\nYou may spend white mana as though it were mana of any color. You may spend other mana only as though it were colorless mana.';

function stateWith(permanents: any[]) {
  return { battlefield: permanents, manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } } };
}

describe('Celestial Dawn and Mycosynth Lattice spend-as-though', () => {
  it('reads Lattice as any-color spend for every player', () => {
    const rules = getManaSpendAsThoughRules(stateWith([{
      id: 'lat', controller: 'p2', card: { name: 'Mycosynth Lattice', oracle_text: LATTICE, type_line: 'Artifact' },
    }]), 'p1');
    expect(rules.anyColor).toBe(true);
    expect(canSpendManaAs('blue', 'white', rules)).toBe(true);
    expect(canSpendManaAs('blue', 'colorless', rules)).toBe(false);
  });

  it("lets Dawn's controller spend white as any color, and other mana only as colorless", () => {
    const rules = getManaSpendAsThoughRules(stateWith([{
      id: 'dawn', controller: 'p1', card: { name: 'Celestial Dawn', oracle_text: DAWN, type_line: 'Enchantment' },
    }]), 'p1');
    expect(rules.colorAsAny).toBe('white');
    expect(rules.otherOnlyColorless).toBe(true);
    expect(canSpendManaAs('white', 'blue', rules)).toBe(true);
    expect(canSpendManaAs('white', 'colorless', rules)).toBe(false);
    expect(canSpendManaAs('blue', 'blue', rules)).toBe(false);
    expect(canSpendManaAs('blue', 'colorless', rules)).toBe(true);
    expect(canSpendManaAs('blue', 'generic', rules)).toBe(true);

    const opponent = getManaSpendAsThoughRules(stateWith([{
      id: 'dawn', controller: 'p1', card: { name: 'Celestial Dawn', oracle_text: DAWN, type_line: 'Enchantment' },
    }]), 'p2');
    expect(opponent.colorAsAny).toBeNull();
    expect(opponent.otherOnlyColorless).toBe(false);
  });

  it('pays {U} from white mana under Dawn and refuses to pay {U} from blue', () => {
    const dawn = getManaSpendAsThoughRules(stateWith([{
      id: 'dawn', controller: 'p1', card: { name: 'Celestial Dawn', oracle_text: DAWN, type_line: 'Enchantment' },
    }]), 'p1');
    expect(canPayManaCostWithSpendAsThough({ white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, { colors: { U: 1 }, generic: 0 }, dawn)).toBe(true);
    expect(canPayManaCostWithSpendAsThough({ white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 }, { colors: { U: 1 }, generic: 0 }, dawn)).toBe(false);
    const pool = { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    expect(payManaCostWithSpendAsThough(pool, { colors: { blue: 1 }, generic: 0 }, dawn)).toBe(true);
    expect(pool.white).toBe(0);
  });

  it('hooks canPayManaCost and canPayManaCostWithAvailableSources for a Dawn controller pool', () => {
    const state = stateWith([{
      id: 'dawn', controller: 'p1', card: { name: 'Celestial Dawn', oracle_text: DAWN, type_line: 'Enchantment' },
    }]);
    (state as any).manaPool = { p1: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    const rules = getManaSpendAsThoughRules(state, 'p1');
    expect(canPayManaCost(state.manaPool.p1, { colors: { U: 1 }, generic: 0, hasX: false }, Infinity, rules)).toBe(true);
    expect(canPayManaCostWithAvailableSources(state, 'p1' as any, { colors: { U: 1 }, generic: 0, hasX: false } as any)).toBe(true);

    const noDawn = stateWith([]);
    (noDawn as any).manaPool = { p1: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    expect(canPayManaCostWithAvailableSources(noDawn, 'p1' as any, { colors: { U: 1 }, generic: 0, hasX: false } as any)).toBe(false);
  });
});
