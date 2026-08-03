import { describe, expect, it } from 'vitest';
import {
  getTokenGroupMembers,
  normalizeAttackerSelections,
  parseGroupedPermanentRef,
  registerTokenGroupMembers,
  resolveGroupedAttackerRef,
  resolveGroupedPermanentRef,
} from '../src/socket/tokenGroupResolve.js';

function makeGame(permanents: any[]) {
  return {
    seq: 1,
    state: {
      battlefield: permanents,
    },
  };
}

describe('tokenGroupResolve', () => {
  it('parses grouped and virtual refs', () => {
    expect(parseGroupedPermanentRef('group_perm_a')).toEqual({ groupId: 'group_perm_a' });
    expect(parseGroupedPermanentRef('group_perm_a_virtual_3')).toEqual({
      groupId: 'group_perm_a',
      index: 3,
    });
    expect(parseGroupedPermanentRef('perm_real')).toBeNull();
  });

  it('resolves virtual refs using registered group members', () => {
    const game = makeGame([
      { id: 'perm_a', controller: 'p1', isToken: true, card: { name: 'Soldier' }, tapped: false },
      { id: 'perm_b', controller: 'p1', isToken: true, card: { name: 'Soldier' }, tapped: false },
      { id: 'perm_c', controller: 'p1', isToken: true, card: { name: 'Soldier' }, tapped: true },
    ]);
    registerTokenGroupMembers(game, 'group_perm_a', ['perm_a', 'perm_b', 'perm_c']);

    expect(resolveGroupedPermanentRef(game, 'p1', 'group_perm_a_virtual_0')).toBe('perm_a');
    expect(resolveGroupedPermanentRef(game, 'p1', 'group_perm_a_virtual_1')).toBe('perm_b');

    const used = new Set<string>(['perm_a']);
    expect(resolveGroupedPermanentRef(game, 'p1', 'group_perm_a', { usedIds: used })).toBe('perm_b');
  });

  it('normalizes compact group attacker selections', () => {
    const game = makeGame([
      { id: 'perm_a', controller: 'p1', isToken: true, card: { name: 'Soldier' }, tapped: false, summoningSickness: false },
      { id: 'perm_b', controller: 'p1', isToken: true, card: { name: 'Soldier' }, tapped: false, summoningSickness: false },
      { id: 'perm_c', controller: 'p1', isToken: true, card: { name: 'Soldier' }, tapped: false, summoningSickness: false },
    ]);
    registerTokenGroupMembers(game, 'group_perm_a', ['perm_a', 'perm_b', 'perm_c']);

    const resolved = normalizeAttackerSelections(game, 'p1', [
      { groupId: 'group_perm_a', count: 2, targetPlayerId: 'p2' },
    ]);

    expect(resolved).toHaveLength(2);
    expect(resolved.map((entry) => entry.creatureId)).toEqual(['perm_a', 'perm_b']);
    expect(resolved.every((entry) => entry.targetPlayerId === 'p2')).toBe(true);
  });

  it('rebuilds group members from battlefield when registry is missing', () => {
    const game = makeGame([
      {
        id: 'group_perm_a',
        controller: 'p1',
        isToken: true,
        isGroupedTokens: true,
        tokenCount: 2,
        card: { name: 'Soldier', power: '1', toughness: '1' },
        tapped: false,
        summoningSickness: false,
        effectivePower: 1,
        effectiveToughness: 1,
        originalId: 'perm_a',
      },
      { id: 'perm_a', controller: 'p1', isToken: true, card: { name: 'Soldier', power: '1', toughness: '1' }, tapped: false, summoningSickness: false, effectivePower: 1, effectiveToughness: 1 },
      { id: 'perm_b', controller: 'p1', isToken: true, card: { name: 'Soldier', power: '1', toughness: '1' }, tapped: false, summoningSickness: false, effectivePower: 1, effectiveToughness: 1 },
    ]);

    expect(getTokenGroupMembers(game, 'group_perm_a')).toEqual(['perm_a', 'perm_b']);
  });

  it('resolves grouped attacker refs for defenders declaring blockers', () => {
    const game = makeGame([
      { id: 'atk_a', controller: 'p1', isToken: true, card: { name: 'Goblin' }, attacking: 'p2', tapped: true },
      { id: 'atk_b', controller: 'p1', isToken: true, card: { name: 'Goblin' }, attacking: 'p2', tapped: true },
      { id: 'blk_a', controller: 'p2', isToken: true, card: { name: 'Soldier' }, tapped: false },
    ]);
    registerTokenGroupMembers(game, 'group_atk_a', ['atk_a', 'atk_b']);

    // Defender (p2) can still resolve the opponent's grouped attacker id.
    expect(resolveGroupedAttackerRef(game, 'group_atk_a')).toBe('atk_a');
    expect(resolveGroupedAttackerRef(game, 'group_atk_a_virtual_1')).toBe('atk_b');
    expect(resolveGroupedAttackerRef(game, 'atk_a')).toBe('atk_a');

    // Non-attacking member must not be chosen.
    const idleGame = makeGame([
      { id: 'atk_a', controller: 'p1', isToken: true, card: { name: 'Goblin' }, tapped: false },
      { id: 'atk_b', controller: 'p1', isToken: true, card: { name: 'Goblin' }, attacking: 'p2', tapped: true },
    ]);
    registerTokenGroupMembers(idleGame, 'group_atk_a', ['atk_a', 'atk_b']);
    expect(resolveGroupedAttackerRef(idleGame, 'group_atk_a')).toBe('atk_b');
  });
});
