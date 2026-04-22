import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import {
  calculateCombatDamage,
  processTriggeredAbilities,
  requiresDecisionToResolve,
} from '../src/AutomationService';

describe('AutomationService target decisions', () => {
  it('filters spell target options through source-aware legality', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'protected-creature',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Silver Knight',
            type_line: 'Creature — Human Knight',
            oracle_text: 'Protection from blue',
            power: '2',
            toughness: '2',
          },
        },
        {
          id: 'legal-creature',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Bear Cub',
            type_line: 'Creature — Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
      stack: [],
    } as any;

    const result = requiresDecisionToResolve({
      id: 'spell1',
      type: 'spell',
      controller: 'player1',
      card: {
        name: 'Blue Blast',
        type_line: 'Instant',
        oracle_text: 'Target creature gets -1/-1 until end of turn.',
        colors: ['U'],
      },
      targets: [],
    } as any, state);

    expect(result.requires).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].options?.map(option => option.id)).toEqual(['legal-creature']);
  });

  it('builds old spell target options for controller-qualified mixed permanent targets', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'self-artifact',
          controller: 'player1',
          owner: 'player1',
          card: {
            name: 'Traveler\'s Amulet',
            type_line: 'Artifact',
            oracle_text: '',
          },
        },
        {
          id: 'opponent-artifact',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Mind Stone',
            type_line: 'Artifact',
            oracle_text: '',
          },
        },
        {
          id: 'opponent-enchantment',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Pacifism',
            type_line: 'Enchantment',
            oracle_text: '',
          },
        },
      ],
      stack: [],
    } as any;

    const result = requiresDecisionToResolve({
      id: 'spell1',
      type: 'spell',
      controller: 'player1',
      card: {
        name: 'Sundering Choice',
        type_line: 'Sorcery',
        oracle_text: 'Destroy target artifact or enchantment an opponent controls.',
      },
      targets: [],
    } as any, state);

    expect(result.requires).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].filters).toEqual([{ type: 'controller', value: 'opponent' }]);
    expect(result.decisions[0].options?.map(option => option.id)).toEqual([
      'opponent-artifact',
      'opponent-enchantment',
    ]);
  });

  it('sets minX to 1 when oracle text says X cannot be 0', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [],
      stack: [],
    } as any;

    const result = requiresDecisionToResolve({
      id: 'spell-x-1',
      type: 'spell',
      controller: 'player1',
      card: {
        name: 'Mind Spring Variant',
        type_line: 'Sorcery',
        mana_cost: '{X}{U}{U}',
        oracle_text: 'Draw X cards. X can\'t be 0.',
      },
      targets: [],
    } as any, state);

    expect(result.requires).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].type).toBe('select_x_value');
    expect(result.decisions[0].minX).toBe(1);
  });

  it('excludes self-controlled and land permanents from old nonland-opponent target prompts', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'self-creature',
          controller: 'player1',
          owner: 'player1',
          card: {
            name: 'Runeclaw Bear',
            type_line: 'Creature — Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
        {
          id: 'opponent-land',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '',
          },
        },
        {
          id: 'opponent-creature',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Hill Giant',
            type_line: 'Creature — Giant',
            oracle_text: '',
            power: '3',
            toughness: '3',
          },
        },
      ],
      stack: [],
    } as any;

    const result = requiresDecisionToResolve({
      id: 'spell2',
      type: 'spell',
      controller: 'player1',
      card: {
        name: 'Oppressive Bounce',
        type_line: 'Instant',
        oracle_text: 'Return target nonland permanent you don\'t control to its owner\'s hand.',
      },
      targets: [],
    } as any, state);

    expect(result.requires).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].filters).toEqual([
      { type: 'controller', value: 'opponent' },
      { type: 'custom', value: 'nonland' },
    ]);
    expect(result.decisions[0].options?.map(option => option.id)).toEqual(['opponent-creature']);
  });

  it('builds graveyard card target options for old spell prompts', () => {
    const state: GameState = {
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          life: 40,
          graveyard: [
            {
              id: 'bear-card',
              name: 'Grizzly Bears',
              type_line: 'Creature — Bear',
              oracle_text: '',
            },
          ],
        },
        {
          id: 'player2',
          name: 'Player 2',
          life: 40,
          graveyard: [
            {
              id: 'ritual-card',
              name: 'Dark Ritual',
              type_line: 'Instant',
              oracle_text: '',
            },
            {
              id: 'giant-card',
              name: 'Hill Giant',
              type_line: 'Creature — Giant',
              oracle_text: '',
            },
          ],
        },
      ],
      battlefield: [],
      stack: [],
    } as any;

    const result = requiresDecisionToResolve({
      id: 'spell3',
      type: 'spell',
      controller: 'player1',
      card: {
        name: 'Raise the Lost',
        type_line: 'Sorcery',
        oracle_text: 'Return target creature card from a graveyard to its owner\'s hand.',
      },
      targets: [],
    } as any, state);

    expect(result.requires).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].filters).toEqual([{ type: 'zone', value: 'graveyard' }]);
    expect(result.decisions[0].options?.map(option => option.id)).toEqual(['bear-card', 'giant-card']);
  });

  it('builds self-graveyard instant-or-sorcery target options for old spell prompts', () => {
    const state: GameState = {
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          life: 40,
          graveyard: [
            {
              id: 'instant-card',
              name: 'Opt',
              type_line: 'Instant',
              oracle_text: '',
            },
            {
              id: 'creature-card',
              name: 'Runeclaw Bear',
              type_line: 'Creature — Bear',
              oracle_text: '',
            },
          ],
        },
        {
          id: 'player2',
          name: 'Player 2',
          life: 40,
          graveyard: [
            {
              id: 'opponent-sorcery',
              name: 'Divination',
              type_line: 'Sorcery',
              oracle_text: '',
            },
          ],
        },
      ],
      battlefield: [],
      stack: [],
    } as any;

    const result = requiresDecisionToResolve({
      id: 'spell4',
      type: 'spell',
      controller: 'player1',
      card: {
        name: 'Mnemonic Recall',
        type_line: 'Sorcery',
        oracle_text: 'Exile target instant or sorcery card from your graveyard.',
      },
      targets: [],
    } as any, state);

    expect(result.requires).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].filters).toEqual([
      { type: 'controller', value: 'self' },
      { type: 'zone', value: 'graveyard' },
    ]);
    expect(result.decisions[0].options?.map(option => option.id)).toEqual(['instant-card']);
  });

  it('builds attacking-only target options for old combat-state prompts', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'attacking-creature',
          controller: 'player2',
          owner: 'player2',
          attacking: 'player1',
          card: {
            name: 'Attacking Bear',
            type_line: 'Creature — Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
        {
          id: 'resting-creature',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Resting Bear',
            type_line: 'Creature — Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
      stack: [],
    } as any;

    const result = requiresDecisionToResolve({
      id: 'spell5',
      type: 'spell',
      controller: 'player1',
      card: {
        name: 'Repel Assault',
        type_line: 'Instant',
        oracle_text: 'Destroy target attacking creature.',
      },
      targets: [],
    } as any, state);

    expect(result.requires).toBe(true);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].filters).toEqual([{ type: 'custom', value: 'attacking' }]);
    expect(result.decisions[0].options?.map(option => option.id)).toEqual(['attacking-creature']);
  });

  it('builds triggered target decisions against the trigger stack item and excludes illegal options', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
        { id: 'player3', name: 'Player 3', life: 40 },
      ],
      battlefield: [
        {
          id: 'source-creature',
          controller: 'player1',
          owner: 'player1',
          attacking: 'player2',
          card: {
            name: 'Frost Archer',
            type_line: 'Creature — Wizard',
            oracle_text: 'Whenever Frost Archer attacks, target opponent loses 1 life.',
            colors: ['U'],
            power: '2',
            toughness: '2',
          },
        },
        {
          id: 'hexproof-source',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Witchbane Orb',
            type_line: 'Artifact',
            oracle_text: 'You have hexproof.',
          },
        },
      ],
      stack: [],
    } as any;

    const result = processTriggeredAbilities(state, {
      type: 'attacks',
      data: { permanentId: 'source-creature' },
    });

    expect(result.triggersProcessed).toBe(1);
    expect(result.state.stack).toHaveLength(1);
    expect(result.pendingDecisions).toHaveLength(1);
    expect(result.pendingDecisions[0].sourceId).toBe(result.state.stack?.[0].id);
    expect(result.pendingDecisions[0].options?.map(option => option.id)).toEqual(['player3']);
  });

  it('skips triggered target prompts when no legal targets exist', () => {
    const state: GameState = {
      players: [
        { id: 'player1', name: 'Player 1', life: 40 },
        { id: 'player2', name: 'Player 2', life: 40 },
      ],
      battlefield: [
        {
          id: 'source-creature',
          controller: 'player1',
          owner: 'player1',
          attacking: 'player2',
          card: {
            name: 'Frost Archer',
            type_line: 'Creature — Wizard',
            oracle_text: 'Whenever Frost Archer attacks, target opponent loses 1 life.',
            colors: ['U'],
            power: '2',
            toughness: '2',
          },
        },
        {
          id: 'hexproof-source',
          controller: 'player2',
          owner: 'player2',
          card: {
            name: 'Witchbane Orb',
            type_line: 'Artifact',
            oracle_text: 'You have hexproof.',
          },
        },
      ],
      stack: [],
    } as any;

    const result = processTriggeredAbilities(state, {
      type: 'attacks',
      data: { permanentId: 'source-creature' },
    });

    expect(result.triggersProcessed).toBe(0);
    expect(result.pendingDecisions).toHaveLength(0);
    expect(result.state.stack).toHaveLength(0);
  });
});

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