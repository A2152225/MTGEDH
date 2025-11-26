/**
 * Test suite for summoning sickness and combat validation
 * 
 * Summoning Sickness Rules (Rule 302.6):
 * - A creature can't attack unless it has been under its controller's control
 *   continuously since the beginning of their most recent turn.
 * - A creature can't use activated abilities with the tap or untap symbol
 *   unless it has been under its controller's control continuously since
 *   the beginning of their most recent turn.
 * - Haste allows a creature to ignore summoning sickness.
 * 
 * This test ensures:
 * 1. Newly-entered creatures cannot attack
 * 2. Creatures with haste CAN attack when they enter
 * 3. Summoning sickness is cleared at the start of the controller's turn
 */

import { describe, it, expect, beforeEach } from 'vitest';

interface Permanent {
  id: string;
  controller: string;
  tapped: boolean;
  summoningSickness: boolean;
  enteredThisTurn?: boolean;
  card: {
    name: string;
    type_line: string;
    oracle_text: string;
    power?: string;
    toughness?: string;
  };
}

/**
 * Check if a creature has haste (can ignore summoning sickness)
 */
function hasHaste(permanent: Permanent): boolean {
  const oracleText = (permanent.card.oracle_text || '').toLowerCase();
  return oracleText.includes('haste');
}

/**
 * Check if a creature can attack considering summoning sickness
 */
function canCreatureAttack(
  permanent: Permanent,
  controlledSinceTurnStart: boolean
): { canAttack: boolean; reason?: string } {
  // Must be a creature
  const typeLine = (permanent.card.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) {
    return { canAttack: false, reason: 'Not a creature' };
  }
  
  // Cannot attack if tapped
  if (permanent.tapped) {
    const hasVigilance = (permanent.card.oracle_text || '').toLowerCase().includes('vigilance');
    if (!hasVigilance) {
      return { canAttack: false, reason: 'Creature is tapped' };
    }
  }
  
  // Check defender
  const hasDefender = (permanent.card.oracle_text || '').toLowerCase().includes('defender');
  if (hasDefender) {
    return { canAttack: false, reason: 'Creature has defender' };
  }
  
  // Check summoning sickness
  if (permanent.summoningSickness) {
    if (!hasHaste(permanent)) {
      return { canAttack: false, reason: 'Creature has summoning sickness' };
    }
  }
  
  // Alternative check: entered this turn and not controlled since turn start
  if (!controlledSinceTurnStart && permanent.enteredThisTurn) {
    if (!hasHaste(permanent)) {
      return { canAttack: false, reason: 'Creature has summoning sickness' };
    }
  }
  
  return { canAttack: true };
}

/**
 * Check if a creature can use tap abilities considering summoning sickness
 */
function canUseTapAbility(
  permanent: Permanent,
  abilityText: string
): { canActivate: boolean; reason?: string } {
  // Check if ability requires tapping
  const requiresTap = abilityText.includes('{T}') || abilityText.includes('{t}') ||
                      abilityText.toLowerCase().includes('tap');
  
  if (!requiresTap) {
    // Non-tap abilities are not affected by summoning sickness
    return { canActivate: true };
  }
  
  // Cannot use tap ability if already tapped
  if (permanent.tapped) {
    return { canActivate: false, reason: 'Creature is already tapped' };
  }
  
  // Check summoning sickness for tap abilities
  if (permanent.summoningSickness) {
    if (!hasHaste(permanent)) {
      return { canActivate: false, reason: 'Creature has summoning sickness' };
    }
  }
  
  return { canActivate: true };
}

/**
 * Clear summoning sickness for a player's permanents at the start of their turn
 */
function clearSummoningSicknessForPlayer(
  battlefield: Permanent[],
  playerId: string
): string[] {
  const cleared: string[] = [];
  
  for (const permanent of battlefield) {
    if (permanent.controller === playerId && permanent.summoningSickness) {
      permanent.summoningSickness = false;
      cleared.push(permanent.id);
    }
    // Also clear enteredThisTurn flag
    if (permanent.controller === playerId && permanent.enteredThisTurn) {
      permanent.enteredThisTurn = false;
    }
  }
  
  return cleared;
}

/**
 * Set summoning sickness when a creature enters the battlefield
 */
function applyEnterBattlefieldEffects(permanent: Permanent): void {
  const typeLine = (permanent.card.type_line || '').toLowerCase();
  
  // Only creatures have summoning sickness
  if (typeLine.includes('creature')) {
    permanent.summoningSickness = true;
    permanent.enteredThisTurn = true;
  }
}

