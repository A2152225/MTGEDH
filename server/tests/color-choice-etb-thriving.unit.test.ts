import { describe, expect, it } from 'vitest';
import { requiresColorChoice } from '../src/socket/color-choice.js';

describe('requiresColorChoice ETB detection', () => {
  it('detects Thriving Grove modern template with excluded green', () => {
    const result = requiresColorChoice({
      name: 'Thriving Grove',
      type_line: 'Land',
      oracle_text:
        'This land enters tapped. As it enters, choose a color other than green.\n{T}: Add {G} or one mana of the chosen color.',
    });

    expect(result.required).toBe(true);
    expect(result.reason).toMatch(/other than green/i);
    expect(result.excludedColors).toEqual(['green']);
    expect(result.colors).toEqual(['white', 'blue', 'black', 'red']);
  });

  it('detects legacy Thriving Heath enters-the-battlefield wording', () => {
    const result = requiresColorChoice({
      name: 'Thriving Heath',
      oracle_text:
        'Thriving Heath enters the battlefield tapped.\nAs Thriving Heath enters the battlefield, choose a color other than white.\n{T}: Add {W} or one mana of the chosen color.',
    });

    expect(result.required).toBe(true);
    expect(result.excludedColors).toEqual(['white']);
    expect(result.colors).toEqual(['blue', 'black', 'red', 'green']);
  });

  it('detects Caged Sun full five-color choice', () => {
    const result = requiresColorChoice({
      name: 'Caged Sun',
      oracle_text:
        'As Caged Sun enters the battlefield, choose a color.\nCreatures you control of the chosen color get +1/+1.',
    });

    expect(result.required).toBe(true);
    expect(result.colors).toEqual(['white', 'blue', 'black', 'red', 'green']);
    expect(result.excludedColors).toBeUndefined();
  });

  it('does not treat Three Tree City activated color choice as ETB', () => {
    const result = requiresColorChoice({
      name: 'Three Tree City',
      type_line: 'Legendary Land',
      oracle_text:
        'As Three Tree City enters, choose a creature type.\n{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.',
    });

    expect(result.required).toBe(false);
  });
});
