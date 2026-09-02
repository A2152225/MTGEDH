import { describe, expect, it } from 'vitest';
import type { GameContext } from '../src/state/context';
import { passPriority, tryAutoPass } from '../src/state/modules/priority.js';
import {
  reassignPriorityIfHolderCannotReceive,
  getActivePriorityPlayers,
} from '../src/state/modules/priorityEligibility.js';
import { checkPendingInteractions } from '../src/state/modules/turn-handlers/checkPendingInteractions.js';
import { computeNextStepPhaseAdvance } from '../src/state/modules/turn-handlers/turnStepPhaseAdvance.js';
import { repairMissingPriorityIfStuck } from '../src/socket/util-handlers/repairMissingPriorityIfStuck.js';

function createCtx(state: any): GameContext {
  return {
    gameId: 'eliminated_priority',
    state,
    inactive: new Set(),
    passesInRow: { value: 0 },
    bumpSeq: () => {},
  } as any;
}

function createEliminatedPriorityState(overrides: Record<string, unknown> = {}) {
  return {
    players: [
      { id: 'p_human', name: 'Human', seat: 0 },
      { id: 'p_dead_ai', name: 'Dead AI', seat: 1, isAI: true, hasLost: true },
      { id: 'p_alive_ai', name: 'Alive AI', seat: 2, isAI: true },
    ],
    turnDirection: 1,
    turnPlayer: 'p_human',
    priority: 'p_human',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield: [],
    zones: {
      p_human: { hand: [], handCount: 0 },
      p_dead_ai: {
        hand: [{
          id: 'counter_1',
          name: 'Counterspell',
          type_line: 'Instant',
          oracle_text: 'Counter target spell.',
          mana_cost: '{U}{U}',
        }],
        handCount: 1,
      },
      p_alive_ai: { hand: [], handCount: 0 },
    },
    manaPool: {
      p_human: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p_dead_ai: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 },
      p_alive_ai: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    priorityPassedBy: new Set<string>(),
    ...overrides,
  };
}

describe('eliminated players do not receive priority', () => {
  it('skips an eliminated AI when the turn player passes, even if they are not in inactive', () => {
    const state = createEliminatedPriorityState();
    const ctx = createCtx(state);

    expect(getActivePriorityPlayers(ctx).map((p) => p.id)).toEqual(['p_human', 'p_alive_ai']);

    const result = passPriority(ctx, 'p_human');
    expect(result.changed).toBe(true);
    expect(state.priority).toBe('p_alive_ai');
  });

  it('does not wait for an eliminated player before all living players have passed', () => {
    const state = createEliminatedPriorityState();
    const ctx = createCtx(state);

    passPriority(ctx, 'p_human');
    const second = passPriority(ctx, 'p_alive_ai');

    expect(second.changed).toBe(true);
    expect(second.advanceStep).toBe(true);
    expect(state.priority).toBe('p_human');
  });

  it('moves priority off an eliminated AI that currently holds it', () => {
    const state = createEliminatedPriorityState({ priority: 'p_dead_ai' });
    const ctx = createCtx(state);

    expect(reassignPriorityIfHolderCannotReceive(ctx)).toBe(true);
    expect(state.priority).toBe('p_alive_ai');
  });

  it('auto-pass does not stop on an eliminated AI that still has instants in hand', () => {
    const state = createEliminatedPriorityState({
      priority: 'p_dead_ai',
      autoPassPlayers: new Set(['p_human', 'p_dead_ai', 'p_alive_ai']),
    });
    const ctx = createCtx(state);

    tryAutoPass(ctx);
    expect(state.priority).not.toBe('p_dead_ai');
  });

  it('skips a player at 0 life even when hasLost is missing (replay)', () => {
    const state = createEliminatedPriorityState({
      priority: 'p_dead_ai',
      life: { p_human: 40, p_dead_ai: -589, p_alive_ai: 40 },
      players: [
        { id: 'p_human', name: 'Human', seat: 0 },
        { id: 'p_dead_ai', name: 'Dead AI', seat: 1, isAI: true },
        { id: 'p_alive_ai', name: 'Alive AI', seat: 2, isAI: true },
      ],
    });
    const ctx = createCtx(state);

    expect(getActivePriorityPlayers(ctx).map((p) => p.id)).toEqual(['p_human', 'p_alive_ai']);
    expect(reassignPriorityIfHolderCannotReceive(ctx)).toBe(true);
    expect(state.priority).toBe('p_alive_ai');

    state.priority = 'p_human';
    state.priorityPassedBy = new Set<string>();
    const result = passPriority(ctx, 'p_human');
    expect(result.changed).toBe(true);
    expect(state.priority).toBe('p_alive_ai');
  });

  it('repairs a broadcast stuck on an eliminated priority holder', () => {
    const state = createEliminatedPriorityState({ priority: 'p_dead_ai' });
    const game = { state, inactive: new Set(), bumpSeq: () => {} };

    const repaired = repairMissingPriorityIfStuck(game as any, 'eliminated_priority', '[test]');
    expect(repaired).toBe(true);
    expect(state.priority).toBe('p_alive_ai');
  });
});

