/**
 * Test suite for combat control effects
 * (Master Warcraft, Odric, Master Tactician, Brutal Hordechief, etc.)
 */

import { describe, it, expect } from 'vitest';
import {
  detectCombatControlEffect,
  canCreatureBeControlledToAttack,
  canCreatureBeControlledToBlock,
  getControllableAttackers,
  getControllableBlockers,
  validateCombatControlAttackers,
  validateCombatControlBlockers,
  applyCombatControlEffect,
  clearCombatControlEffect,
} from '../src/combatControl';
import type { BattlefieldPermanent, GameState, KnownCardRef, CombatControlEffect } from '../../shared/src';

// Helper to create a test permanent
function createTestPermanent(
  id: string,
  name: string,
  power: number,
  toughness: number,
  oracleText: string = '',
  controllerId: string = 'player1',
  options: Partial<BattlefieldPermanent> = {}
): BattlefieldPermanent {
  return {
    id,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: false,
    counters: {},
    attachments: [],
    modifiers: [],
    card: {
      id,
      name,
      power: power.toString(),
      toughness: toughness.toString(),
      type_line: 'Creature',
      oracle_text: oracleText,
      colors: [],
    } as KnownCardRef,
    basePower: power,
    baseToughness: toughness,
    ...options,
  };
}

// Helper to create a minimal game state
function createTestGameState(battlefield: BattlefieldPermanent[] = []): GameState {
  return {
    id: 'test-game',
    format: 'commander',
    players: [
      { id: 'player1', name: 'Player 1', seat: 0 },
      { id: 'player2', name: 'Player 2', seat: 1 },
    ],
    startingLife: 40,
    life: { player1: 40, player2: 40 },
    turnPlayer: 'player1',
    priority: 'player1',
    stack: [],
    battlefield,
    commandZone: {},
    phase: 'combat' as any,
    active: true,
  };
}

describe('Combat Control Detection', () => {
  describe('detectCombatControlEffect', () => {
    it('should detect Master Warcraft effect (controls both attackers and blockers)', () => {
      const masterWarcraft = createTestPermanent(
        'mw1',
        'Master Warcraft',
        0,
        0,
        'Cast this spell only before attackers are declared. You choose which creatures attack this turn. You choose which creatures block this turn and how those creatures block.',
        'player1',
        { card: { id: 'mw1', name: 'Master Warcraft', type_line: 'Instant', oracle_text: 'Cast this spell only before attackers are declared. You choose which creatures attack this turn. You choose which creatures block this turn and how those creatures block.' } as KnownCardRef }
      );
      
      const gameState = createTestGameState([masterWarcraft]);
      const effect = detectCombatControlEffect(masterWarcraft, gameState);
      
      expect(effect).not.toBeNull();
      expect(effect?.controlsAttackers).toBe(true);
      expect(effect?.controlsBlockers).toBe(true);
      expect(effect?.controllerId).toBe('player1');
      expect(effect?.sourceName).toBe('Master Warcraft');
    });

    it('should detect Odric, Master Tactician effect (controls blockers when attacking with 4+)', () => {
      const odric = createTestPermanent(
        'odric1',
        'Odric, Master Tactician',
        3,
        4,
        'First strike\nWhenever Odric, Master Tactician and at least three other creatures attack, you choose which creatures block this combat and how those creatures block.',
        'player1'
      );
      
      const gameState = createTestGameState([odric]);
      
      // With 4 attackers, should trigger
      const effect = detectCombatControlEffect(odric, gameState, { attackerCount: 4 });
      expect(effect).not.toBeNull();
      expect(effect?.controlsAttackers).toBe(false);
      expect(effect?.controlsBlockers).toBe(true);
      
      // With less than 4 attackers, should not trigger
      const noEffect = detectCombatControlEffect(odric, gameState, { attackerCount: 3 });
      expect(noEffect).toBeNull();
    });

    it('should detect Brutal Hordechief effect (controls how creatures block)', () => {
      const brutalHordechief = createTestPermanent(
        'bh1',
        'Brutal Hordechief',
        3,
        3,
        'Whenever a creature you control attacks, defending player loses 1 life and you gain 1 life.\n{3}{W/B}{W/B}: Creatures your opponents control block this turn if able, and you choose how those creatures block.',
        'player1',
        { card: { id: 'bh1', name: 'Brutal Hordechief', type_line: 'Creature — Orc Warrior', oracle_text: 'Whenever a creature you control attacks, defending player loses 1 life and you gain 1 life.\n{3}{W/B}{W/B}: Creatures your opponents control block this turn if able, and you choose how creatures block.' } as KnownCardRef }
      );
      
      const gameState = createTestGameState([brutalHordechief]);
      const effect = detectCombatControlEffect(brutalHordechief, gameState);
      
      expect(effect).not.toBeNull();
      expect(effect?.controlsBlockers).toBe(true);
    });

    it('should return null for cards without combat control', () => {
      const grizzlyBears = createTestPermanent(
        'gb1',
        'Grizzly Bears',
        2,
        2,
        ''
      );
      
      const gameState = createTestGameState([grizzlyBears]);
      const effect = detectCombatControlEffect(grizzlyBears, gameState);
      
      expect(effect).toBeNull();
    });
  });
});

