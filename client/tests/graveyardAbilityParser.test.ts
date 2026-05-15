import { describe, expect, it } from 'vitest';

import { getGraveyardAbilitiesForCard, parseGraveyardAbilities } from '../src/components/GraveyardViewModal';
import type { KnownCardRef } from '../../shared/src';

describe('parseGraveyardAbilities', () => {
  it('emits a generic graveyard tutor ability for Colossal Rattlewurm style exile activations', () => {
    const card: KnownCardRef = {
      id: 'rattlewurm-1',
      name: 'Colossal Rattlewurm',
      type_line: 'Creature - Wurm',
      oracle_text: '{1}{G}, Exile this card from your graveyard: Search your library for a Desert card, put it onto the battlefield tapped, then shuffle.',
    };

    const abilities = parseGraveyardAbilities(card);
    const ability = abilities.find((entry) => entry.id === 'graveyard-activated');

    expect(ability).toBeDefined();
    expect(ability?.label).toBe('Graveyard Tutor');
    expect(ability?.cost).toBe('{1}{G}, Exile this card from your graveyard');
    expect(ability?.description).toContain('Search your library for a Desert card');
    expect(ability?.activatable).not.toBe(false);
  });

  it('emits exile-to-add-counters for Valiant Veteran style graveyard abilities', () => {
    const card: KnownCardRef = {
      id: 'veteran-echo-1',
      name: 'Valiant Veteran Echo',
      type_line: 'Creature - Human Soldier',
      oracle_text: '{3}{W}{W}, Exile this card from your graveyard: Put a +1/+1 counter on each Soldier you control.',
    };

    const abilities = parseGraveyardAbilities(card);
    const ability = abilities.find((entry) => entry.id === 'exile-to-add-counters');

    expect(ability).toBeDefined();
    expect(ability?.label).toBe('Exile for Counters');
    expect(ability?.cost).toBe('{3}{W}{W}');
    expect(ability?.description).toContain('each Soldier you control');
  });

  it('does not emit exile-to-add-counters for ordinary graveyard return abilities', () => {
    const card: KnownCardRef = {
      id: 'summon-the-school-1',
      name: 'Summon the School',
      type_line: 'Tribal Sorcery - Merfolk',
      oracle_text: 'Create two 1/1 blue Merfolk Wizard creature tokens.\nTap four untapped Merfolk you control: Return Summon the School from your graveyard to your hand.',
    };

    const abilities = parseGraveyardAbilities(card);

    expect(abilities.some((entry) => entry.id === 'exile-to-add-counters')).toBe(false);
    expect(abilities.some((entry) => entry.id === 'return-from-graveyard')).toBe(true);
  });

  it('marks persist and undying entries as informational only', () => {
    const persistCard: KnownCardRef = {
      id: 'persist-card-1',
      name: 'Kitchen Finks',
      type_line: 'Creature - Ouphe',
      oracle_text: 'When Kitchen Finks enters, you gain 2 life.\nPersist',
    };
    const undyingCard: KnownCardRef = {
      id: 'undying-card-1',
      name: 'Strangleroot Geist',
      type_line: 'Creature - Spirit',
      oracle_text: 'Haste\nUndying',
    };

    const persistAbility = parseGraveyardAbilities(persistCard).find((entry) => entry.id === 'persist-info');
    const undyingAbility = parseGraveyardAbilities(undyingCard).find((entry) => entry.id === 'undying-info');

    expect(persistAbility?.activatable).toBe(false);
    expect(undyingAbility?.activatable).toBe(false);
  });

  it('adds a generic graveyard-cast action for playable nonland spells without printed graveyard text', () => {
    const card: KnownCardRef = {
      id: 'consider-1',
      name: 'Consider',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text: 'Surveil 1, then draw a card.',
    };

    const inactiveAbilities = getGraveyardAbilitiesForCard(card, { isPlayable: false });
    const activeAbilities = getGraveyardAbilitiesForCard(card, { isPlayable: true });

    expect(inactiveAbilities.some((entry) => entry.id === 'graveyard-cast')).toBe(false);
    expect(activeAbilities).toContainEqual(expect.objectContaining({
      id: 'graveyard-cast',
      label: 'Cast',
      cost: '{U}',
    }));
  });

  it('adds server-provided dynamic unearth actions without guessing from playable state', () => {
    const card: KnownCardRef = {
      id: 'scrapwork-automaton-1',
      name: 'Scrapwork Automaton',
      type_line: 'Artifact Creature - Construct',
      mana_cost: '{2}',
      oracle_text: 'When this creature enters, draw a card.',
    };

    const playableWithoutHint = getGraveyardAbilitiesForCard(card, { isPlayable: true });
    const withHint = getGraveyardAbilitiesForCard(card, {
      isPlayable: true,
      abilityHints: [
        {
          id: 'unearth',
          label: 'Unearth',
          description: 'Return to battlefield for {1}{B}{R}',
          cost: '{1}{B}{R}',
        },
      ],
    });

    expect(playableWithoutHint.some((entry) => entry.id === 'unearth')).toBe(false);
    expect(playableWithoutHint.some((entry) => entry.id === 'graveyard-cast')).toBe(false);
    expect(withHint).toContainEqual(expect.objectContaining({
      id: 'unearth',
      label: 'Unearth',
      cost: '{1}{B}{R}',
    }));
  });

  it('preserves source metadata on server-provided graveyard cast hints', () => {
    const card: KnownCardRef = {
      id: 'consider-1',
      name: 'Consider',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text: 'Surveil 1, then draw a card.',
    };

    const abilities = getGraveyardAbilitiesForCard(card, {
      isPlayable: true,
      abilityHints: [
        {
          id: 'graveyard-cast',
          label: 'Cast',
          description: 'Cast from graveyard for {U} via Kess, Dissident Mage',
          cost: '{U}',
          sourceName: 'Kess, Dissident Mage',
          permissionId: 'perm-kess-cast',
          costMode: 'normal',
        },
      ],
    });

    expect(abilities).toContainEqual(expect.objectContaining({
      id: 'graveyard-cast',
      sourceName: 'Kess, Dissident Mage',
      permissionId: 'perm-kess-cast',
      costMode: 'normal',
    }));
  });

  it('suppresses generic graveyard-cast hints when the card already has a printed cast keyword', () => {
    const card: KnownCardRef = {
      id: 'radical-idea-1',
      name: 'Radical Idea',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text: 'Draw a card.\nJump-start',
    };

    const abilities = getGraveyardAbilitiesForCard(card, {
      isPlayable: true,
      abilityHints: [
        {
          id: 'graveyard-cast',
          label: 'Cast',
          description: 'Cast from graveyard for {1}{U}',
          cost: '{1}{U}',
          sourceName: 'Kess, Dissident Mage',
          permissionId: 'perm-kess-cast',
          costMode: 'normal',
        },
      ],
    });

    expect(abilities.some((entry) => entry.id === 'graveyard-cast')).toBe(false);
    expect(abilities).toContainEqual(expect.objectContaining({
      id: 'jump-start',
      label: 'Jump-start',
    }));
  });
});