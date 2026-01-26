import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name } as any);
}

describe('Intervening-if: this creature attachment/status batch', () => {
  it('evaluates "if this creature has defender" conservatively', () => {
    const g = createInitialGameState('t_if_this_creature_defender');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const withDefender = {
      id: 'c_def',
      controller: p1,
      owner: p1,
      card: { id: 'c_def_card', name: 'Wall', type_line: 'Creature — Wall', oracle_text: 'Defender' },
    };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has defender', withDefender as any)).toBe(true);

    const withoutDefender = {
      ...withDefender,
      id: 'c_nodef',
      card: { id: 'c_nodef_card', name: 'Bear', type_line: 'Creature — Bear', oracle_text: 'Flying' },
    };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has defender', withoutDefender as any)).toBe(false);

    const noAbilityInfo = {
      ...withDefender,
      id: 'c_unknown',
      card: { id: 'c_unknown_card', name: 'Mystery', type_line: 'Creature', oracle_text: '' },
    };
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature has defender', noAbilityInfo as any)).toBe(null);
  });

  it('evaluates "if this creature is equipped" using tracked fields, else conservatively', () => {
    const g = createInitialGameState('t_if_this_creature_equipped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const base = {
      id: 'c1',
      controller: p1,
      owner: p1,
      card: { id: 'c1_card', name: 'Test Creature', type_line: 'Creature', oracle_text: '' },
    };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is equipped', { ...base, isEquipped: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is equipped', { ...base, isEquipped: false } as any)).toBe(false);

    expect(
      evaluateInterveningIfClause(g as any, String(p1), 'if this creature is equipped', { ...base, attachedEquipment: ['eq1'] } as any)
    ).toBe(true);

    // When attachment tracking is absent, stay conservative.
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is equipped', base as any)).toBe(null);

    // When attachment lists exist (even empty), we can safely conclude false.
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is equipped', { ...base, attachments: [] } as any)).toBe(false);
  });

  it('evaluates "if this creature is enchanted" and "enchanted by two or more Auras" conservatively', () => {
    const g = createInitialGameState('t_if_this_creature_enchanted');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const creature = {
      id: 'c1',
      controller: p1,
      owner: p1,
      card: { id: 'c1_card', name: 'Test Creature', type_line: 'Creature', oracle_text: '' },
      attachments: ['a1'],
    };

    const aura1 = {
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { id: 'a1_card', name: 'Test Aura', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
      attachedTo: 'c1',
    };

    (g.state.battlefield as any[]).push(creature, aura1);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is enchanted', creature as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is enchanted by two or more Auras', creature as any)).toBe(false);

    // Two known auras => true
    const creature2 = { ...creature, id: 'c2', attachments: ['a2', 'a3'] };
    const aura2 = { ...aura1, id: 'a2', attachedTo: 'c2' };
    const aura3 = { ...aura1, id: 'a3', attachedTo: 'c2' };
    (g.state.battlefield as any[]).push(creature2, aura2, aura3);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is enchanted by two or more Auras', creature2 as any)).toBe(true);

    // Unknown attachment id => null (could be an Aura)
    const creatureUnknown = { ...creature, id: 'c3', attachments: ['missing_aura_id'] };
    (g.state.battlefield as any[]).push(creatureUnknown);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is enchanted', creatureUnknown as any)).toBe(null);

    const creatureUnknown2 = { ...creature, id: 'c4', attachments: ['a1', 'missing_aura_id'] };
    (g.state.battlefield as any[]).push(creatureUnknown2);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is enchanted by two or more Auras', creatureUnknown2 as any)).toBe(null);

    // Empty attachment list => definitely not enchanted.
    const creatureBare = { ...creature, id: 'c5', attachments: [] as any[] };
    (g.state.battlefield as any[]).push(creatureBare);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is enchanted', creatureBare as any)).toBe(false);
  });

  it('evaluates "if this creature is monstrous/renowned/suspected" from status flags', () => {
    const g = createInitialGameState('t_if_this_creature_status_flags');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const base = {
      id: 'c1',
      controller: p1,
      owner: p1,
      card: { id: 'c1_card', name: 'Test Creature', type_line: 'Creature', oracle_text: '' },
    };

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is monstrous', { ...base, monstrous: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is monstrous', { ...base, monstrous: false } as any)).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is monstrous', base as any)).toBe(null);

    // Renowned is treated as false unless explicitly true.
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is renowned', { ...base, renowned: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is renowned', { ...base, renowned: false } as any)).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is renowned', base as any)).toBe(false);

    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is suspected', { ...base, suspected: true } as any)).toBe(true);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is suspected', { ...base, suspected: false } as any)).toBe(false);
    expect(evaluateInterveningIfClause(g as any, String(p1), 'if this creature is suspected', base as any)).toBe(null);
  });
});