describe('Combat Control Attack Validation', () => {
  describe('canCreatureBeControlledToAttack', () => {
    it('should allow untapped creatures to attack', () => {
      const creature = createTestPermanent('c1', 'Grizzly Bears', 2, 2);
      const result = canCreatureBeControlledToAttack(creature, 'player1');
      
      expect(result.canAttack).toBe(true);
    });

    it('should prevent tapped creatures from attacking', () => {
      const creature = createTestPermanent('c1', 'Grizzly Bears', 2, 2, '', 'player1', { tapped: true });
      const result = canCreatureBeControlledToAttack(creature, 'player1');
      
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('tapped');
    });

    it('should prevent creatures with defender from attacking', () => {
      const creature = createTestPermanent('c1', 'Wall of Stone', 0, 8, 'Defender');
      const result = canCreatureBeControlledToAttack(creature, 'player1');
      
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('defender');
    });

    it('should prevent creatures with summoning sickness from attacking (without haste)', () => {
      const creature = createTestPermanent('c1', 'Grizzly Bears', 2, 2, '', 'player1', { summoningSickness: true });
      const result = canCreatureBeControlledToAttack(creature, 'player1');
      
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('summoning sickness');
    });

    it('should allow creatures with haste to attack despite summoning sickness', () => {
      const creature = createTestPermanent('c1', 'Lightning Elemental', 4, 1, 'Haste', 'player1', { summoningSickness: true });
      const result = canCreatureBeControlledToAttack(creature, 'player1');
      
      expect(result.canAttack).toBe(true);
    });
  });

  describe('validateCombatControlAttackers', () => {
    it('should validate legal attacker declarations', () => {
      const creature1 = createTestPermanent('c1', 'Grizzly Bears', 2, 2, '', 'player1');
      const creature2 = createTestPermanent('c2', 'Hill Giant', 3, 3, '', 'player1');
      
      const gameState = createTestGameState([creature1, creature2]);
      const combatControl: CombatControlEffect = {
        controllerId: 'player1',
        sourceId: 'mw1',
        sourceName: 'Master Warcraft',
        controlsAttackers: true,
        controlsBlockers: true,
      };
      
      const attackers = [
        { creatureId: 'c1', targetPlayerId: 'player2' },
        { creatureId: 'c2', targetPlayerId: 'player2' },
      ];
      
      const result = validateCombatControlAttackers(gameState, combatControl, attackers);
      expect(result.valid).toBe(true);
    });

    it('should reject declarations with tapped creatures', () => {
      const creature = createTestPermanent('c1', 'Grizzly Bears', 2, 2, '', 'player1', { tapped: true });
      
      const gameState = createTestGameState([creature]);
      const combatControl: CombatControlEffect = {
        controllerId: 'player1',
        sourceId: 'mw1',
        sourceName: 'Master Warcraft',
        controlsAttackers: true,
        controlsBlockers: true,
      };
      
      const attackers = [{ creatureId: 'c1', targetPlayerId: 'player2' }];
      
      const result = validateCombatControlAttackers(gameState, combatControl, attackers);
      expect(result.valid).toBe(false);
      expect(result.invalidCreatures).toContain('c1');
    });
  });
});

