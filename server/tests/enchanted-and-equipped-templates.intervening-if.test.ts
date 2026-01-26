import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: enchanted/equipped templates', () => {
  it('supports "if it was enchanted" / "if it was equipped"', () => {
    const g = createInitialGameState('t_intervening_if_it_was_enchanted_equipped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const creature = {
      id: 'c1',
      controller: p1,
      owner: p1,
      card: { id: 'c1_card', name: 'Test Creature', type_line: 'Creature — Bear', oracle_text: '' },
      tapped: false,
      attachments: ['a1', 'e1'],
    };

    const aura = {
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { id: 'a1_card', name: 'Test Aura', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
      attachedTo: 'c1',
    };

    const equipment = {
      id: 'e1',
      controller: p1,
      owner: p1,
      card: { id: 'e1_card', name: 'Test Equipment', type_line: 'Artifact — Equipment', oracle_text: 'Equip {1}' },
      attachedTo: 'c1',
    };

    (g.state.battlefield as any).push(creature, aura, equipment);

    const descEnchanted = 'At the beginning of your upkeep, if it was enchanted, draw a card.';
    const descEquipped = 'At the beginning of your upkeep, if it was equipped, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), descEnchanted, creature)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), descEquipped, creature)).toBe(true);

    // No attachments -> false
    const bare = { ...creature, id: 'c2', attachments: [] };
    (g.state.battlefield as any).push(bare);
    expect(isInterveningIfSatisfied(g as any, String(p1), descEnchanted, bare)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), descEquipped, bare)).toBe(false);
  });

  it('supports "if enchanted creature has flying" / "has toxic"', () => {
    const g = createInitialGameState('t_intervening_if_enchanted_creature_keyword');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const flyingCreature = {
      id: 'c_fly',
      controller: p1,
      owner: p1,
      card: { id: 'c_fly_card', name: 'Bird', type_line: 'Creature — Bird', oracle_text: 'Flying' },
      tapped: false,
      attachments: ['a_fly'],
    };

    const aura = {
      id: 'a_fly',
      controller: p1,
      owner: p1,
      card: { id: 'a_fly_card', name: 'Test Aura', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
      attachedTo: 'c_fly',
    };

    (g.state.battlefield as any).push(flyingCreature, aura);

    const descFlying = 'At the beginning of your upkeep, if enchanted creature has flying, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descFlying, aura)).toBe(true);

    const toxicCreature = {
      id: 'c_toxic',
      controller: p1,
      owner: p1,
      card: { id: 'c_toxic_card', name: 'Toxic Guy', type_line: 'Creature — Human', oracle_text: 'Toxic 1' },
      tapped: false,
      attachments: ['a_toxic'],
    };
    const aura2 = { ...aura, id: 'a_toxic', attachedTo: 'c_toxic' };
    (g.state.battlefield as any).push(toxicCreature, aura2);

    const descToxic = 'At the beginning of your upkeep, if enchanted creature has toxic, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descToxic, aura2)).toBe(true);
  });

  it('supports "if enchanted creature is untapped" / "is red" / "is a Wolf or Werewolf"', () => {
    const g = createInitialGameState('t_intervening_if_enchanted_creature_props');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const wolf = {
      id: 'c_wolf',
      controller: p1,
      owner: p1,
      card: {
        id: 'c_wolf_card',
        name: 'Wolf',
        type_line: 'Creature — Wolf',
        oracle_text: '',
        colors: ['R'],
      },
      tapped: false,
      attachments: ['a1'],
    };

    const aura = {
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { id: 'a1_card', name: 'Test Aura', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
      attachedTo: 'c_wolf',
    };

    (g.state.battlefield as any).push(wolf, aura);

    const descUntapped = 'At the beginning of your upkeep, if enchanted creature is untapped, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descUntapped, aura)).toBe(true);

    wolf.tapped = true;
    expect(isInterveningIfSatisfied(g as any, String(p1), descUntapped, aura)).toBe(false);

    const descRed = 'At the beginning of your upkeep, if enchanted creature is red, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descRed, aura)).toBe(true);

    const descWolfOr = 'At the beginning of your upkeep, if enchanted creature is a Wolf or Werewolf, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descWolfOr, aura)).toBe(true);

    // Non-red, non-wolf creature should fail.
    const bear = {
      id: 'c_bear',
      controller: p1,
      owner: p1,
      card: { id: 'c_bear_card', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', colors: ['G'] },
      tapped: false,
      attachments: ['a2'],
    };
    const aura2 = { ...aura, id: 'a2', attachedTo: 'c_bear' };
    (g.state.battlefield as any).push(bear, aura2);

    expect(isInterveningIfSatisfied(g as any, String(p1), descRed, aura2)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), descWolfOr, aura2)).toBe(false);
  });

  it('supports "if enchanted permanent is tapped" and "if enchanted Equipment is attached to a creature"', () => {
    const g = createInitialGameState('t_intervening_if_enchanted_perm_and_equipment');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const artifact = {
      id: 'perm1',
      controller: p1,
      owner: p1,
      card: { id: 'perm1_card', name: 'Test Artifact', type_line: 'Artifact', oracle_text: '' },
      tapped: true,
      attachments: ['a1'],
    };

    const auraOnArtifact = {
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { id: 'a1_card', name: 'Control Aura', type_line: 'Enchantment — Aura', oracle_text: 'Enchant permanent' },
      attachedTo: 'perm1',
    };

    (g.state.battlefield as any).push(artifact, auraOnArtifact);

    const descTapped = 'At the beginning of your upkeep, if enchanted permanent is tapped, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descTapped, auraOnArtifact)).toBe(true);

    artifact.tapped = false;
    expect(isInterveningIfSatisfied(g as any, String(p1), descTapped, auraOnArtifact)).toBe(false);

    const creature = {
      id: 'c1',
      controller: p1,
      owner: p1,
      card: { id: 'c1_card', name: 'Creature', type_line: 'Creature — Human', oracle_text: '' },
    };

    const equipment = {
      id: 'eq1',
      controller: p1,
      owner: p1,
      card: { id: 'eq1_card', name: 'Equipment', type_line: 'Artifact — Equipment', oracle_text: 'Equip {1}' },
      attachedTo: 'c1',
    };

    const auraOnEquipment = {
      id: 'a_eq',
      controller: p1,
      owner: p1,
      card: { id: 'a_eq_card', name: 'Enchant Equipment', type_line: 'Enchantment — Aura', oracle_text: 'Enchant artifact' },
      attachedTo: 'eq1',
    };

    (g.state.battlefield as any).push(creature, equipment, auraOnEquipment);

    const descEqAttached = 'At the beginning of your upkeep, if enchanted Equipment is attached to a creature, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descEqAttached, auraOnEquipment)).toBe(true);

    delete (equipment as any).attachedTo;
    expect(isInterveningIfSatisfied(g as any, String(p1), descEqAttached, auraOnEquipment)).toBe(false);
  });
});
