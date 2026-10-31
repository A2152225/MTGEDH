import { describe, expect, it } from 'vitest';

import { buildAvailableManaSourcesForPlayer } from '../src/utils/manaSourceBuilder';
import {
  adjustStackSelection,
  chunkSacrificeIds,
  expandStackSelection,
  remainingManaUnits,
  sacrificeCandidatesExcluding,
  sacrificedIdsInPayment,
} from '../src/utils/sacrificeStackSelection';

const soldier = { name: 'Soldier', type_line: 'Token Creature — Soldier', power: '1', toughness: '1' };
const altar = {
  id: 'altar',
  controller: 'p1',
  owner: 'p1',
  tapped: false,
  card: {
    id: 'altar_card',
    name: 'Phyrexian Altar',
    type_line: 'Artifact',
    oracle_text: 'Sacrifice a creature: Add one mana of any color.',
  },
} as any;
const stackOfTwo = {
  id: 'group_soldier',
  controller: 'p1',
  owner: 'p1',
  isToken: true,
  isGroupedTokens: true,
  tokenCount: 2,
  groupedTokenIds: ['tok_a', 'tok_b'],
  card: { id: 'tok_a', ...soldier },
} as any;
const single = (id: string) => ({ id, controller: 'p1', owner: 'p1', isToken: true, card: { id, ...soldier } }) as any;

describe('sacrifice picks against stacked tokens', () => {
  it('offers one Phyrexian Altar row with an activation per token, counting stack members', () => {
    const battlefield = [altar, stackOfTwo, single('tok_c'), single('tok_d')];
    const altarRows = buildAvailableManaSourcesForPlayer('p1', battlefield)
      .filter((source) => source.sourcePermanentId === 'altar');
    expect(altarRows).toHaveLength(1);
    expect(altarRows[0].availableQuantity).toBe(4);
    expect(altarRows[0].sacrificeCost?.count).toBe(1);
  });

  it('picks N members of a stack, capped by the stack size and the total needed', () => {
    let selection = adjustStackSelection(new Map(), stackOfTwo, 5, 3);
    expect(selection.get('group_soldier')).toBe(2);
    selection = adjustStackSelection(selection, single('tok_c'), 1, 3);
    selection = adjustStackSelection(selection, single('tok_d'), 1, 3);
    expect(selection.has('tok_d')).toBe(false);
    expect(expandStackSelection([stackOfTwo, single('tok_c'), single('tok_d')], selection))
      .toEqual(['tok_a', 'tok_b', 'tok_c']);
  });

  it('splits picks into one sacrifice set per activation', () => {
    expect(chunkSacrificeIds(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
    expect(chunkSacrificeIds(['a', 'b', 'c', 'd'], 2)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('counts unpaid pips to cap how many sacrifices are offered', () => {
    expect(remainingManaUnits({ colors: { W: 2, U: 0 }, generic: 1, hybrids: [['R', 'G']] })).toBe(4);
    expect(remainingManaUnits({ colors: {}, generic: 0 })).toBe(0);
  });

  it('hides tokens already committed to earlier activations', () => {
    const used = sacrificedIdsInPayment([
      { permanentId: 'altar', mana: 'B', count: 1, sacrificedPermanentIds: ['tok_a'] } as any,
    ]);
    const candidates = sacrificeCandidatesExcluding([stackOfTwo, single('tok_c')], used);
    expect((candidates[0] as any).groupedTokenIds).toEqual(['tok_b']);
    expect((candidates[0] as any).tokenCount).toBe(1);
    expect(candidates[1].id).toBe('tok_c');
  });
});