describe('Combat Control Block Validation', () => {
  describe('canCreatureBeControlledToBlock', () => {
    it('should allow untapped creatures to block ground attackers', () => {
      const blocker = createTestPermanent('b1', 'Grizzly Bears', 2, 2);
      const attacker = createTestPermanent('a1', 'Hill Giant', 3, 3);
      
      const result = canCreatureBeControlledToBlock(blocker, attacker);
      expect(result.canBlock).toBe(true);
    });

    it('should prevent tapped creatures from blocking', () => {
      const blocker = createTestPermanent('b1', 'Grizzly Bears', 2, 2, '', 'player1', { tapped: true });
      const attacker = createTestPermanent('a1', 'Hill Giant', 3, 3);
      
      const result = canCreatureBeControlledToBlock(blocker, attacker);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain('tapped');
    });

    it('should prevent ground creatures from blocking flying creatures', () => {
      const blocker = createTestPermanent('b1', 'Grizzly Bears', 2, 2);
      const attacker = createTestPermanent('a1', 'Wind Drake', 2, 2, 'Flying');
      
      const result = canCreatureBeControlledToBlock(blocker, attacker);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain('flying');
    });

    it('should allow flying creatures to block flying creatures', () => {
      const blocker = createTestPermanent('b1', 'Storm Crow', 1, 2, 'Flying');
      const attacker = createTestPermanent('a1', 'Wind Drake', 2, 2, 'Flying');
      
      const result = canCreatureBeControlledToBlock(blocker, attacker);
      expect(result.canBlock).toBe(true);
    });

    it('should allow reach creatures to block flying creatures', () => {
      const blocker = createTestPermanent('b1', 'Giant Spider', 2, 4, 'Reach');
      const attacker = createTestPermanent('a1', 'Wind Drake', 2, 2, 'Flying');
      
      const result = canCreatureBeControlledToBlock(blocker, attacker);
      expect(result.canBlock).toBe(true);
    });

    it('should prevent non-shadow creatures from blocking shadow creatures', () => {
      const blocker = createTestPermanent('b1', 'Grizzly Bears', 2, 2);
      const attacker = createTestPermanent('a1', 'Dauthi Slayer', 2, 2, 'Shadow');
      
      const result = canCreatureBeControlledToBlock(blocker, attacker);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain('shadow');
    });

    it('should prevent non-horsemanship creatures from blocking horsemanship creatures', () => {
      const blocker = createTestPermanent('b1', 'Grizzly Bears', 2, 2);
      const attacker = createTestPermanent('a1', 'Sun Quan, Lord of Wu', 4, 4, 'Horsemanship');
      
      const result = canCreatureBeControlledToBlock(blocker, attacker);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain('horsemanship');
    });
  });
});

describe('Combat Control State Management', () => {
  describe('applyCombatControlEffect', () => {
    it('should add combat control to game state', () => {
      const gameState = createTestGameState([]);
      const combatControl: CombatControlEffect = {
        controllerId: 'player1',
        sourceId: 'mw1',
        sourceName: 'Master Warcraft',
        controlsAttackers: true,
        controlsBlockers: true,
      };
      
      const newState = applyCombatControlEffect(gameState, combatControl);
      
      expect(newState.combat).toBeDefined();
      expect(newState.combat?.combatControl).toEqual(combatControl);
    });
  });

  describe('clearCombatControlEffect', () => {
    it('should remove combat control from game state', () => {
      const gameState = createTestGameState([]);
      const combatControl: CombatControlEffect = {
        controllerId: 'player1',
        sourceId: 'mw1',
        sourceName: 'Master Warcraft',
        controlsAttackers: true,
        controlsBlockers: true,
      };
      
      const stateWithControl = applyCombatControlEffect(gameState, combatControl);
      const clearedState = clearCombatControlEffect(stateWithControl);
      
      expect(clearedState.combat?.combatControl).toBeUndefined();
    });
  });
});

describe('Controllable Creatures', () => {
  describe('getControllableAttackers', () => {
    it('should return all creatures that can attack', () => {
      const creature1 = createTestPermanent('c1', 'Grizzly Bears', 2, 2, '', 'player1');
      const creature2 = createTestPermanent('c2', 'Hill Giant', 3, 3, '', 'player2');
      const creature3 = createTestPermanent('c3', 'Tapped Creature', 2, 2, '', 'player1', { tapped: true });
      
      const gameState = createTestGameState([creature1, creature2, creature3]);
      const combatControl: CombatControlEffect = {
        controllerId: 'player1',
        sourceId: 'mw1',
        sourceName: 'Master Warcraft',
        controlsAttackers: true,
        controlsBlockers: true,
      };
      
      const attackers = getControllableAttackers(gameState, combatControl);
      
      expect(attackers.length).toBe(3);
      
      const c1Info = attackers.find(a => a.id === 'c1');
      expect(c1Info?.canAttack).toBe(true);
      
      const c3Info = attackers.find(a => a.id === 'c3');
      expect(c3Info?.canAttack).toBe(false);
    });
  });

  describe('getControllableBlockers', () => {
    it('should return creatures controlled by defending players', () => {
      const attacker = createTestPermanent('a1', 'Grizzly Bears', 2, 2, '', 'player1');
      const blocker1 = createTestPermanent('b1', 'Hill Giant', 3, 3, '', 'player2');
      const blocker2 = createTestPermanent('b2', 'Tapped Blocker', 2, 2, '', 'player2', { tapped: true });
      
      const gameState = createTestGameState([attacker, blocker1, blocker2]);
      const combatControl: CombatControlEffect = {
        controllerId: 'player1',
        sourceId: 'mw1',
        sourceName: 'Master Warcraft',
        controlsAttackers: true,
        controlsBlockers: true,
      };
      
      const attackers = [{ creatureId: 'a1', targetPlayerId: 'player2' }];
      const blockers = getControllableBlockers(gameState, attackers, combatControl);
      
      expect(blockers.length).toBe(2);
      
      const b1Info = blockers.find(b => b.id === 'b1');
      expect(b1Info?.canBlock).toBe(true);
      
      const b2Info = blockers.find(b => b.id === 'b2');
      expect(b2Info?.canBlock).toBe(false);
    });
  });
});
