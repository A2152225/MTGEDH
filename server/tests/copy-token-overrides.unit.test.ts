import { describe, expect, it } from 'vitest';
import {
  extractCopyTokenExceptionFromEffect,
  parseCopyTokenOverrides,
  parseCopyTokenOverridesFromEffect,
} from '../../shared/src/copyTokenOverrides.js';

/** Representative phrases from Scryfall oracle:"copy of" oracle:"except" (paper). */
const CORPUS: ReadonlyArray<{
  readonly label: string;
  readonly effect: string;
  readonly expect: Record<string, unknown>;
}> = [
  {
    label: 'Helm of the Host',
    effect:
      "create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.",
    expect: { removeLegendary: true, addAbilities: ['Haste'] },
  },
  {
    label: 'KNOWN-table shorthand',
    effect:
      "Create a token that's a copy of equipped creature, except it's not legendary and has haste",
    expect: { removeLegendary: true, addAbilities: ['Haste'] },
  },
  {
    label: 'Delina haste only',
    effect:
      "create a token that's a copy of a creature you control, except it's tapped and attacking. That token gains haste.",
    expect: { addAbilities: ['Haste'] },
  },
  {
    label: 'God-Pharaoh\'s Gift 4/4 Zombie',
    effect:
      "create a token that's a copy of that card, except it's a 4/4 black Zombie. It gains haste until end of turn.",
    expect: { power: 4, toughness: 4, colors: ['B'], replaceSubtypes: ['Zombie'] },
  },
  {
    label: 'Feldon artifact + haste',
    effect:
      "create a token that's a copy of target creature card in your graveyard, except it's an artifact in addition to its other types. It gains haste.",
    expect: { addCardTypes: ['Artifact'] },
  },
  {
    label: 'Croaking Counterpart Frog',
    effect:
      "create a token that's a copy of target creature you control, except it's a 1/1 green Frog",
    expect: { power: 1, toughness: 1, colors: ['G'] },
  },
  {
    label: 'Feldon no mana cost',
    effect:
      "create a token that's a copy of another target creature card in your graveyard, except it's an artifact in addition to its other types and has no mana cost",
    expect: { removeManaCost: true },
  },
];

describe('copyTokenOverrides corpus', () => {
  for (const { label, effect, expect: expected } of CORPUS) {
    it(`parses ${label}`, () => {
      const exception = extractCopyTokenExceptionFromEffect(effect);
      expect(exception.length).toBeGreaterThan(0);
      const overrides = parseCopyTokenOverridesFromEffect(effect);
      if (expected.removeLegendary != null) {
        expect(overrides.removeLegendary).toBe(expected.removeLegendary);
      }
      if (expected.removeManaCost != null) {
        expect(overrides.removeManaCost).toBe(expected.removeManaCost);
      }
      if (expected.power != null) {
        expect(overrides.power).toBe(expected.power);
      }
      if (expected.toughness != null) {
        expect(overrides.toughness).toBe(expected.toughness);
      }
      if (Array.isArray(expected.colors)) {
        expect([...(overrides.colors || [])].sort()).toEqual([...expected.colors].sort());
      }
      if (Array.isArray(expected.addAbilities)) {
        const got = (overrides.addAbilities || []).map((a) => a.toLowerCase()).sort();
        const want = expected.addAbilities.map((a) => a.toLowerCase()).sort();
        for (const ability of want) {
          expect(got).toContain(ability);
        }
      }
      if (Array.isArray(expected.addCardTypes)) {
        expect([...(overrides.addCardTypes || [])].sort()).toEqual([...expected.addCardTypes].sort());
      }
      if (Array.isArray(expected.addSubtypes)) {
        expect([...(overrides.addSubtypes || [])].sort()).toEqual([...expected.addSubtypes].sort());
      }
    });
  }

  it('parses except fragment from IR token hint', () => {
    const overrides = parseCopyTokenOverrides(
      "the token isn't legendary. That token gains haste",
    );
    expect(overrides.removeLegendary).toBe(true);
    expect((overrides.addAbilities || []).map((a) => a.toLowerCase())).toContain('haste');
  });
});
