import { describe, expect, it } from 'vitest';

import { computeContinuousEffects } from '../src/rules-engine/staticEffects.js';
import { permanentHasKeyword } from '../src/socket/game-actions.js';

describe('Greymond chosen keyword grants', () => {
  it('applies only the chosen abilities to other Humans', () => {
    const battlefield: any[] = [
      {
        id: 'greymond_1',
        controller: 'p1',
        owner: 'p1',
        chosenOptions: ['vigilance', 'lifelink'],
        card: {
          id: 'greymond_card',
          name: "Greymond, Avacyn's Stalwart",
          type_line: 'Legendary Creature — Human Noble',
          oracle_text: 'Other Humans you control get +2/+2 and have all abilities of your choice among first strike, vigilance, and lifelink.\nOther creatures you control get +1/+1.',
        },
      },
      {
        id: 'human_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'human_card',
          name: 'Field Marshal',
          type_line: 'Creature — Human Soldier',
          oracle_text: '',
        },
      },
      {
        id: 'elf_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'elf_card',
          name: 'Paradise Druid',
          type_line: 'Creature — Elf Druid',
          oracle_text: '',
        },
      },
    ];

    const result = computeContinuousEffects({ battlefield } as any);
    const humanEffects = result.perPermanent.get('human_1');
    const elfEffects = result.perPermanent.get('elf_1');

    expect(humanEffects?.abilities.has('vigilance')).toBe(true);
    expect(humanEffects?.abilities.has('lifelink')).toBe(true);
    expect(humanEffects?.abilities.has('first strike')).toBe(false);
    expect(elfEffects?.abilities.has('vigilance')).toBe(false);
    expect(elfEffects?.abilities.has('lifelink')).toBe(false);

    expect(permanentHasKeyword(battlefield[1], battlefield, 'p1', 'vigilance')).toBe(true);
    expect(permanentHasKeyword(battlefield[1], battlefield, 'p1', 'lifelink')).toBe(true);
    expect(permanentHasKeyword(battlefield[1], battlefield, 'p1', 'first strike')).toBe(false);
  });
});