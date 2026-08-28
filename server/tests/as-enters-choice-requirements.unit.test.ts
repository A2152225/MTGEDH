import { describe, expect, it } from 'vitest';
import {
  getAsEntersChoiceRequirements,
  requiresColorChoice,
} from '../src/state/modules/asEntersChoiceRequirements.js';

describe('as-enters choice requirements', () => {
  it('excludes the printed color for Thriving Grove', () => {
    const card = {
      name: 'Thriving Grove',
      oracle_text:
        'This land enters tapped. As it enters, choose a color other than green.\n{T}: Add {G} or one mana of the chosen color.',
    };
    const req = requiresColorChoice(card);
    expect(req.required).toBe(true);
    expect(req.colors?.sort()).toEqual(['black', 'blue', 'red', 'white']);
    expect(req.excludedColors).toEqual(['green']);
    expect(req.reason).toMatch(/other than green/i);
  });

  it('excludes the printed color for Citadel Gate', () => {
    const card = {
      name: 'Citadel Gate',
      oracle_text:
        'This land enters tapped.\nAs this land enters, choose a color other than white.\n{T}: Add one mana of the chosen color.',
    };
    const req = requiresColorChoice(card);
    expect(req.required).toBe(true);
    expect(req.colors?.sort()).toEqual(['black', 'blue', 'green', 'red']);
    expect(req.excludedColors).toEqual(['white']);
  });

  it('returns sequential color + creature type for compound as-enters', () => {
    const card = {
      name: "Volrath's Laboratory",
      oracle_text:
        'As this artifact enters, choose a color and a creature type.\n{5}, {T}: Create a 2/2 creature token of the chosen color and type.',
    };
    const reqs = getAsEntersChoiceRequirements(card);
    expect(reqs.map((r) => r.kind)).toEqual(['color', 'creature_type']);
  });

  it('detects basic land type as-enters choice', () => {
    const card = {
      name: 'Thran Portal',
      oracle_text:
        'This land enters tapped unless you control two or fewer other lands.\nAs this land enters, choose a basic land type.\nThis land is the chosen type in addition to its other types.',
    };
    const reqs = getAsEntersChoiceRequirements(card);
    expect(reqs.some((r) => r.kind === 'basic_land_type')).toBe(true);
  });

  it('detects color word choice for Swirl the Mists', () => {
    const card = {
      name: 'Swirl the Mists',
      oracle_text:
        'As this enchantment enters, choose a color word.\nAll instances of color words in the text of spells and permanents are changed to the chosen color word.',
    };
    const req = requiresColorChoice(card);
    expect(req.required).toBe(true);
    expect(req.reason).toMatch(/color word/i);
  });

  it('detects as-enters copy of any land for Vesuva', () => {
    const card = {
      name: 'Vesuva',
      oracle_text: 'You may have this land enter tapped as a copy of any land on the battlefield.',
    };
    const reqs = getAsEntersChoiceRequirements(card);
    expect(reqs.some((r) => r.kind === 'copy_permanent' && r.copyType === 'land' && r.enterTappedIfCopied)).toBe(true);
    expect(reqs.every((r) => r.kind !== 'copy_permanent' || r.mandatory === false)).toBe(true);
  });
});
