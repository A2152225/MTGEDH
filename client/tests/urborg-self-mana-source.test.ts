import { describe, expect, it } from 'vitest';
import { buildAvailableManaSourcesForPlayer } from '../src/utils/manaSourceBuilder';
import { grantedBasicLandTypesFromBattlefield } from '../../shared/src/battlefieldBasicLandTypeGrants';

const URBORG_ORACLE = 'Each land is a Swamp in addition to its other land types.';
const YAVIMAYA_ORACLE = 'Each land is a Forest in addition to its other land types.';

function perm(id: string, name: string, typeLine: string, oracleText: string) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card: {
      id: `${id}_card`,
      name,
      type_line: typeLine,
      oracle_text: oracleText,
    },
  };
}

describe('payment sources include the source of each-land type grants', () => {
  it('lists Urborg itself as black mana', () => {
    const urborg = perm('urborg_1', 'Urborg, Tomb of Yawgmoth', 'Legendary Land', URBORG_ORACLE);
    const sources = buildAvailableManaSourcesForPlayer('p1', [urborg] as any);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.name).toBe('Urborg, Tomb of Yawgmoth');
    expect(sources[0]?.options).toEqual(['B']);
    expect(sources[0]?.sourcePermanentId).toBe('urborg_1');
  });

  it('lists Yavimaya itself as green and still lets a Mountain tap for red or green', () => {
    const yavimaya = perm('yavimaya_1', 'Yavimaya, Cradle of Growth', 'Legendary Land', YAVIMAYA_ORACLE);
    const mountain = perm('mountain_1', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
    const sources = buildAvailableManaSourcesForPlayer('p1', [yavimaya, mountain] as any);

    const yavimayaSource = sources.find((source) => source.sourcePermanentId === 'yavimaya_1');
    const mountainOptions = sources
      .filter((source) => source.sourcePermanentId === 'mountain_1')
      .flatMap((source) => source.options);
    expect(yavimayaSource?.options).toEqual(['G']);
    expect(mountainOptions).toEqual(expect.arrayContaining(['R', 'G']));
  });

  it('does not grant the source when the effect says each other land', () => {
    const source = perm(
      'other_1',
      'Otherland',
      'Legendary Land',
      'Each other land is a Swamp in addition to its other land types.',
    );
    const plains = perm('plains_1', 'Plains', 'Basic Land — Plains', '{T}: Add {W}.');
    expect(grantedBasicLandTypesFromBattlefield(source as any, [source, plains] as any)).toEqual([]);
    expect(grantedBasicLandTypesFromBattlefield(plains as any, [source, plains] as any)).toEqual(['Swamp']);

    const sources = buildAvailableManaSourcesForPlayer('p1', [source, plains] as any);
    const sourceOptions = sources
      .filter((row) => row.sourcePermanentId === 'other_1')
      .flatMap((row) => row.options);
    const plainsOptions = sources
      .filter((row) => row.sourcePermanentId === 'plains_1')
      .flatMap((row) => row.options);
    expect(sourceOptions).not.toContain('B');
    expect(plainsOptions).toEqual(expect.arrayContaining(['W', 'B']));
  });
});
