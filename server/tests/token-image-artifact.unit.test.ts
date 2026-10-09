import { describe, expect, it } from 'vitest';

import {
  buildTokenImageSpec,
  buildTokenImageSpecFromCard,
  getAllTokens,
  getTokenImageUrls,
  lookupExactTokenPrinting,
  resolveTokenImageUrls,
  resolveTokenPrinting,
} from '../src/services/tokens.js';

describe('token image resolution policy', () => {
  it('uses exact local match for colorless artifact Soldier', () => {
    const artifactSpec = buildTokenImageSpec({
      name: 'Soldier',
      power: 1,
      toughness: 1,
      colors: [],
      isArtifact: true,
    });
    const whiteSpec = buildTokenImageSpec({
      name: 'Soldier',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: [],
      isArtifact: false,
    });
    const artifactSoldier = lookupExactTokenPrinting(artifactSpec);
    const whiteSoldier = lookupExactTokenPrinting(whiteSpec);

    expect(artifactSoldier?.image_uris?.normal).toBeTruthy();
    expect(whiteSoldier?.image_uris?.normal).toBeTruthy();
    expect(artifactSoldier?.image_uris?.normal).not.toBe(whiteSoldier?.image_uris?.normal);
    expect(String(artifactSoldier?.type_line || '').toLowerCase()).toContain('artifact');
    expect(artifactSoldier?.colors || []).toEqual([]);
    expect(String(whiteSoldier?.type_line || '').toLowerCase()).not.toContain('artifact');
    expect(whiteSoldier?.colors).toEqual(['W']);
    expect((whiteSoldier?.keywords || []).map((keyword) => keyword.toLowerCase())).not.toContain('lifelink');
  });

  it('does not return white Soldier art for exact colorless artifact request', () => {
    const syncOnly = getTokenImageUrls('Soldier', 1, 1, [], undefined, true);
    expect(syncOnly?.normal).toBeTruthy();
    expect(syncOnly?.normal).not.toContain('b1032d62-f64a-4b27-9a59-a5125625bf1f');
  });

  it('resolveTokenImageUrls tries exact cache before fuzzy fallback', async () => {
    const spec = buildTokenImageSpec({
      name: 'Soldier',
      power: 1,
      toughness: 1,
      colors: [],
      isArtifact: true,
    });
    const resolved = await resolveTokenImageUrls(spec);
    expect(resolved?.normal).toBe(lookupExactTokenPrinting(spec)?.image_uris?.normal);
  });

  it('keeps a current token catalog, including double-faced faces', () => {
    const tokens = getAllTokens();
    expect(tokens.length).toBeGreaterThan(2500);
    const latest = tokens.reduce(
      (max, token) => (String(token.released_at || '') > max ? String(token.released_at) : max),
      '',
    );
    expect(latest >= '2026-10-01').toBe(true);
    const faces = tokens.filter((token) => token.layout === 'double_faced_token');
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((token) => token.image_uris?.normal || token.image_uris?.small)).toBe(true);
    expect(faces.some((token) => !token.name.includes('//'))).toBe(true);
  });

  it('matches predefined artifact tokens when artifact-ness is omitted', () => {
    expect(getTokenImageUrls('Treasure')?.normal).toBeTruthy();
  });

  it('does not use a rules-text Human printing for Adeline’s vanilla Human', () => {
    const vanilla = lookupExactTokenPrinting(buildTokenImageSpec({
      name: 'Human',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: [],
      typeLine: 'Token Creature — Human',
      isArtifact: false,
    }));
    const fromCreatedCard = lookupExactTokenPrinting(buildTokenImageSpecFromCard({
      name: 'Human',
      power: '1',
      toughness: '1',
      colors: ['W'],
      keywords: [],
      oracle_text: '',
      type_line: 'Token Creature — Human',
    }));

    expect(String(vanilla?.oracle_text || '').toLowerCase()).not.toContain('phase');
    expect(String(vanilla?.power)).toBe('1');
    expect(String(fromCreatedCard?.oracle_text || '').toLowerCase()).not.toContain('phase');
    expect(String(fromCreatedCard?.power)).toBe('1');
  });

  it('matches distinct Human Soldier printings by color and training', async () => {
    const hornSpec = buildTokenImageSpec({
      name: 'Human Soldier',
      power: 1,
      toughness: 1,
      colors: ['W'],
      abilities: [],
      typeLine: 'Token Creature — Human Soldier',
    });
    const torensSpec = buildTokenImageSpec({
      name: 'Human Soldier',
      power: 1,
      toughness: 1,
      colors: ['G', 'W'],
      abilities: ['Training'],
      typeLine: 'Token Creature — Human Soldier',
    });

    const horn = await resolveTokenPrinting(hornSpec);
    const torens = await resolveTokenPrinting(torensSpec);

    expect(horn?.matchKind).toBe('exact');
    expect(torens?.matchKind).toBe('exact');
    expect(horn?.image_uris?.normal).toBeTruthy();
    expect(torens?.image_uris?.normal).toBeTruthy();
    expect(horn?.image_uris?.normal).not.toBe(torens?.image_uris?.normal);
    expect(String(torens?.printing?.oracle_text || '').toLowerCase()).toContain('training');
    expect(String(horn?.printing?.oracle_text || '').toLowerCase()).not.toContain('training');
  });
});
