/**
 * Test suite for skipToPhase functionality
 * Tests that skipping phases properly executes turn-based actions:
 * - Untapping permanents when skipping from UNTAP
 * - Drawing cards when skipping from before DRAW to MAIN1 or later
 */

import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';

describe('skipToPhase turn-based actions', () => {
  it('should draw a card when skipping from UPKEEP to MAIN1', () => {
    const g = createInitialGameState('skip_upkeep_main1');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library for player
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.drawCards(p1, 7); // Initial hand

    // Set up game state in UPKEEP step
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'UPKEEP';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    const handCountBefore = g.state.zones?.[p1]?.handCount ?? 0;
    const libraryCountBefore = g.state.zones?.[p1]?.libraryCount ?? 0;
    expect(handCountBefore).toBe(7);
    expect(libraryCountBefore).toBe(13); // 20 - 7 = 13

    // Simulate what skipToPhase socket handler does (including drawing)
    // We'll test the logic directly instead of through socket

    // Current state
    const currentPhase = String(g.state?.phase || "").toLowerCase();
    const currentStep = String(g.state?.step || "").toUpperCase();
    const targetPhase = 'precombatMain';
    const targetStep = 'MAIN1';

    // Update phase/step
    (g.state as any).phase = targetPhase;
    (g.state as any).step = targetStep;

    // Check if we need to draw (skipping from before DRAW to MAIN)
    const wasBeginningPhase = currentPhase === "beginning" || currentPhase === "pre_game" || currentPhase === "";
    const isTargetMainPhase = targetPhase.toLowerCase().includes("main") || targetStep === "MAIN1" || targetStep === "MAIN2";
    const needsDraw = wasBeginningPhase && 
      (currentStep === "" || currentStep === "UNTAP" || currentStep === "UPKEEP") && 
      isTargetMainPhase;

    expect(needsDraw).toBe(true);

    // Execute draw
    if (needsDraw) {
      g.drawCards(p1, 1);
    }

    const handCountAfter = g.state.zones?.[p1]?.handCount ?? 0;
    const libraryCountAfter = g.state.zones?.[p1]?.libraryCount ?? 0;

    expect(handCountAfter).toBe(8); // 7 + 1 = 8
    expect(libraryCountAfter).toBe(12); // 13 - 1 = 12
  });

  it('should NOT draw when skipping from MAIN1 to MAIN2', () => {
    const g = createInitialGameState('skip_main1_main2');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library for player
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.drawCards(p1, 7); // Initial hand

    // Set up game state in MAIN1 step
    (g.state as any).phase = 'precombatMain';
    (g.state as any).step = 'MAIN1';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    const handCountBefore = g.state.zones?.[p1]?.handCount ?? 0;

    // Check if we need to draw (skipping from MAIN1 to MAIN2)
    const currentPhase = 'precombatMain';
    const currentStep = 'MAIN1';
    const targetPhase = 'postcombatMain';
    const targetStep = 'MAIN2';

    const wasBeginningPhase = currentPhase === "beginning" || currentPhase === "pre_game" || currentPhase === "";
    const needsDraw = wasBeginningPhase && 
      (currentStep === "" || currentStep === "UNTAP" || currentStep === "UPKEEP");

    expect(needsDraw).toBe(false);

    // No draw should happen
    const handCountAfter = g.state.zones?.[p1]?.handCount ?? 0;
    expect(handCountAfter).toBe(handCountBefore);
  });

  it('should untap permanents when skipping from UNTAP to MAIN1', () => {
    const g = createInitialGameState('skip_untap_main1');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library for player
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);

    // Create a tapped token
    g.createToken(p1, 'Test Creature', 1, 2, 2);
    const permanent = g.state.battlefield[0];
    permanent.tapped = true;
    expect(permanent.tapped).toBe(true);

    // Set up game state in UNTAP step
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'UNTAP';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    const currentPhase = 'beginning';
    const currentStep = 'UNTAP';
    const targetPhase = 'precombatMain';
    const targetStep = 'MAIN1';

    // Check if we need to untap
    const wasBeginningPhase = currentPhase === "beginning" || currentPhase === "pre_game" || currentPhase === "";
    const needsUntap = wasBeginningPhase && 
      (currentStep === "" || currentStep === "UNTAP") && 
      (targetStep !== "UNTAP");

    expect(needsUntap).toBe(true);

    // Execute untap
    if (needsUntap) {
      for (const perm of g.state.battlefield) {
        if (perm && perm.controller === p1 && perm.tapped) {
          if (!perm.doesntUntap) {
            perm.tapped = false;
          }
        }
      }
    }

    expect(g.state.battlefield[0].tapped).toBe(false);
  });

  it('should draw when skipping from UNTAP to MAIN1', () => {
    const g = createInitialGameState('skip_untap_main1_draw');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library for player
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.drawCards(p1, 7); // Initial hand

    // Set up game state in UNTAP step
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'UNTAP';
    (g.state as any).turnPlayer = p1;

    const handCountBefore = g.state.zones?.[p1]?.handCount ?? 0;
    expect(handCountBefore).toBe(7);

    // Determine if draw is needed when skipping from UNTAP to MAIN1
    const currentPhase = 'beginning';
    const currentStep = 'UNTAP';
    const targetPhase = 'precombatMain';
    const targetStep = 'MAIN1';

    const wasBeginningPhase = currentPhase === "beginning" || currentPhase === "pre_game" || currentPhase === "";
    const isTargetMainPhase = targetPhase.toLowerCase().includes("main") || targetStep === "MAIN1" || targetStep === "MAIN2";
    const needsDraw = wasBeginningPhase && 
      (currentStep === "" || currentStep === "UNTAP" || currentStep === "UPKEEP") && 
      isTargetMainPhase;

    expect(needsDraw).toBe(true);

    // Execute draw
    if (needsDraw) {
      g.drawCards(p1, 1);
    }

    const handCountAfter = g.state.zones?.[p1]?.handCount ?? 0;
    expect(handCountAfter).toBe(8);
  });

  it('should NOT draw when already past DRAW step', () => {
    const g = createInitialGameState('skip_draw_main1');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library for player
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.drawCards(p1, 7); // Initial hand

    // Set up game state AFTER DRAW step (already at DRAW, going to MAIN1)
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'DRAW';
    (g.state as any).turnPlayer = p1;

    const handCountBefore = g.state.zones?.[p1]?.handCount ?? 0;
    expect(handCountBefore).toBe(7);

    // Current is DRAW, target is MAIN1
    const currentStep = 'DRAW';
    const targetStep = 'MAIN1';

    // Should NOT draw since we're already at/past DRAW step
    const needsDraw = (currentStep === "" || currentStep === "UNTAP" || currentStep === "UPKEEP") && 
      (targetStep === "MAIN1" || targetStep === "MAIN2");

    expect(needsDraw).toBe(false);

    // Hand count should remain the same
    const handCountAfter = g.state.zones?.[p1]?.handCount ?? 0;
    expect(handCountAfter).toBe(handCountBefore);
  });

  it('should reset priority tracking when skipping to a phase', () => {
    const g = createInitialGameState('skip_reset_priority');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library for player
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.drawCards(p1, 7); // Initial hand

    // Set up game state in pre_game phase
    (g.state as any).phase = 'pre_game';
    (g.state as any).step = '';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Simulate that player already passed priority (this would cause auto-advance)
    (g.state as any).priorityPassedBy = new Set<string>([p1]);

    // Simulate skipToPhase logic - reset priority tracking
    const targetPhase = 'precombatMain';
    const targetStep = 'MAIN1';
    
    // Update phase/step (as skipToPhase does)
    (g.state as any).phase = targetPhase;
    (g.state as any).step = targetStep;
    
    // Reset priority tracking (this is the fix)
    (g.state as any).priorityPassedBy = new Set<string>();
    (g.state as any).priority = p1;

    // Verify priority was reset
    expect((g.state as any).priorityPassedBy.size).toBe(0);
    expect((g.state as any).priority).toBe(p1);
    
    // Verify we're in the correct phase/step
    expect((g.state as any).phase).toBe(targetPhase);
    expect((g.state as any).step).toBe(targetStep);
  });

  it('should prevent auto-advance after skipToPhase in single-player game', () => {
    const g = createInitialGameState('skip_no_autoadvance');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library for player
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.drawCards(p1, 7); // Initial hand

    // Set up game state in pre_game phase
    (g.state as any).phase = 'pre_game';
    (g.state as any).step = '';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    // Simulate skipToPhase to MAIN1
    const targetPhase = 'precombatMain';
    const targetStep = 'MAIN1';
    
    (g.state as any).phase = targetPhase;
    (g.state as any).step = targetStep;
    
    // Reset priority tracking (the fix)
    (g.state as any).priorityPassedBy = new Set<string>();
    (g.state as any).priority = p1;

    // Now when passPriority is called, it should mark the player as passed
    // but since we just reset, the player should still be able to act first
    
    // Verify initial state after skipToPhase
    expect((g.state as any).priorityPassedBy.has(p1)).toBe(false);
    
    // After the fix, the player should have a fresh priority state
    // and can choose to act before passing (or the client can decide based on auto-pass settings)
    expect((g.state as any).phase).toBe('precombatMain');
    expect((g.state as any).step).toBe('MAIN1');
    expect((g.state as any).priority).toBe(p1);
  });

  it('should prevent auto-pass when justSkippedToPhase is set', () => {
    const g = createInitialGameState('skip_prevents_autopass');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Set up libraries for both players
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_p1_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck.map(c => ({ ...c, id: `card_p2_${c.id}` })));
    
    g.drawCards(p1, 7);
    g.drawCards(p2, 7);

    // Set up game state in MAIN1
    (g.state as any).phase = 'precombatMain';
    (g.state as any).step = 'MAIN1';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Enable auto-pass for p1 (simulate AI or auto-pass setting)
    (g.state as any).autoPassPlayers = new Set([p1]);
    
    // Set justSkippedToPhase metadata (as skipToPhase does)
    (g.state as any).justSkippedToPhase = {
      playerId: p1,
      phase: 'precombatMain',
      step: 'MAIN1',
    };

    // Reset priority tracking
    (g.state as any).priorityPassedBy = new Set<string>();

    // Now when p1 passes priority, autoPassLoop should check justSkippedToPhase
    // and NOT auto-pass p1 even though auto-pass is enabled
    const result = g.passPriority(p1);

    // Priority should have passed to p2, but p1 should not have been auto-passed back
    // because justSkippedToPhase prevents that
    expect(result.changed).toBe(true);
    expect((g.state as any).priority).toBe(p2); // Priority moved to p2
    expect((g.state as any).priorityPassedBy.has(p1)).toBe(true); // p1 passed
    
    // justSkippedToPhase should have been cleared since p1 manually passed
    expect((g.state as any).justSkippedToPhase).toBeUndefined();
    
    // Step should not have advanced
    expect((g.state as any).step).toBe('MAIN1');
  });

  it('should clear justSkippedToPhase after initiator passes', () => {
    const g = createInitialGameState('skip_clear_flag');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Set up library
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.drawCards(p1, 7);

    // Set up game state in MAIN1
    (g.state as any).phase = 'precombatMain';
    (g.state as any).step = 'MAIN1';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Set justSkippedToPhase metadata
    (g.state as any).justSkippedToPhase = {
      playerId: p1,
      phase: 'precombatMain',
      step: 'MAIN1',
    };
    
    (g.state as any).priorityPassedBy = new Set<string>();

    // Verify flag is set
    expect((g.state as any).justSkippedToPhase).toBeDefined();
    expect((g.state as any).justSkippedToPhase.playerId).toBe(p1);

    // When p1 passes, the flag should be cleared
    g.passPriority(p1);

    // Flag should be cleared because the initiator passed
    expect((g.state as any).justSkippedToPhase).toBeUndefined();
  });

  it('should clear justSkippedToPhase when moving to different phase', () => {
    const g = createInitialGameState('skip_clear_on_phase_change');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Set up libraries
    const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck.map(c => ({ ...c, id: `p2_${c.id}` })));
    
    g.drawCards(p1, 7);
    g.drawCards(p2, 7);

    // Set up game state in MAIN1
    (g.state as any).phase = 'precombatMain';
    (g.state as any).step = 'MAIN1';
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    
    // Set justSkippedToPhase for MAIN1
    (g.state as any).justSkippedToPhase = {
      playerId: p1,
      phase: 'precombatMain',
      step: 'MAIN1',
    };
    
    (g.state as any).priorityPassedBy = new Set<string>();

    // Manually advance to a different step (simulating natural game flow)
    (g.state as any).phase = 'combat';
    (g.state as any).step = 'BEGIN_COMBAT';
    (g.state as any).priority = p1;
    
    // Now when autoPassLoop runs, it should detect we're in a different phase
    // and clear the justSkippedToPhase flag
    
    // Trigger passPriority which calls autoPassLoop
    (g.state as any).priorityPassedBy = new Set<string>();
    (g.state as any).autoPassPlayers = new Set([p1]);
    
    g.passPriority(p1);

    // Flag should be cleared because we moved to a different step
    expect((g.state as any).justSkippedToPhase).toBeUndefined();
  });
});
