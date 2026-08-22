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
