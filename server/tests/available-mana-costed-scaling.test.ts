import { describe, expect, it } from 'vitest';
import { getAvailableMana } from '../src/state/modules/mana-check-handlers/manaCheckAvailableMana';
import { getTotalManaFromPool } from '../src/state/modules/mana-check-handlers/manaCheckCanPayManaCost';

// getAvailableMana must not over-count: count-based sources produce what actually matches
// (0 with nothing), and mana-costed / sacrifice activations net out a cost the rest of the
// pool can pay (and don't count at all when it can't).
const perm = (id: string, name: string, typeLine: string, oracle: string, extra: Record<string, unknown> = {}) => ({
  id, controller: 'p1', owner: 'p1', tapped: false, card: { id: `${id}_card`, name, type_line: typeLine, oracle_text: oracle }, ...extra,
});
const swamp = (i: number) => perm(`sw${i}`, 'Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)');
const bear = (i: number) => perm(`bear${i}`, 'Grizzly Bears', 'Creature — Bear', '');
const cradle = () => perm('cradle', "Gaea's Cradle", 'Legendary Land', '{T}: Add {G} for each creature you control.');
const coffers = () => perm('coffers', 'Cabal Coffers', 'Land', '{2}, {T}: Add {B} for each Swamp you control.');
const swampPriest = () => perm('priest', 'Swamp Counter', 'Creature — Human Cleric', '{T}: Add {B} for each Swamp you control.');
const sacRock = () => perm('rock', 'Costed Rock', 'Artifact', '{1}, {T}, Sacrifice Costed Rock: Add {C}{C}.');
const signet = () => perm('signet', 'Dimir Signet', 'Artifact', '{1}, {T}: Add {U}{B}.');

function available(battlefield: any[]) {
  const state: any = { players: [{ id: 'p1' }, { id: 'p2' }], battlefield, manaPool: { p1: {}, p2: {} }, zones: { p1: { hand: [] } }, turnPlayer: 'p1', phase: 'precombatMain' };
  const pool: any = getAvailableMana(state, 'p1' as any);
  return { pool, total: getTotalManaFromPool(pool) };
}

describe('getAvailableMana count-based sources', () => {
  it("Gaea's Cradle counts creatures you control, 0 with none", () => {
    expect(available([cradle()]).total).toBe(0);
    expect(available([cradle(), bear(1), bear(2), bear(3)]).pool.green).toBe(3);
  });

  it('generic "Add {X} for each <type> you control" counts matching permanents', () => {
    expect(available([swampPriest()]).total).toBe(0);
    expect(available([swampPriest(), swamp(1), swamp(2)]).pool.black).toBe(4);
  });

  it('Cabal Coffers nets its {2} activation cost and is 0 with no Swamps', () => {
    expect(available([coffers()]).total).toBe(0);
    expect(available([coffers(), swamp(1), swamp(2), swamp(3), swamp(4)]).pool.black).toBe(6);
    // {2} for one {B} still converts mana into black (fixing), so Murder-style costs stay castable.
    expect(available([coffers(), swamp(1), perm('sol', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.')]).pool.black).toBe(2);
  });
});

describe('getAvailableMana mana-costed and sacrifice sources', () => {
  it('"{1}, {T}, Sacrifice: Add {C}{C}" nets +1 when payable and is not counted otherwise', () => {
    expect(available([sacRock()]).total).toBe(0);
    expect(available([sacRock(), swamp(1)]).total).toBe(2);
  });

  it('signets need another source to pay {1}', () => {
    expect(available([signet()]).total).toBe(0);
    expect(available([signet(), swamp(1)]).total).toBe(2);
  });

  it('free sacrifice sources (Treasure, Lotus Petal) still count one mana of any color', () => {
    const treasure = perm('t', 'Treasure', 'Token Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');
    const petal = perm('p', 'Lotus Petal', 'Artifact', '{T}, Sacrifice Lotus Petal: Add one mana of any color.');
    expect(available([treasure]).total).toBe(1);
    expect(available([treasure, petal]).pool.anyColor).toBe(2);
  });
});