describe('eliminated turn player during DECLARE_ATTACKERS', () => {
  it('does not wait for attacker declaration from a turn player who cannot receive priority', () => {
    const state = createEliminatedPriorityState({
      turnPlayer: 'p_dead_ai',
      priority: 'p_human',
      phase: 'combat',
      step: 'DECLARE_ATTACKERS',
      attackersDeclaredBy: [],
    });
    const ctx = createCtx(state);

    const pending = checkPendingInteractions(ctx);
    expect(pending.pendingTypes).not.toContain('attacker_declaration');
    expect(state.attackersDeclaredBy).toContain('p_dead_ai');
  });

  it('still waits for a living turn player to declare attackers', () => {
    const state = createEliminatedPriorityState({
      turnPlayer: 'p_human',
      priority: 'p_alive_ai',
      phase: 'combat',
      step: 'DECLARE_ATTACKERS',
      attackersDeclaredBy: [],
    });
    const ctx = createCtx(state);

    const pending = checkPendingInteractions(ctx);
    expect(pending.pendingTypes).toContain('attacker_declaration');
    expect(state.attackersDeclaredBy || []).not.toContain('p_human');
  });

  it('does not ping-pong priority when living players pass during the eliminated player\'s attack step', () => {
    const state = createEliminatedPriorityState({
      turnPlayer: 'p_dead_ai',
      priority: 'p_human',
      phase: 'combat',
      step: 'DECLARE_ATTACKERS',
      attackersDeclaredBy: [],
    });
    const ctx = createCtx(state);

    const first = passPriority(ctx, 'p_human', true);
    expect(state.attackersDeclaredBy).toContain('p_dead_ai');
    expect(state.priority).not.toBe('p_dead_ai');

    if (first.advanceStep) {
      expect(first.advanceStep).toBe(true);
      return;
    }

    expect(state.priority).toBe('p_alive_ai');
    const second = passPriority(ctx, 'p_alive_ai', true);
    expect(second.changed).toBe(true);
    expect(second.advanceStep).toBe(true);
    expect(state.priority).not.toBe('p_dead_ai');
  });

  it('auto-declares empty attackers when the turn player is only in inactive', () => {
    const state = createEliminatedPriorityState({
      turnPlayer: 'p_alive_ai',
      priority: 'p_human',
      phase: 'combat',
      step: 'DECLARE_ATTACKERS',
      attackersDeclaredBy: [],
    });
    const ctx = createCtx(state);
    ctx.inactive = new Set(['p_alive_ai']);

    const pending = checkPendingInteractions(ctx);
    expect(pending.pendingTypes).not.toContain('attacker_declaration');
    expect(state.attackersDeclaredBy).toContain('p_alive_ai');
  });

  it('skips extra combat when the active player cannot receive priority', () => {
    const state = createEliminatedPriorityState({
      turnPlayer: 'p_dead_ai',
      priority: 'p_human',
      phase: 'combat',
      step: 'END_COMBAT',
      extraCombats: [{ source: 'Aurelia, the Warleader', untapAttackers: true }],
    });
    const ctx = createCtx(state);

    const next = computeNextStepPhaseAdvance(ctx, 'combat', 'END_COMBAT', () => ({}));
    expect(next?.nextPhase).toBe('postcombatMain');
    expect(next?.nextStep).toBe('MAIN2');
    expect(state.extraCombats).toEqual([]);
  });
});
