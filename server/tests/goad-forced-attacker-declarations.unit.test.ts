import { describe, expect, it } from 'vitest';
import {
  findForcedAttackViolation,
  resolveForcedAttackerDeclarations,
} from '../src/socket/combat-handlers/combatDeclareAttackersForceTapSupport.js';

function createGame() {
  return {
    state: {
      turn: 5,
      players: [
        { id: 'ai-player', life: 40, hasLost: false },
        { id: 'player2', life: 40, hasLost: false },
        { id: 'player3', life: 25, hasLost: false },
      ],
      battlefield: [
        {
          id: 'kynaios',
          controller: 'ai-player',
          owner: 'ai-player',
          tapped: false,
          summoningSickness: false,
          goadedBy: ['player2'],
          card: {
            name: 'Kynaios and Tiro of Meletis',
            type_line: 'Legendary Creature — Human Advisor',
            oracle_text: '',
            power: '2',
            toughness: '8',
          },
        },
      ],
    },
  };
}

describe('resolveForcedAttackerDeclarations', () => {
  it('declares a goaded creature against a non-goader when empty attackers would be illegal', () => {
    const game = createGame();

    expect(findForcedAttackViolation(game, 'ai-player', [])?.code).toBe('GOAD_MUST_ATTACK');

    const forced = resolveForcedAttackerDeclarations(game, 'ai-player');
    expect(forced).toEqual([
      { creatureId: 'kynaios', defendingPlayerId: 'player3' },
    ]);
    expect(findForcedAttackViolation(game, 'ai-player', forced.map((entry) => entry.creatureId))).toBeNull();
  });

  it('does not force a goaded creature that has summoning sickness and no haste', () => {
    const game = createGame();
    const perm = game.state.battlefield[0] as any;
    perm.summoningSickness = true;
    perm.enteredThisTurn = true;
    perm.card = {
      ...perm.card,
      name: 'Regisaur Alpha',
      type_line: 'Creature — Dinosaur',
      oracle_text: 'Other Dinosaurs you control have haste.',
      keywords: [],
    };

    expect(findForcedAttackViolation(game, 'ai-player', [])).toBeNull();
    expect(resolveForcedAttackerDeclarations(game, 'ai-player')).toEqual([]);
  });

  it('does not force a goaded Other [type] haste lord with a stamped haste badge', () => {
    const game = createGame();
    const perm = game.state.battlefield[0] as any;
    perm.summoningSickness = true;
    perm.enteredThisTurn = true;
    perm.grantedAbilities = ['haste'];
    perm.card = {
      ...perm.card,
      name: 'Regisaur Alpha',
      type_line: 'Creature — Dinosaur',
      oracle_text: 'Other Dinosaurs you control have haste.',
      keywords: ['Haste'],
    };

    expect(findForcedAttackViolation(game, 'ai-player', [])).toBeNull();
    expect(resolveForcedAttackerDeclarations(game, 'ai-player')).toEqual([]);
  });
});
