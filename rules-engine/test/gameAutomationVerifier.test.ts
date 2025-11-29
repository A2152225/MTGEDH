/**
 * Test suite for GameAutomationVerifier
 * 
 * Verifies that all game processes are properly configured with the rules engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runFullAutomationVerification,
  getAutomationSummaryByCategory,
  validateGameStateForAutomation,
  AutomationStatus,
  verifyPhaseStepAutomation,
  verifyPriorityAutomation,
  verifyStateBasedActionsAutomation,
  verifyTriggeredAbilitiesAutomation,
  verifySpellCastingAutomation,
  verifyGameSetupAndWinConditions,
  verifySpecialRulesAutomation,
} from '../src/GameAutomationVerifier';
import type { GameState } from '../../shared/src';
import { GamePhase, GameStep } from '../src/actions/gamePhases';

describe('GameAutomationVerifier', () => {
  describe('runFullAutomationVerification', () => {
    it('should generate a complete verification report', () => {
      const report = runFullAutomationVerification();
      
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.totalChecks).toBeGreaterThan(0);
      expect(report.checks).toBeInstanceOf(Array);
      expect(report.recommendations).toBeInstanceOf(Array);
      
      // Verify status counts add up
      const totalStatuses = 
        report.implemented + 
        report.partial + 
        report.pending + 
        report.manualRequired + 
        report.needsFix;
      
      expect(totalStatuses).toBe(report.totalChecks);
    });

    it('should have mostly implemented features', () => {
      const report = runFullAutomationVerification();
      
      // Expect at least 60% of non-manual features to be implemented
      const automatable = report.totalChecks - report.manualRequired;
      const implemented = report.implemented + report.partial;
      const percentage = (implemented / automatable) * 100;
      
      expect(percentage).toBeGreaterThan(60);
    });

    it('should have recommendations', () => {
      const report = runFullAutomationVerification();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should include rules references for checks', () => {
      const report = runFullAutomationVerification();
      
      // At least 80% should have rules references
      const withRules = report.checks.filter(c => c.rulesReference);
      expect(withRules.length / report.checks.length).toBeGreaterThan(0.8);
    });
  });

  describe('verifyPhaseStepAutomation', () => {
    it('should verify all critical phase transitions are implemented', () => {
      const results = verifyPhaseStepAutomation();
      
      const critical = results.filter(r => r.priority === 'critical');
      const criticalImplemented = critical.filter(
        r => r.status === AutomationStatus.IMPLEMENTED || 
             r.status === AutomationStatus.MANUAL_REQUIRED ||
             r.status === AutomationStatus.PARTIAL  // Partial is acceptable for complex features
      );
      
      // All critical phase features should be implemented, partial, or require manual input
      expect(criticalImplemented.length).toBe(critical.length);
    });

    it('should include untap step automation', () => {
      const results = verifyPhaseStepAutomation();
      const untapCheck = results.find(r => r.feature === 'Untap Step Automation');
      
      expect(untapCheck).toBeDefined();
      expect(untapCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should include draw step automation', () => {
      const results = verifyPhaseStepAutomation();
      const drawCheck = results.find(r => r.feature === 'Draw Step Automation');
      
      expect(drawCheck).toBeDefined();
      expect(drawCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should mark attacker declaration as manual required', () => {
      const results = verifyPhaseStepAutomation();
      const attackerCheck = results.find(r => r.feature === 'Declare Attackers');
      
      expect(attackerCheck).toBeDefined();
      expect(attackerCheck?.status).toBe(AutomationStatus.MANUAL_REQUIRED);
    });

    it('should include cleanup step damage removal', () => {
      const results = verifyPhaseStepAutomation();
      const cleanupCheck = results.find(r => r.feature === 'Cleanup Step - Damage Removal');
      
      expect(cleanupCheck).toBeDefined();
      expect(cleanupCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });
  });

  describe('verifyPriorityAutomation', () => {
    it('should verify priority system is implemented', () => {
      const results = verifyPriorityAutomation();
      
      expect(results.length).toBeGreaterThan(0);
      
      // All priority features should be implemented
      const allImplemented = results.every(
        r => r.status === AutomationStatus.IMPLEMENTED
      );
      expect(allImplemented).toBe(true);
    });

    it('should include APNAP order verification', () => {
      const results = verifyPriorityAutomation();
      const apnapCheck = results.find(r => r.feature === 'APNAP Order');
      
      expect(apnapCheck).toBeDefined();
      expect(apnapCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
      expect(apnapCheck?.rulesReference).toBe('Rule 117.2');
    });
  });

  describe('verifyStateBasedActionsAutomation', () => {
    it('should verify all SBAs are implemented', () => {
      const results = verifyStateBasedActionsAutomation();
      
      expect(results.length).toBeGreaterThan(10);
      
      // Critical SBAs should all be implemented
      const criticalSBAs = results.filter(r => r.priority === 'critical');
      const criticalImplemented = criticalSBAs.filter(
        r => r.status === AutomationStatus.IMPLEMENTED
      );
      
      expect(criticalImplemented.length).toBe(criticalSBAs.length);
    });

    it('should include zero life loss', () => {
      const results = verifyStateBasedActionsAutomation();
      const lifeCheck = results.find(r => r.feature === 'Zero Life Loss');
      
      expect(lifeCheck).toBeDefined();
      expect(lifeCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
      expect(lifeCheck?.rulesReference).toBe('Rule 704.5a');
    });

    it('should include commander damage', () => {
      const results = verifyStateBasedActionsAutomation();
      const cmdDamage = results.find(r => r.feature === 'Commander Damage Loss');
      
      expect(cmdDamage).toBeDefined();
      expect(cmdDamage?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should include legend rule', () => {
      const results = verifyStateBasedActionsAutomation();
      const legendRule = results.find(r => r.feature === 'Legend Rule');
      
      expect(legendRule).toBeDefined();
      expect(legendRule?.status).toBe(AutomationStatus.IMPLEMENTED);
      expect(legendRule?.rulesReference).toBe('Rule 704.5j');
    });
  });

  describe('verifyTriggeredAbilitiesAutomation', () => {
    it('should verify triggered ability handling', () => {
      const results = verifyTriggeredAbilitiesAutomation();
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should include ETB trigger handling', () => {
      const results = verifyTriggeredAbilitiesAutomation();
      const etbCheck = results.find(r => r.feature === 'ETB Triggers');
      
      expect(etbCheck).toBeDefined();
      expect(etbCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should include dies trigger handling', () => {
      const results = verifyTriggeredAbilitiesAutomation();
      const diesCheck = results.find(r => r.feature === 'Dies Triggers');
      
      expect(diesCheck).toBeDefined();
      expect(diesCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should mark may abilities as requiring manual input', () => {
      const results = verifyTriggeredAbilitiesAutomation();
      const mayCheck = results.find(r => r.feature === 'May Ability Resolution');
      
      expect(mayCheck).toBeDefined();
      expect(mayCheck?.status).toBe(AutomationStatus.MANUAL_REQUIRED);
    });
  });

  describe('verifySpellCastingAutomation', () => {
    it('should verify spell casting rules', () => {
      const results = verifySpellCastingAutomation();
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should include sorcery timing restriction', () => {
      const results = verifySpellCastingAutomation();
      const sorceryCheck = results.find(r => r.feature === 'Sorcery Timing Restriction');
      
      expect(sorceryCheck).toBeDefined();
      expect(sorceryCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should include mana cost payment', () => {
      const results = verifySpellCastingAutomation();
      const manaCheck = results.find(r => r.feature === 'Mana Cost Payment');
      
      expect(manaCheck).toBeDefined();
      expect(manaCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should mark target selection as manual required', () => {
      const results = verifySpellCastingAutomation();
      const targetCheck = results.find(r => r.feature === 'Target Selection');
      
      expect(targetCheck).toBeDefined();
      expect(targetCheck?.status).toBe(AutomationStatus.MANUAL_REQUIRED);
    });
  });

  describe('verifyGameSetupAndWinConditions', () => {
    it('should verify game setup is automated', () => {
      const results = verifyGameSetupAndWinConditions();
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should include initial hand draw', () => {
      const results = verifyGameSetupAndWinConditions();
      const handDraw = results.find(r => r.feature === 'Initial Hand Draw');
      
      expect(handDraw).toBeDefined();
      expect(handDraw?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should include mulligan process', () => {
      const results = verifyGameSetupAndWinConditions();
      const mulligan = results.find(r => r.feature === 'Mulligan Process');
      
      expect(mulligan).toBeDefined();
      expect(mulligan?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should include last player standing win', () => {
      const results = verifyGameSetupAndWinConditions();
      const winCheck = results.find(r => r.feature === 'Last Player Standing');
      
      expect(winCheck).toBeDefined();
      expect(winCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });
  });

  describe('verifySpecialRulesAutomation', () => {
    it('should verify special rules handling', () => {
      const results = verifySpecialRulesAutomation();
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should include casting restrictions', () => {
      const results = verifySpecialRulesAutomation();
      const castingRestrictions = results.find(
        r => r.feature === 'Casting Restrictions (Silence, etc.)'
      );
      
      expect(castingRestrictions).toBeDefined();
      expect(castingRestrictions?.status).toBe(AutomationStatus.IMPLEMENTED);
    });

    it('should include token creation', () => {
      const results = verifySpecialRulesAutomation();
      const tokenCheck = results.find(r => r.feature === 'Token Creation');
      
      expect(tokenCheck).toBeDefined();
      expect(tokenCheck?.status).toBe(AutomationStatus.IMPLEMENTED);
    });
  });

  describe('getAutomationSummaryByCategory', () => {
    it('should group checks by category', () => {
      const summary = getAutomationSummaryByCategory();
      
      expect(summary.size).toBeGreaterThan(0);
      expect(summary.has('Phase Transitions')).toBe(true);
      expect(summary.has('Priority System')).toBe(true);
      expect(summary.has('State-Based Actions')).toBe(true);
    });

    it('should have accurate counts per category', () => {
      const summary = getAutomationSummaryByCategory();
      
      for (const [category, counts] of Array.from(summary.entries())) {
        const sum = 
          counts.implemented + 
          counts.partial + 
          counts.pending + 
          counts.manualRequired;
        
        expect(sum).toBe(counts.total);
      }
    });
  });

  describe('validateGameStateForAutomation', () => {
    it('should validate a properly configured game state', () => {
      const validState: GameState = {
        id: 'test-game',
        format: 'commander',
        players: [
          {
            id: 'player1',
            name: 'Alice',
            life: 40,
            library: [],
            hand: [],
            graveyard: [],
            battlefield: [],
            exile: [],
            commandZone: [],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
        ],
        phase: GamePhase.PRECOMBAT_MAIN,
        step: GameStep.MAIN1,
        activePlayerIndex: 0,
        turn: 1,
        stack: [],
        battlefield: [],
        turnOrder: ['player1'],
        startingLife: 40,
        life: { player1: 40 },
        commandZone: {},
      } as any;

      const result = validateGameStateForAutomation(validState);
      
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const invalidState = {
        id: 'test-game',
        players: [],
      } as unknown as GameState;

      const result = validateGameStateForAutomation(invalidState);
      
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues).toContain('Missing phase field - required for turn structure');
    });

    it('should warn about missing player fields', () => {
      const stateWithIncompletePlayer: GameState = {
        id: 'test-game',
        format: 'commander',
        players: [
          {
            id: 'player1',
            name: 'Alice',
            // Missing life, library, hand, manaPool
          } as any,
        ],
        phase: GamePhase.PRECOMBAT_MAIN,
        step: GameStep.MAIN1,
        activePlayerIndex: 0,
        stack: [],
        battlefield: [],
      } as any;

      const result = validateGameStateForAutomation(stateWithIncompletePlayer);
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('missing life'))).toBe(true);
    });
  });

  describe('Integration with Rules Engine', () => {
    it('should reference implemented modules correctly', () => {
      const report = runFullAutomationVerification();
      
      // All checks with 'IMPLEMENTED' status should have details
      const implementedChecks = report.checks.filter(
        c => c.status === AutomationStatus.IMPLEMENTED
      );
      
      for (const check of implementedChecks) {
        expect(check.details).toBeDefined();
        expect(check.details!.length).toBeGreaterThan(0);
      }
    });

    it('should categorize priority levels correctly', () => {
      const report = runFullAutomationVerification();
      
      const priorities = new Set(report.checks.map(c => c.priority));
      expect(priorities).toContain('critical');
      expect(priorities).toContain('high');
      expect(priorities).toContain('medium');
    });
  });
});

describe('Full Game Flow Verification', () => {
  it('should have all critical automation for a complete game', () => {
    const report = runFullAutomationVerification();
    
    const criticalChecks = report.checks.filter(c => c.priority === 'critical');
    const criticalNotDone = criticalChecks.filter(
      c => c.status === AutomationStatus.PENDING || c.status === AutomationStatus.NEEDS_FIX
    );
    
    // No critical features should be pending or broken
    expect(criticalNotDone).toHaveLength(0);
  });

  it('should have automation coverage above threshold', () => {
    const report = runFullAutomationVerification();
    
    // Calculate actual automation coverage
    const automatable = report.totalChecks - report.manualRequired;
    const automated = report.implemented + report.partial;
    const coveragePercent = (automated / automatable) * 100;
    
    // Should have at least 80% automation coverage
    expect(coveragePercent).toBeGreaterThanOrEqual(80);
  });

  it('should cover all game phases from draw to win', () => {
    const phaseChecks = verifyPhaseStepAutomation();
    
    // Verify we have checks for all major phases
    const categories = new Set(phaseChecks.map(c => c.category));
    expect(categories).toContain('Phase Transitions');
    expect(categories).toContain('Combat Phase');
    
    // Verify untap through cleanup is covered
    const phaseFeatures = phaseChecks.map(c => c.feature);
    expect(phaseFeatures.some(f => f.includes('Untap'))).toBe(true);
    expect(phaseFeatures.some(f => f.includes('Draw'))).toBe(true);
    expect(phaseFeatures.some(f => f.includes('Main'))).toBe(true);
    expect(phaseFeatures.some(f => f.includes('Combat'))).toBe(true);
    expect(phaseFeatures.some(f => f.includes('Cleanup'))).toBe(true);
  });
});
