import { describe, expect, it } from 'vitest';

import {
  countSemanticActions,
  listUndoTurnPhaseTargets,
} from '../src/socket/undo.js';

describe('undo semantic action counting', () => {
  it('collapses oracle IR mutation tails into a single parent action', () => {
    const events = [
      { type: 'pushTriggeredAbility' },
      { type: 'resolveTopOfStackPrompt' },
      { type: 'assignTriggeredAbilityTargets', payload: { targets: ['bear_1'] } },
      { type: 'resolveTopOfStack' },
      { type: 'goadPermanent', payload: { oracleIrReplayMutation: true } },
      { type: 'battlefieldPermanentPatch', payload: { oracleIrReplayMutation: true } },
    ];

    expect(countSemanticActions(events)).toBe(2);
  });

  it('counts standalone gameplay events normally', () => {
    const events = [
      { type: 'passPriority' },
      { type: 'castSpell' },
      { type: 'resolveTopOfStack' },
      { type: 'drawCards', payload: { oracleIrReplayMutation: true } },
    ];

    expect(countSemanticActions(events)).toBe(3);
  });
});

describe('undo turn/phase targets and alias-stable chunk counts', () => {
  it('lists earlier phase targets with eventsToUndo from chunk starts', () => {
    const events = [
      { type: 'join', turnNumber: undefined, phase: 'pre_game', step: 'PRE_GAME' },
      { type: 'join', turnNumber: undefined, phase: 'pre_game', step: 'PRE_GAME' },
      { type: 'skipToPhase', turnNumber: 1, phase: 'precombatMain', step: 'MAIN1' },
      { type: 'playLand', turnNumber: 1, phase: 'precombatMain', step: 'MAIN1' },
      { type: 'nextStep', turnNumber: 1, phase: 'combat', step: 'BEGIN_COMBAT' },
      { type: 'passPriority', turnNumber: 1, phase: 'combat', step: 'BEGIN_COMBAT' },
      { type: 'nextStep', turnNumber: 1, phase: 'combat', step: 'DECLARE_ATTACKERS' },
      { type: 'declareAttackers', turnNumber: 1, phase: 'combat', step: 'DECLARE_ATTACKERS' },
    ];
    const game = {
      state: {
        turnNumber: 1,
        phase: 'combat',
        step: 'DECLARE_ATTACKERS',
      },
    };

    const targets = listUndoTurnPhaseTargets(game, events as any, { limit: 20 });
    expect(targets.length).toBeGreaterThanOrEqual(2);
    // Most recent earlier phase should be precombatMain (skip current combat).
    expect(targets[0].phase).toMatch(/precombatMain/i);
    // history phases: pre_game, precombatMain, combat
    // current = combat (starts at index 4), previous = precombatMain (starts at index 2)
    // eventsToUndo to return to precombatMain start = 8 - 2 = 6
    expect(targets[0].eventsToUndo).toBe(6);
    expect(targets[0].turnNumber).toBe(1);
  });

  it('treats beginCombat and BEGIN_COMBAT as the same step chunk after restart-like alias mismatch', () => {
    // Stamps used camelCase; live state after restore uses server UPPER_SNAKE.
    const events = [
      { type: 'a', turnNumber: 1, phase: 'combat', step: 'beginCombat' },
      { type: 'b', turnNumber: 1, phase: 'combat', step: 'beginCombat' },
      { type: 'c', turnNumber: 1, phase: 'combat', step: 'declareAttackers' },
      { type: 'd', turnNumber: 1, phase: 'combat', step: 'declareAttackers' },
      { type: 'e', turnNumber: 1, phase: 'combat', step: 'declareAttackers' },
    ];
    const game = {
      state: {
        turnNumber: 1,
        phase: 'combat',
        step: 'DECLARE_ATTACKERS',
      },
    };

    const targets = listUndoTurnPhaseTargets(game, events as any, { includeSteps: true, limit: 10 });
    // Current step = DECLARE_ATTACKERS (3 events). Earlier step = beginCombat.
    expect(targets[0].step?.toLowerCase()).toMatch(/begin/);
  });

  it('keeps separate entry indices when the same phase is revisited (extra combat)', () => {
    const events = [
      { type: 'm1', turnNumber: 1, phase: 'precombatMain', step: 'MAIN1' },
      { type: 'c1', turnNumber: 1, phase: 'combat', step: 'BEGIN_COMBAT' },
      { type: 'c1b', turnNumber: 1, phase: 'combat', step: 'END_COMBAT' },
      { type: 'm2', turnNumber: 1, phase: 'postcombatMain', step: 'MAIN2' },
      { type: 'c2', turnNumber: 1, phase: 'combat', step: 'BEGIN_COMBAT' },
      { type: 'c2b', turnNumber: 1, phase: 'combat', step: 'DECLARE_ATTACKERS' },
    ];
    const game = {
      state: { turnNumber: 1, phase: 'combat', step: 'DECLARE_ATTACKERS' },
    };

    const targets = listUndoTurnPhaseTargets(game, events as any, { limit: 10 });
    // Previous phase segment is postcombatMain (index 3), not the first combat.
    expect(targets[0].phase).toMatch(/postcombatMain/i);
    expect(targets[0].eventsToUndo).toBe(3); // 6 - 3
    // Jumping to first combat should use first combat entry (index 1) => undo 5
    const firstCombat = targets.find((t) => /combat/i.test(t.phase) && t.eventsToUndo === 5);
    expect(firstCombat).toBeTruthy();
  });
});
