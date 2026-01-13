import { describe, it, expect } from 'vitest';
import { isCreatureNow, permanentHasCreatureTypeNow } from '../src/state/creatureTypeNow';

function perm(card: any, extra: any = {}) {
  return {
    id: card.id || 'perm_1',
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card,
    ...extra,
  } as any;
}

describe('Creature type detection (Kindred / Changeling / type grants)', () => {
  it('counts Kindred permanents as having the creature subtype (but not as creatures)', () => {
    const p = perm({
      id: 'k1',
      name: 'Boggart Mischief',
      type_line: 'Kindred Enchantment — Goblin',
      oracle_text: '',
    });

    expect(isCreatureNow(p)).toBe(false);
    expect(permanentHasCreatureTypeNow(p, 'goblin')).toBe(true);
    expect(permanentHasCreatureTypeNow(p, 'elf')).toBe(false);
  });

  it('treats Changeling as every creature type', () => {
    const p = perm({
      id: 'c1',
      name: 'Sizzling Changeling',
      type_line: 'Creature — Shapeshifter',
      oracle_text: 'Changeling (This card is every creature type.)',
    });

    expect(isCreatureNow(p)).toBe(true);
    expect(permanentHasCreatureTypeNow(p, 'elf')).toBe(true);
    expect(permanentHasCreatureTypeNow(p, 'merfolk')).toBe(true);
    expect(permanentHasCreatureTypeNow(p, 'goat')).toBe(true);
  });

  it('honors modifiers.newTypeLine when an effect changes subtypes', () => {
    const p = perm(
      {
        id: 'a1',
        name: 'Animated Trinket',
        type_line: 'Artifact — Equipment',
        oracle_text: '',
      },
      {
        modifiers: [
          {
            type: 'animation',
            active: true,
            newTypeLine: 'Artifact Creature — Soldier Equipment',
          },
        ],
      }
    );

    expect(isCreatureNow(p)).toBe(true);
    expect(permanentHasCreatureTypeNow(p, 'soldier')).toBe(true);
  });

  it('honors hasAllCreatureTypes flag (e.g., Mutavault-style animation)', () => {
    const p = perm(
      {
        id: 'm1',
        name: 'Mutavault',
        type_line: 'Land',
        oracle_text: '',
      },
      {
        hasAllCreatureTypes: true,
        animated: true,
      }
    );

    expect(isCreatureNow(p)).toBe(true);
    expect(permanentHasCreatureTypeNow(p, 'goblin')).toBe(true);
    expect(permanentHasCreatureTypeNow(p, 'elf')).toBe(true);
  });
});
