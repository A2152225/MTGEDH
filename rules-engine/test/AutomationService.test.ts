import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { calculateCombatDamage } from '../src/AutomationService';

describe('AutomationService combat damage', () => {
  it('uses aura-granted power for unblocked attacker damage', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'creature1',
          controller: 'player1',
          owner: 'player1',
          attacking: 'player2',
          blockedBy: [],
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
        {
          id: 'aura1',
          controller: 'player1',
          owner: 'player1',
          attachedTo: 'creature1',
          card: {
            name: 'Shiny Impetus',
            type_line: 'Enchantment — Aura',
            oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and is goaded.',
          },
        },
      ],
    } as any;

    const result = calculateCombatDamage(state);

    expect(result.damageAssignments).toHaveLength(1);
    expect(result.damageAssignments[0].damage).toBe(4);
  });

  it('uses aura-granted toughness when checking lethal damage against a blocker', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'attacker1',
          controller: 'player1',
          owner: 'player1',
          attacking: 'player2',
          blockedBy: ['blocker1'],
          card: {
            name: 'Hill Giant',
            type_line: 'Creature — Giant',
            power: '3',
            toughness: '3',
            oracle_text: '',
          },
        },
        {
          id: 'blocker1',
          controller: 'player2',
          owner: 'player2',
          blocking: ['attacker1'],
          card: {
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
        {
          id: 'aura1',
          controller: 'player2',
          owner: 'player2',
          attachedTo: 'blocker1',
          card: {
            name: 'Shiny Impetus',
            type_line: 'Enchantment — Aura',
            oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2 and is goaded.',
          },
        },
      ],
    } as any;

    const result = calculateCombatDamage(state);
    const attackerAssignment = result.damageAssignments.find(assignment => assignment.sourceId === 'attacker1');

    expect(attackerAssignment).toBeDefined();
    expect(attackerAssignment?.damage).toBe(3);
    expect(attackerAssignment?.isLethal).toBe(false);
  });

  it('distributes blocker damage across multiple attackers when one blocker blocks several creatures', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'attacker1',
          controller: 'player1',
          owner: 'player1',
          attacking: 'player2',
          blockedBy: ['blocker1'],
          card: {
            name: 'Alpha',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
        {
          id: 'attacker2',
          controller: 'player1',
          owner: 'player1',
          attacking: 'player2',
          blockedBy: ['blocker1'],
          card: {
            name: 'Beta',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
            oracle_text: '',
          },
        },
        {
          id: 'blocker1',
          controller: 'player2',
          owner: 'player2',
          blocking: ['attacker1', 'attacker2'],
          card: {
            name: 'Guardian',
            type_line: 'Creature — Giant',
            power: '3',
            toughness: '5',
            oracle_text: 'Guardian can block any number of creatures.',
          },
        },
      ],
    } as any;

    const result = calculateCombatDamage(state);
    const blockerAssignments = result.damageAssignments.filter(assignment => assignment.sourceId === 'blocker1');

    expect(blockerAssignments).toHaveLength(2);
    expect(blockerAssignments[0].targetId).toBe('attacker1');
    expect(blockerAssignments[0].damage).toBe(2);
    expect(blockerAssignments[1].targetId).toBe('attacker2');
    expect(blockerAssignments[1].damage).toBe(1);
  });
});