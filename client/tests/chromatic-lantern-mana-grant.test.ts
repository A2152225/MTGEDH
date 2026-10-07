import { describe, expect, it } from 'vitest';
import { buildAvailableManaSourcesForPlayer, buildSuggestedPaymentItems } from '../src/utils/manaSourceBuilder';
import { oracleGrantsLandsAnyColorMana } from '../src/utils/manaSourceBattlefieldManaAbilityGrants';

function perm(id: string, name: string, typeLine: string, oracleText: string, controller = 'p1') {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: { id: `${id}_card`, name, type_line: typeLine, oracle_text: oracleText },
  };
}

const LANTERN = 'Lands you control have "{T}: Add one mana of any color."\n{T}: Add one mana of any color.';
const JOINER = 'Lands you control have "{T}: Add one mana of any color."';

describe('Chromatic Lantern / Joiner Adept granted any-color land mana', () => {
  it('detects the lands-you-control any-color grant pattern', () => {
    expect(oracleGrantsLandsAnyColorMana(LANTERN)).toBe(true);
    expect(oracleGrantsLandsAnyColorMana(JOINER)).toBe(true);
    expect(oracleGrantsLandsAnyColorMana('{T}: Add {G}.')).toBe(false);
    expect(oracleGrantsLandsAnyColorMana('Creatures you control have "{T}: Add one mana of any color."')).toBe(false);
  });

  it('lets a Mountain tap for any color while Chromatic Lantern is out', () => {
    const lantern = perm('lantern', 'Chromatic Lantern', 'Artifact', LANTERN);
    const mountain = perm('mountain', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
    const sources = buildAvailableManaSourcesForPlayer('p1', [lantern, mountain] as any);
    const mountainOptions = sources
      .filter((source) => source.sourcePermanentId === 'mountain')
      .flatMap((source) => source.options);
    expect(mountainOptions).toEqual(expect.arrayContaining(['W', 'U', 'B', 'R', 'G']));
  });

  it('does not grant any-color when only an opponent controls Joiner Adept', () => {
    const joiner = perm('joiner', 'Joiner Adept', 'Creature — Elf Druid', JOINER, 'p2');
    const mountain = perm('mountain', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
    const sources = buildAvailableManaSourcesForPlayer('p1', [joiner, mountain] as any);
    const mountainOptions = sources
      .filter((source) => source.sourcePermanentId === 'mountain')
      .flatMap((source) => source.options);
    expect(mountainOptions).toEqual(['R']);
  });

  it('autopays off-color mana from monocolor lands through the Lantern grant', () => {
    // Forest/Mountain/Island alone cannot pay {W}{B}{R}; with the Lantern grant they can.
    const lantern = perm('lantern', 'Chromatic Lantern', 'Artifact', LANTERN);
    const forest = perm('forest', 'Forest', 'Basic Land — Forest', '{T}: Add {G}.');
    const mountain = perm('mountain', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
    const island = perm('island', 'Island', 'Basic Land — Island', '{T}: Add {U}.');
    const without = buildSuggestedPaymentItems(
      { colors: { W: 1, B: 1, R: 1, U: 0, G: 0, C: 0 }, generic: 0, hybrids: [] },
      buildAvailableManaSourcesForPlayer('p1', [forest, mountain, island] as any),
      new Set(),
    );
    expect(without.length).toBeLessThan(3);

    const withLantern = buildSuggestedPaymentItems(
      { colors: { W: 1, B: 1, R: 1, U: 0, G: 0, C: 0 }, generic: 0, hybrids: [] },
      buildAvailableManaSourcesForPlayer('p1', [lantern, forest, mountain, island] as any),
      new Set(),
    );
    expect(withLantern).toHaveLength(3);
    const landIds = withLantern.map((item: any) => String(item.permanentId || '')).filter((id) => id && id !== 'lantern');
    expect(landIds.length).toBeGreaterThanOrEqual(2);
  });
});
