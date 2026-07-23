import { describe, expect, it } from 'vitest';

import {
  buildTokenImageSpec,
  getTokenImageUrls,
  resolveTokenImageUrls,
  resolveTokenPrinting,
} from '../src/services/tokens.js';

describe('token image resolution policy', () => {
  it('uses exact local match for colorless artifact Soldier', () => {
    const artifactSoldier = getTokenImageUrls('Soldier', 1, 1, [], undefined, true);
    const whiteSoldier = getTokenImageUrls('Soldier', 1, 1, ['W'], undefined, false);

    expect(artifactSoldier?.normal).toBeTruthy();
    expect(whiteSoldier?.normal).toBeTruthy();
    expect(artifactSoldier?.normal).not.toBe(whiteSoldier?.normal);
    expect(String(artifactSoldier?.normal || '')).toContain('27ba03b0-feac-4d9c-9877-59c5fe18b230');
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
    expect(resolved?.normal).toContain('27ba03b0-feac-4d9c-9877-59c5fe18b230');
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
