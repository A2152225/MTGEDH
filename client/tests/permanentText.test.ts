import { describe, expect, it } from 'vitest';
import { getCombinedPermanentText } from '../src/utils/permanentText';
import { hasCurrentKeyword } from '../src/utils/creatureUtils';

const TCHALLA_ORACLE =
  "Whenever T'Challa enters or attacks, create a tapped Vibranium token. (It's an artifact with indestructible and \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")\n" +
  "Whenever you cast an artifact spell with mana value 4 or greater, put two +1/+1 counters on T'Challa.";

describe('getCombinedPermanentText', () => {
  it('merges oracle text, granted abilities, and temporary effect descriptions', () => {
    const permanent = {
      id: 'perm-1',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-1',
        name: 'Skyknight Trainee',
        type_line: 'Creature — Human Knight',
        oracle_text: 'Vigilance',
      },
      grantedAbilities: ['Flying'],
      temporaryEffects: [
        { description: 'Skyknight Trainee has haste this turn.' },
      ],
    } as any;

    const text = getCombinedPermanentText(permanent);

    expect(text).toContain('vigilance');
    expect(text).toContain('flying');
    expect(text).toContain('has haste this turn');
  });

  it('does not inherit create-token reminder keywords (T\'Challa / Vibranium)', () => {
    const permanent = {
      id: 'tchalla',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-tchalla',
        name: "T'Challa, the Black Panther",
        type_line: 'Legendary Creature — Human Noble Hero',
        oracle_text: TCHALLA_ORACLE,
      },
      grantedAbilities: [],
    } as any;

    const text = getCombinedPermanentText(permanent);

    expect(text).toContain('vibranium token');
    expect(text).not.toMatch(/\bindestructible\b/);
    expect(hasCurrentKeyword(permanent, 'indestructible')).toBe(false);
  });

  it('keeps native printed keywords and real granted indestructible', () => {
    const bast = {
      id: 'bast',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-bast',
        name: 'Bast, Panther Goddess',
        type_line: 'Legendary Creature — Cat God',
        oracle_text:
          "Reach, trample, indestructible\nBast can't attack or block unless you control three or more creatures.",
      },
    } as any;

    expect(getCombinedPermanentText(bast)).toMatch(/\bindestructible\b/);
    expect(hasCurrentKeyword(bast, 'indestructible')).toBe(true);

    const granted = {
      id: 'granted',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-vanilla',
        name: 'Vanilla',
        type_line: 'Creature — Human',
        oracle_text: '',
      },
      grantedAbilities: ['indestructible'],
    } as any;

    expect(getCombinedPermanentText(granted)).toMatch(/\bindestructible\b/);
    expect(hasCurrentKeyword(granted, 'indestructible')).toBe(true);
  });

  it('does not inherit same-sentence create-token keyword tails', () => {
    const permanent = {
      id: 'soldier-maker',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-maker',
        name: 'Soldier Maker',
        type_line: 'Creature — Human',
        oracle_text: 'Create a 1/1 white Soldier creature token with flying and lifelink.',
      },
    } as any;

    const text = getCombinedPermanentText(permanent);
    expect(text).toContain('create a 1/1 white soldier creature token');
    expect(text).not.toMatch(/\bflying\b/);
    expect(text).not.toMatch(/\blifelink\b/);
    expect(hasCurrentKeyword(permanent, 'flying')).toBe(false);
    expect(hasCurrentKeyword(permanent, 'lifelink')).toBe(false);
  });
});
