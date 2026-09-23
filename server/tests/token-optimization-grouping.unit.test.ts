import { describe, expect, it } from 'vitest';
import { optimizeBattlefieldTokensForEmit } from '../src/socket/util.js';

function vibranium(id: string, tapped: boolean) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    isToken: true,
    tapped,
    summoningSickness: false,
    counters: {},
    card: {
      name: 'Vibranium',
      type_line: 'Token Artifact',
      oracle_text: 'Indestructible\n{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.',
      colors: [],
      image_uris: { normal: 'https://example.com/vibranium.jpg' },
    },
  };
}

describe('optimizeBattlefieldTokensForEmit Vibranium grouping', () => {
  it('keeps one tapped and one untapped Vibranium as separate emit entries', () => {
    const battlefield = [
      vibranium('tok_a', false),
      vibranium('tok_b', true),
      {
        id: 'sol_ring',
        controller: 'p1',
        isToken: false,
        tapped: false,
        card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
      },
    ];

    const result = optimizeBattlefieldTokensForEmit(battlefield);
    const vibes = result.battlefield.filter((p: any) => p?.card?.name === 'Vibranium');
    expect(vibes).toHaveLength(2);
    expect(vibes.some((p: any) => p.tapped) && vibes.some((p: any) => !p.tapped)).toBe(true);
    expect(vibes.every((p: any) => p.isGroupedTokens !== true)).toBe(true);
  });

  it('groups two identically tapped Vibranium into one count-2 entry without dropping ids', () => {
    const battlefield = [vibranium('tok_a', true), vibranium('tok_b', true)];
    const result = optimizeBattlefieldTokensForEmit(battlefield, { _tokenGroupMembers: {} });
    expect(result.tokenGroupingApplied).toBe(true);
    expect(result.battlefield).toHaveLength(1);
    const group = result.battlefield[0] as any;
    expect(group.isGroupedTokens).toBe(true);
    expect(group.tokenCount).toBe(2);
    expect(group.groupedTokenIds).toEqual(['tok_a', 'tok_b']);
    expect(battlefield).toHaveLength(2);
    expect(battlefield.map((p) => p.id)).toEqual(['tok_a', 'tok_b']);
  });

  it('does not mutate authoritative battlefield when grouping', () => {
    const battlefield = [vibranium('tok_a', false), vibranium('tok_b', false)];
    const before = JSON.stringify(battlefield);
    optimizeBattlefieldTokensForEmit(battlefield);
    expect(JSON.stringify(battlefield)).toBe(before);
    expect(battlefield).toHaveLength(2);
  });
});

function forest(id: string, tapped: boolean, name = 'Forest') {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    isToken: false,
    tapped,
    summoningSickness: false,
    counters: {},
    card: {
      name,
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      colors: [],
      image_uris: { normal: 'https://example.com/forest.jpg' },
    },
  };
}

describe('optimizeBattlefieldTokensForEmit same-named land grouping', () => {
  it('groups 8 untapped Forests into one pile key with count 8', () => {
    const battlefield = Array.from({ length: 8 }, (_, i) => forest(`land_${i}`, false));
    const result = optimizeBattlefieldTokensForEmit(battlefield, { _tokenGroupMembers: {} });
    expect(result.tokenGroupingApplied).toBe(true);
    const forests = result.battlefield.filter((p: any) => p?.card?.name === 'Forest');
    expect(forests).toHaveLength(1);
    const group = forests[0] as any;
    expect(group.isGroupedTokens).toBe(true);
    expect(group.tokenCount).toBe(8);
    expect(group.isToken).not.toBe(true);
    expect(group.groupedTokenIds).toEqual(Array.from({ length: 8 }, (_, i) => `land_${i}`));
  });

  it('splits 6 untapped + 2 tapped Forests into two pile keys', () => {
    const battlefield = [
      ...Array.from({ length: 6 }, (_, i) => forest(`u_${i}`, false)),
      ...Array.from({ length: 2 }, (_, i) => forest(`t_${i}`, true)),
    ];
    const result = optimizeBattlefieldTokensForEmit(battlefield, { _tokenGroupMembers: {} });
    const forests = result.battlefield.filter((p: any) => p?.card?.name === 'Forest');
    expect(forests).toHaveLength(2);
    const untapped = forests.find((p: any) => !p.tapped) as any;
    const tapped = forests.find((p: any) => p.tapped) as any;
    expect(untapped?.isGroupedTokens).toBe(true);
    expect(untapped?.tokenCount).toBe(6);
    expect(tapped?.isGroupedTokens).toBe(true);
    expect(tapped?.tokenCount).toBe(2);
  });

  it('does not stack Forest with Snow-Covered Forest (different names)', () => {
    const battlefield = [
      forest('f1', false, 'Forest'),
      forest('f2', false, 'Forest'),
      forest('s1', false, 'Snow-Covered Forest'),
      forest('s2', false, 'Snow-Covered Forest'),
    ];
    // Fix snow type line for the snow ones
    battlefield[2].card.type_line = 'Basic Snow Land — Forest';
    battlefield[3].card.type_line = 'Basic Snow Land — Forest';
    const result = optimizeBattlefieldTokensForEmit(battlefield, { _tokenGroupMembers: {} });
    const forests = result.battlefield.filter((p: any) => p?.card?.name === 'Forest');
    const snow = result.battlefield.filter((p: any) => p?.card?.name === 'Snow-Covered Forest');
    expect(forests).toHaveLength(1);
    expect((forests[0] as any).tokenCount).toBe(2);
    expect(snow).toHaveLength(1);
    expect((snow[0] as any).tokenCount).toBe(2);
  });
});
