import { describe, expect, it } from 'vitest';
import { resolveTokenCharacteristicsFromOracleStep } from '../src/tokenCreation';

describe('Gingerbrute named token resolve', () => {
  it('prefers the named Gingerbrute catalog entry over Food from reminder text', () => {
    const resolved = resolveTokenCharacteristicsFromOracleStep(
      'Gingerbrute',
      "create a Gingerbrute token. (It's a {1} 1/1 Food Golem artifact creature with haste)",
    );
    expect(resolved).toBeTruthy();
    expect(String(resolved?.name || '')).toMatch(/Gingerbrute/i);
    expect(String(resolved?.power)).toBe('1');
    expect(String(resolved?.toughness)).toBe('1');
    const types = String(resolved?.type_line || resolved?.types || '').toLowerCase();
    expect(types).toMatch(/golem|food|artifact|creature/);
  });
});