describe('Summoning Sickness', () => {
  let battlefield: Permanent[];
  
  beforeEach(() => {
    battlefield = [];
  });
  
  describe('Attack Restrictions', () => {
    it('should prevent creature with summoning sickness from attacking', () => {
      const creature: Permanent = {
        id: 'bear1',
        controller: 'player1',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      };
      
      const result = canCreatureAttack(creature, false);
      
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('summoning sickness');
    });
    
    it('should allow creature with haste to attack despite summoning sickness', () => {
      const creature: Permanent = {
        id: 'goblin1',
        controller: 'player1',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          oracle_text: 'Haste\nWhenever Goblin Guide attacks, defending player reveals the top card of their library.',
          power: '2',
          toughness: '2',
        },
      };
      
      const result = canCreatureAttack(creature, false);
      
      expect(result.canAttack).toBe(true);
    });
    
    it('should allow creature without summoning sickness to attack', () => {
      const creature: Permanent = {
        id: 'bear1',
        controller: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      };
      
      const result = canCreatureAttack(creature, true);
      
      expect(result.canAttack).toBe(true);
    });
    
    it('should prevent tapped creature from attacking', () => {
      const creature: Permanent = {
        id: 'bear1',
        controller: 'player1',
        tapped: true,
        summoningSickness: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      };
      
      const result = canCreatureAttack(creature, true);
      
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('tapped');
    });
    
    it('should prevent defender from attacking', () => {
      const creature: Permanent = {
        id: 'wall1',
        controller: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Wall of Omens',
          type_line: 'Creature — Wall',
          oracle_text: 'Defender\nWhen Wall of Omens enters the battlefield, draw a card.',
          power: '0',
          toughness: '4',
        },
      };
      
      const result = canCreatureAttack(creature, true);
      
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('defender');
    });
  });
  
  describe('Tap Ability Restrictions', () => {
    it('should prevent tap ability use with summoning sickness', () => {
      const creature: Permanent = {
        id: 'humble1',
        controller: 'player1',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector.',
          power: '2',
          toughness: '1',
        },
      };
      
      const result = canUseTapAbility(creature, '{T}: Draw two cards.');
      
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('summoning sickness');
    });
    
    it('should allow tap ability with haste', () => {
      const creature: Permanent = {
        id: 'creature1',
        controller: 'player1',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Fires of Yavimaya',
          type_line: 'Creature — Elemental',
          oracle_text: 'Haste\n{T}: Add {R}.',
          power: '1',
          toughness: '1',
        },
      };
      
      const result = canUseTapAbility(creature, '{T}: Add {R}.');
      
      expect(result.canActivate).toBe(true);
    });
    
    it('should allow tap ability after summoning sickness clears', () => {
      const creature: Permanent = {
        id: 'humble1',
        controller: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector.',
          power: '2',
          toughness: '1',
        },
      };
      
      const result = canUseTapAbility(creature, '{T}: Draw two cards.');
      
      expect(result.canActivate).toBe(true);
    });
    
    it('should prevent tap ability when already tapped', () => {
      const creature: Permanent = {
        id: 'humble1',
        controller: 'player1',
        tapped: true,
        summoningSickness: false,
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector.',
          power: '2',
          toughness: '1',
        },
      };
      
      const result = canUseTapAbility(creature, '{T}: Draw two cards.');
      
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('already tapped');
    });
    
    it('should allow non-tap abilities regardless of summoning sickness', () => {
      const creature: Permanent = {
        id: 'shivan1',
        controller: 'player1',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Shivan Dragon',
          type_line: 'Creature — Dragon',
          oracle_text: 'Flying\n{R}: Shivan Dragon gets +1/+0 until end of turn.',
          power: '5',
          toughness: '5',
        },
      };
      
      // Firebreathing doesn't require tap
      const result = canUseTapAbility(creature, '{R}: Shivan Dragon gets +1/+0 until end of turn.');
      
      expect(result.canActivate).toBe(true);
    });
  });
  
  describe('Summoning Sickness Clearing', () => {
    it('should clear summoning sickness at start of player turn', () => {
      battlefield.push({
        id: 'bear1',
        controller: 'player1',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      });
      battlefield.push({
        id: 'bird1',
        controller: 'player1',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Birds of Paradise',
          type_line: 'Creature — Bird',
          oracle_text: 'Flying\n{T}: Add one mana of any color.',
        },
      });
      battlefield.push({
        id: 'opponent_bear',
        controller: 'player2',
        tapped: false,
        summoningSickness: true,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      });
      
      // Start of player1's turn
      const cleared = clearSummoningSicknessForPlayer(battlefield, 'player1');
      
      expect(cleared).toContain('bear1');
      expect(cleared).toContain('bird1');
      expect(cleared).not.toContain('opponent_bear'); // Opponent's creature not cleared
      
      expect(battlefield[0].summoningSickness).toBe(false);
      expect(battlefield[1].summoningSickness).toBe(false);
      expect(battlefield[2].summoningSickness).toBe(true); // Still has summoning sickness
    });
  });
  
  describe('Enter Battlefield Effects', () => {
    it('should apply summoning sickness to new creatures', () => {
      const creature: Permanent = {
        id: 'bear1',
        controller: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      };
      
      applyEnterBattlefieldEffects(creature);
      
      expect(creature.summoningSickness).toBe(true);
      expect(creature.enteredThisTurn).toBe(true);
    });
    
    it('should NOT apply summoning sickness to non-creatures', () => {
      const artifact: Permanent = {
        id: 'sol1',
        controller: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        },
      };
      
      applyEnterBattlefieldEffects(artifact);
      
      expect(artifact.summoningSickness).toBe(false);
    });
    
    it('should apply summoning sickness to artifact creatures', () => {
      const creature: Permanent = {
        id: 'construct1',
        controller: 'player1',
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Steel Overseer',
          type_line: 'Artifact Creature — Construct',
          oracle_text: '{T}: Put a +1/+1 counter on each artifact creature you control.',
        },
      };
      
      applyEnterBattlefieldEffects(creature);
      
      expect(creature.summoningSickness).toBe(true);
    });
  });
});
