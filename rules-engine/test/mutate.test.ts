/**
 * Tests for Mutate keyword ability
 * Rule 702.140
 */
import { describe, it, expect } from 'vitest';
import {
  mutate,
  castWithMutate,
  completeMutate,
  hasMutated,
  isOnTop,
  getMergedCards,
  hasRedundantMutate,
  isValidMutateTarget,
  getValidMutateTargets,
  createMutatedPermanent,
  getMutatedPermanentCharacteristics,
  getMutatedPermanentAbilities,
  mutatedPermanentContainsCommander,
  getCommandersFromMutation,
  separateMutatedPermanent,
  isMutatedPermanentLegendary,
  parseMutateCost,
  hasMutateAbility,
  copyMutatedPermanent,
  type MutatedPermanent,
} from '../src/keywordAbilities/mutate';

describe('Mutate keyword ability', () => {
  describe('mutate()', () => {
    it('should create a mutate ability', () => {
      const ability = mutate('Brokkos, Apex of Forever', '{2}{U/B}{G}{G}');
      
      expect(ability.type).toBe('mutate');
      expect(ability.source).toBe('Brokkos, Apex of Forever');
      expect(ability.mutateCost).toBe('{2}{U/B}{G}{G}');
      expect(ability.hasMutated).toBe(false);
      expect(ability.onTop).toBe(true);
      expect(ability.mergedCards).toEqual([]);
    });
  });

  describe('castWithMutate()', () => {
    it('should set mutate target and flag', () => {
      const ability = mutate('Gemrazer', '{1}{G}{G}');
      const mutated = castWithMutate(ability, 'creature-123');
      
      expect(mutated.hasMutated).toBe(true);
      expect(mutated.targetCreature).toBe('creature-123');
    });
  });

  describe('completeMutate()', () => {
    it('should complete mutation with merged cards', () => {
      const ability = castWithMutate(mutate('Gemrazer', '{1}{G}{G}'), 'creature-123');
      const completed = completeMutate(ability, true, ['card-1', 'card-2']);
      
      expect(completed.onTop).toBe(true);
      expect(completed.mergedCards).toEqual(['card-1', 'card-2']);
    });

    it('should allow placing on bottom', () => {
      const ability = castWithMutate(mutate('Gemrazer', '{1}{G}{G}'), 'creature-123');
      const completed = completeMutate(ability, false, ['card-1', 'card-2']);
      
      expect(completed.onTop).toBe(false);
    });
  });

  describe('isValidMutateTarget()', () => {
    it('should validate non-Human creature with same owner', () => {
      const permanent = {
        owner: 'player-1',
        card: { type_line: 'Creature — Beast' },
      };
      
      const result = isValidMutateTarget(permanent, 'player-1');
      expect(result.valid).toBe(true);
    });

    it('should reject Human creatures', () => {
      const permanent = {
        owner: 'player-1',
        card: { type_line: 'Creature — Human Wizard' },
      };
      
      const result = isValidMutateTarget(permanent, 'player-1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Human');
    });

    it('should reject non-creatures', () => {
      const permanent = {
        owner: 'player-1',
        card: { type_line: 'Artifact' },
      };
      
      const result = isValidMutateTarget(permanent, 'player-1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('creature');
    });

    it('should reject creatures with different owner', () => {
      const permanent = {
        owner: 'player-2',
        card: { type_line: 'Creature — Beast' },
      };
      
      const result = isValidMutateTarget(permanent, 'player-1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('same owner');
    });
  });

  describe('getValidMutateTargets()', () => {
    it('should find all valid targets', () => {
      const battlefield = [
        { id: 'c1', owner: 'player-1', controller: 'player-1', card: { name: 'Beast', type_line: 'Creature — Beast' } },
        { id: 'c2', owner: 'player-1', controller: 'player-1', card: { name: 'Human', type_line: 'Creature — Human' } },
        { id: 'c3', owner: 'player-2', controller: 'player-1', card: { name: 'Elf', type_line: 'Creature — Elf' } },
        { id: 'c4', owner: 'player-1', controller: 'player-1', card: { name: 'Dragon', type_line: 'Creature — Dragon' } },
      ];
      
      const targets = getValidMutateTargets(battlefield, 'player-1');
      
      expect(targets).toHaveLength(2);
      expect(targets.map(t => t.permanentId)).toContain('c1');
      expect(targets.map(t => t.permanentId)).toContain('c4');
    });
  });

  describe('createMutatedPermanent()', () => {
    it('should create mutated permanent with card on top', () => {
      const targetPerm = {
        id: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        card: {
          id: 'card-1',
          name: 'Porcuparrot',
          type_line: 'Creature — Bird Beast',
          oracle_text: 'Tap target creature you control: This creature deals X damage to any target.',
          power: '3',
          toughness: '4',
        },
      };
      
      const mutatingCard = {
        id: 'card-2',
        name: 'Gemrazer',
        type_line: 'Creature — Beast',
        oracle_text: 'Mutate {1}{G}{G}\nReach, trample\nWhenever this creature mutates, destroy target artifact or enchantment.',
        power: '4',
        toughness: '4',
      };
      
      const mutated = createMutatedPermanent(targetPerm, mutatingCard, true);
      
      expect(mutated.permanentId).toBe('perm-1');
      expect(mutated.cardStack).toHaveLength(2);
      expect(mutated.cardStack[0].name).toBe('Gemrazer'); // On top
      expect(mutated.cardStack[1].name).toBe('Porcuparrot'); // On bottom
      expect(mutated.mutationCount).toBe(1);
    });

    it('should create mutated permanent with card on bottom', () => {
      const targetPerm = {
        id: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        card: {
          id: 'card-1',
          name: 'Porcuparrot',
          type_line: 'Creature — Bird Beast',
          oracle_text: 'Tap: Deal X damage.',
          power: '3',
          toughness: '4',
        },
      };
      
      const mutatingCard = {
        id: 'card-2',
        name: 'Gemrazer',
        type_line: 'Creature — Beast',
        oracle_text: 'Mutate {1}{G}{G}',
        power: '4',
        toughness: '4',
      };
      
      const mutated = createMutatedPermanent(targetPerm, mutatingCard, false);
      
      expect(mutated.cardStack[0].name).toBe('Porcuparrot'); // On top (original)
      expect(mutated.cardStack[1].name).toBe('Gemrazer'); // On bottom (mutating)
    });

    it('should add to existing mutation stack', () => {
      const existingMutation: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature', oracleText: '', isOriginal: false },
          { id: 'card-0', name: 'Porcuparrot', typeLine: 'Creature', oracleText: '', isOriginal: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      const targetPerm = {
        id: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        card: { id: 'card-1', name: 'Gemrazer', type_line: 'Creature' },
      };
      
      const newMutatingCard = {
        id: 'card-3',
        name: 'Dreamtail Heron',
        type_line: 'Creature — Elemental Bird',
        oracle_text: 'Mutate {3}{U}',
      };
      
      const mutated = createMutatedPermanent(targetPerm, newMutatingCard, true, existingMutation);
      
      expect(mutated.cardStack).toHaveLength(3);
      expect(mutated.cardStack[0].name).toBe('Dreamtail Heron'); // New card on top
      expect(mutated.mutationCount).toBe(2);
    });
  });

  describe('getMutatedPermanentCharacteristics()', () => {
    it('should return characteristics from top card', () => {
      const mutated: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature — Beast', oracleText: 'Reach, trample', power: '4', toughness: '4', isOriginal: false },
          { id: 'card-0', name: 'Porcuparrot', typeLine: 'Creature — Bird Beast', oracleText: 'Tap: Deal damage', power: '3', toughness: '4', isOriginal: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      const chars = getMutatedPermanentCharacteristics(mutated);
      
      expect(chars.name).toBe('Gemrazer');
      expect(chars.power).toBe('4');
      expect(chars.toughness).toBe('4');
      expect(chars.typeLine).toBe('Creature — Beast');
    });
  });

  describe('getMutatedPermanentAbilities()', () => {
    it('should return all abilities from all cards', () => {
      const mutated: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature', oracleText: 'Reach, trample\nWhenever this creature mutates, destroy target artifact.', isOriginal: false },
          { id: 'card-0', name: 'Porcuparrot', typeLine: 'Creature', oracleText: '{T}: This creature deals X damage to any target.', isOriginal: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      const abilities = getMutatedPermanentAbilities(mutated);
      
      expect(abilities).toHaveLength(3);
      expect(abilities).toContain('Reach, trample');
    });
  });

  describe('mutatedPermanentContainsCommander()', () => {
    it('should detect commander in stack', () => {
      const mutated: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature', oracleText: '', isOriginal: false },
          { id: 'card-0', name: 'Brokkos', typeLine: 'Creature', oracleText: '', isOriginal: true, isCommander: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      expect(mutatedPermanentContainsCommander(mutated)).toBe(true);
    });

    it('should return false if no commander', () => {
      const mutated: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature', oracleText: '', isOriginal: false },
          { id: 'card-0', name: 'Porcuparrot', typeLine: 'Creature', oracleText: '', isOriginal: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      expect(mutatedPermanentContainsCommander(mutated)).toBe(false);
    });
  });

  describe('separateMutatedPermanent()', () => {
    it('should separate cards when leaving battlefield', () => {
      const mutated: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature', oracleText: '', isOriginal: false },
          { id: 'card-0', name: 'Porcuparrot', typeLine: 'Creature', oracleText: '', isOriginal: true, isCommander: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      const separated = separateMutatedPermanent(mutated, 'graveyard');
      
      expect(separated).toHaveLength(2);
      expect(separated[0]).toEqual({ cardId: 'card-1', zone: 'graveyard', isCommander: false });
      expect(separated[1]).toEqual({ cardId: 'card-0', zone: 'graveyard', isCommander: true });
    });
  });

  describe('isMutatedPermanentLegendary()', () => {
    it('should return true if top card is legendary', () => {
      const mutated: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Brokkos', typeLine: 'Legendary Creature — Nightmare Beast', oracleText: '', isOriginal: false },
          { id: 'card-0', name: 'Porcuparrot', typeLine: 'Creature', oracleText: '', isOriginal: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      expect(isMutatedPermanentLegendary(mutated)).toBe(true);
    });

    it('should return false if legendary is on bottom', () => {
      const mutated: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature — Beast', oracleText: '', isOriginal: false },
          { id: 'card-0', name: 'Brokkos', typeLine: 'Legendary Creature', oracleText: '', isOriginal: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      expect(isMutatedPermanentLegendary(mutated)).toBe(false);
    });
  });

  describe('parseMutateCost()', () => {
    it('should parse mutate cost from oracle text', () => {
      expect(parseMutateCost('Mutate {1}{G}{G}')).toBe('{1}{G}{G}');
      expect(parseMutateCost('Mutate {2}{U/B}{G}{G}')).toBe('{2}{U/B}{G}{G}');
      expect(parseMutateCost('Flying\nMutate {3}{U}')).toBe('{3}{U}');
    });

    it('should return undefined if no mutate cost', () => {
      expect(parseMutateCost('Flying, trample')).toBeUndefined();
      expect(parseMutateCost('')).toBeUndefined();
    });
  });

  describe('hasMutateAbility()', () => {
    it('should detect mutate in oracle text', () => {
      expect(hasMutateAbility('Mutate {1}{G}{G}')).toBe(true);
      expect(hasMutateAbility('Flying\nMutate {3}{U}')).toBe(true);
    });

    it('should return false if no mutate', () => {
      expect(hasMutateAbility('Flying, trample')).toBe(false);
      expect(hasMutateAbility('')).toBe(false);
    });
  });

  describe('copyMutatedPermanent()', () => {
    it('should copy entire mutation stack', () => {
      const original: MutatedPermanent = {
        permanentId: 'perm-1',
        controller: 'player-1',
        owner: 'player-1',
        cardStack: [
          { id: 'card-1', name: 'Gemrazer', typeLine: 'Creature', oracleText: 'Reach', isOriginal: false, isCommander: true },
          { id: 'card-0', name: 'Porcuparrot', typeLine: 'Creature', oracleText: 'Tap: Deal damage', isOriginal: true },
        ],
        mutationCount: 1,
        summoningSicknessInherited: true,
      };
      
      const copy = copyMutatedPermanent(original, 'perm-copy', 'player-2');
      
      expect(copy.permanentId).toBe('perm-copy');
      expect(copy.controller).toBe('player-2');
      expect(copy.cardStack).toHaveLength(2);
      expect(copy.cardStack[0].name).toBe('Gemrazer');
      expect(copy.cardStack[0].isCommander).toBe(false); // Copies are not commanders
      expect(copy.cardStack[0].isOriginal).toBe(false);
    });
  });
});
