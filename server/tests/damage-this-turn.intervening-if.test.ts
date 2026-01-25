import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { resolveTopOfStack } from '../src/state/modules/stack';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: damage dealt to it this turn', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_damage_this_turn');
  });

  it('tracks damageThisTurn and makes "if 4 or more damage was dealt to it this turn" decidable', () => {
    const g = createInitialGameState('t_intervening_if_damage_this_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    // Target permanent to receive damage.
    (g.state as any).battlefield.push({
      id: 'victim_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'victim_card',
        name: 'Victim Creature',
        type_line: 'Creature — Test',
        power: '1',
        toughness: '10',
      },
    } as any);

    const clause = 'if 4 or more damage was dealt to it this turn';

    // Deal 3 damage via a triggered ability effect.
    (g.state as any).stack = (g.state as any).stack || [];
    (g.state as any).stack.push({
      id: 'tr_1',
      type: 'triggered_ability',
      controller: p2,
      source: 'src_1',
      sourceName: 'Test Source',
      triggerType: 'spell',
      description: 'Test Source deals 3 damage to target.',
      targets: ['victim_1'],
    } as any);

    resolveTopOfStack(g as any);

    const victimAfter3 = (g.state as any).battlefield.find((p: any) => p?.id === 'victim_1');
    expect(victimAfter3?.damageThisTurn).toBe(3);

    const evalAfter3 = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, victimAfter3);
    expect(evalAfter3.matched).toBe(true);
    expect(evalAfter3.value).toBe(false);

    // Deal 1 more damage (total 4).
    (g.state as any).stack.push({
      id: 'tr_2',
      type: 'triggered_ability',
      controller: p2,
      source: 'src_1',
      sourceName: 'Test Source',
      triggerType: 'spell',
      description: 'Test Source deals 1 damage to target.',
      targets: ['victim_1'],
    } as any);

    resolveTopOfStack(g as any);

    const victimAfter4 = (g.state as any).battlefield.find((p: any) => p?.id === 'victim_1');
    expect(victimAfter4?.damageThisTurn).toBe(4);

    const evalAfter4 = evaluateInterveningIfClauseDetailed(g as any, String(p1), clause, victimAfter4);
    expect(evalAfter4.matched).toBe(true);
    expect(evalAfter4.value).toBe(true);

    // Next turn: damageThisTurn should reset.
    g.applyEvent({ type: 'nextTurn' });
    const victimNextTurn = (g.state as any).battlefield.find((p: any) => p?.id === 'victim_1');
    expect(victimNextTurn?.damageThisTurn).toBeUndefined();
  });
});
