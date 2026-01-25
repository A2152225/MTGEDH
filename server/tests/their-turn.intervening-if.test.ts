import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { resolveTopOfStack } from '../src/state/modules/stack';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: "if it\'s not their turn"', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_their_turn_true');
    ResolutionQueueManager.removeQueue('t_intervening_if_their_turn_false');
  });

  it('resolves when active player != referenced "their" player', () => {
    const g = createInitialGameState('t_intervening_if_their_turn_true');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    // Active player is p1, but "their" refers to p2.
    (g.state as any).turnPlayer = p1;

    // Source permanent exists so refs can be attached during evaluation.
    (g.state as any).battlefield = (g.state as any).battlefield || [];
    (g.state as any).battlefield.push({
      id: 'src_1',
      controller: p1,
      owner: p1,
      card: { id: 'src_card', name: 'Source', type_line: 'Enchantment' },
      tapped: false,
    });

    // Triggered ability says: "At the beginning of upkeep, if it's not their turn, you gain 1 life."
    (g.state as any).stack = (g.state as any).stack || [];
    (g.state as any).stack.push({
      id: 'tr_1',
      type: 'triggered_ability',
      controller: p1,
      source: 'src_1',
      sourceName: 'Source',
      triggerType: 'upkeep',
      description: "if it's not their turn, you gain 1 life.",
      effect: "if it's not their turn, you gain 1 life.",
      triggeringPlayer: p2,
    });

    const p1LifeBefore = (g.state as any).players.find((p: any) => p.id === p1)?.life ?? 40;
    resolveTopOfStack(g as any);
    const p1LifeAfter = (g.state as any).players.find((p: any) => p.id === p1)?.life ?? 40;
    expect(p1LifeAfter).toBe(p1LifeBefore + 1);
  });

  it('fizzles when active player == referenced "their" player', () => {
    const g = createInitialGameState('t_intervening_if_their_turn_false');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    // Active player is p2, and "their" refers to p2.
    (g.state as any).turnPlayer = p2;

    (g.state as any).battlefield = (g.state as any).battlefield || [];
    (g.state as any).battlefield.push({
      id: 'src_1',
      controller: p1,
      owner: p1,
      card: { id: 'src_card', name: 'Source', type_line: 'Enchantment' },
      tapped: false,
    });

    (g.state as any).stack = (g.state as any).stack || [];
    (g.state as any).stack.push({
      id: 'tr_1',
      type: 'triggered_ability',
      controller: p1,
      source: 'src_1',
      sourceName: 'Source',
      triggerType: 'upkeep',
      description: "if it's not their turn, you gain 1 life.",
      effect: "if it's not their turn, you gain 1 life.",
      triggeringPlayer: p2,
    });

    const p1LifeBefore = (g.state as any).players.find((p: any) => p.id === p1)?.life ?? 40;
    resolveTopOfStack(g as any);
    const p1LifeAfter = (g.state as any).players.find((p: any) => p.id === p1)?.life ?? 40;
    expect(p1LifeAfter).toBe(p1LifeBefore);
  });
});
