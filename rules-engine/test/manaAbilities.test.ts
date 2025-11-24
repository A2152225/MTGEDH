/**
 * Tests for mana abilities system (Rule 605)
 */

import { describe, it, expect } from 'vitest';
import {
  activateManaAbility,
  canActivateManaAbility,
  tapPermanentForMana,
  createBasicLandManaAbility,
  BASIC_LAND_ABILITIES,
  emptyManaPool,
  type ManaAbility,
  type TapForManaContext,
} from '../src/manaAbilities';
import { ManaType } from '../src/types/mana';
import type { ManaPool } from '../src/types/mana';

describe('Mana Abilities System', () => {
  describe('activateManaAbility', () => {
    it('should activate basic land mana ability', () => {
      const ability = createBasicLandManaAbility('forest-1', 'Forest', 'player1', ManaType.GREEN);
      
      const pool: ManaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = activateManaAbility(ability, pool, {
        sourceTapped: false,
        sourceOnBattlefield: true,
        controllerHasPriority: true,
      });

      expect(result.success).toBe(true);
      expect(result.manaPoolAfter?.green).toBe(1);
      expect(result.manaAdded).toHaveLength(1);
      expect(result.manaAdded![0].type).toBe(ManaType.GREEN);
    });

    it('should fail if source already tapped', () => {
      const ability = createBasicLandManaAbility('plains-1', 'Plains', 'player1', ManaType.WHITE);
      
      const pool: ManaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = activateManaAbility(ability, pool, {
        sourceTapped: true,
        sourceOnBattlefield: true,
        controllerHasPriority: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('tapped');
    });

    it('should fail if source not on battlefield', () => {
      const ability = createBasicLandManaAbility('island-1', 'Island', 'player1', ManaType.BLUE);
      
      const pool: ManaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = activateManaAbility(ability, pool, {
        sourceTapped: false,
        sourceOnBattlefield: false,
        controllerHasPriority: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('battlefield');
    });

    it('should add multiple mana correctly', () => {
      const ability: ManaAbility = {
        id: 'gilded-lotus',
        sourceId: 'artifact-1',
        sourceName: 'Gilded Lotus',
        controllerId: 'player1',
        type: 'activated',
        requiresTap: true,
        produces: [
          { type: ManaType.BLUE, amount: 3 },
        ],
      };
      
      const pool: ManaPool = {
        white: 0,
        blue: 1,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = activateManaAbility(ability, pool, {
        sourceTapped: false,
        sourceOnBattlefield: true,
        controllerHasPriority: true,
      });

      expect(result.success).toBe(true);
      expect(result.manaPoolAfter?.blue).toBe(4); // 1 + 3
    });
  });

  describe('canActivateManaAbility', () => {
    const ability = createBasicLandManaAbility('mountain-1', 'Mountain', 'player1', ManaType.RED);

    it('should allow activation with priority', () => {
      const result = canActivateManaAbility(ability, {
        hasPriority: true,
        isPayingCost: false,
        sourceTapped: false,
      });

      expect(result.canActivate).toBe(true);
    });

    it('should allow activation when paying cost (even without priority)', () => {
      const result = canActivateManaAbility(ability, {
        hasPriority: false,
        isPayingCost: true,
        sourceTapped: false,
      });

      expect(result.canActivate).toBe(true);
    });

    it('should reject if no priority and not paying cost', () => {
      const result = canActivateManaAbility(ability, {
        hasPriority: false,
        isPayingCost: false,
        sourceTapped: false,
      });

      expect(result.canActivate).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should reject if source tapped', () => {
      const result = canActivateManaAbility(ability, {
        hasPriority: true,
        isPayingCost: false,
        sourceTapped: true,
      });

      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('tapped');
    });
  });

  describe('tapPermanentForMana', () => {
    it('should tap permanent and add mana', () => {
      const context: TapForManaContext = {
        permanentId: 'swamp-1',
        permanentName: 'Swamp',
        controllerId: 'player1',
        manaToAdd: [{ type: ManaType.BLACK, amount: 1 }],
        currentlyTapped: false,
      };

      const pool: ManaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = tapPermanentForMana(context, pool);

      expect(result.success).toBe(true);
      expect(result.manaPoolAfter?.black).toBe(1);
    });

    it('should fail if already tapped', () => {
      const context: TapForManaContext = {
        permanentId: 'land-1',
        permanentName: 'Sol Ring',
        controllerId: 'player1',
        manaToAdd: [{ type: ManaType.COLORLESS, amount: 2 }],
        currentlyTapped: true,
      };

      const pool: ManaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      const result = tapPermanentForMana(context, pool);

      expect(result.success).toBe(false);
      expect(result.error).toContain('tapped');
    });
  });

  describe('BASIC_LAND_ABILITIES', () => {
    it('should create plains ability', () => {
      const ability = BASIC_LAND_ABILITIES.plains('plains-1', 'player1');
      
      expect(ability.requiresTap).toBe(true);
      expect(ability.produces).toHaveLength(1);
      expect(ability.produces[0].type).toBe(ManaType.WHITE);
      expect(ability.produces[0].amount).toBe(1);
    });

    it('should create island ability', () => {
      const ability = BASIC_LAND_ABILITIES.island('island-1', 'player1');
      
      expect(ability.produces[0].type).toBe(ManaType.BLUE);
    });

    it('should create swamp ability', () => {
      const ability = BASIC_LAND_ABILITIES.swamp('swamp-1', 'player1');
      
      expect(ability.produces[0].type).toBe(ManaType.BLACK);
    });

    it('should create mountain ability', () => {
      const ability = BASIC_LAND_ABILITIES.mountain('mountain-1', 'player1');
      
      expect(ability.produces[0].type).toBe(ManaType.RED);
    });

    it('should create forest ability', () => {
      const ability = BASIC_LAND_ABILITIES.forest('forest-1', 'player1');
      
      expect(ability.produces[0].type).toBe(ManaType.GREEN);
    });
  });

  describe('emptyManaPool', () => {
    it('should return empty pool', () => {
      const pool = emptyManaPool();

      expect(pool.white).toBe(0);
      expect(pool.blue).toBe(0);
      expect(pool.black).toBe(0);
      expect(pool.red).toBe(0);
      expect(pool.green).toBe(0);
      expect(pool.colorless).toBe(0);
    });
  });
});
