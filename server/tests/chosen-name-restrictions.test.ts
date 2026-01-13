import { describe, it, expect } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { isAbilityActivationProhibitedByChosenName, isSpellCastingProhibitedByChosenName } from '../src/state/modules/chosen-name-restrictions.js';

describe('chosen-name restrictions', () => {
  it('blocks casting a spell with the chosen name (all players)', () => {
    const state: any = {
      battlefield: [
        {
          id: 'nevermore_1',
          controller: 'p2',
          chosenCardName: 'Lightning Bolt',
          card: {
            name: 'Nevermore',
            oracle_text: 'As Nevermore enters, choose a nonland card name.\nSpells with the chosen name can\'t be cast.',
          },
        },
      ],
    };

    const result = isSpellCastingProhibitedByChosenName(state, 'p1' as PlayerID, 'Lightning Bolt');
    expect(result.prohibited).toBe(true);
  });

  it('blocks casting only for opponents when oracle says "your opponents"', () => {
    const state: any = {
      battlefield: [
        {
          id: 'gi_1',
          controller: 'p1',
          chosenCardName: 'Counterspell',
          card: {
            name: "Gideon's Intervention",
            oracle_text: "As Gideon's Intervention enters, choose a card name. Your opponents can't cast spells with the chosen name.",
          },
        },
      ],
    };

    expect(isSpellCastingProhibitedByChosenName(state, 'p2' as PlayerID, 'Counterspell').prohibited).toBe(true);
    expect(isSpellCastingProhibitedByChosenName(state, 'p1' as PlayerID, 'Counterspell').prohibited).toBe(false);
  });

  it('blocks activation of sources with the chosen name (mana exception respected)', () => {
    const state: any = {
      battlefield: [
        {
          id: 'needle_1',
          controller: 'p2',
          chosenCardName: 'Arcane Signet',
          card: {
            name: 'Pithing Needle',
            oracle_text:
              "As Pithing Needle enters, choose a card name. Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.",
          },
        },
      ],
    };

    expect(isAbilityActivationProhibitedByChosenName(state, 'p1' as PlayerID, 'Arcane Signet', false).prohibited).toBe(true);
    expect(isAbilityActivationProhibitedByChosenName(state, 'p1' as PlayerID, 'Arcane Signet', true).prohibited).toBe(false);
  });

  it('blocks activation of sources with the chosen name when no mana exception is present', () => {
    const state: any = {
      battlefield: [
        {
          id: 'revoker_1',
          controller: 'p2',
          chosenCardName: 'Arcane Signet',
          card: {
            name: 'Phyrexian Revoker',
            oracle_text:
              "As Phyrexian Revoker enters, choose a nonland card name. Activated abilities of sources with the chosen name can't be activated.",
          },
        },
      ],
    };

    expect(isAbilityActivationProhibitedByChosenName(state, 'p1' as PlayerID, 'Arcane Signet', true).prohibited).toBe(true);
  });
});
