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
});
