import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { evaluateInterveningIfClauseDetailed } from '../src/state/modules/triggers/intervening-if';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if: type entered under your control this turn', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue('t_intervening_if_etb_type');
  });

  it('makes artifact/planeswalker ETB clauses decidable via per-turn tracking', () => {
    const g = createInitialGameState('t_intervening_if_etb_type');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const artifactClause = 'if an artifact entered the battlefield under your control this turn';
    const pwClause = 'if a planeswalker entered the battlefield under your control this turn';

    // Initially: deterministically false.
    const a0 = evaluateInterveningIfClauseDetailed(g as any, String(p1), artifactClause);
    expect(a0.matched).toBe(true);
    expect(a0.value).toBe(false);

    const p0 = evaluateInterveningIfClauseDetailed(g as any, String(p1), pwClause);
    expect(p0.matched).toBe(true);
    expect(p0.value).toBe(false);

    // Artifact enters.
    const artifactPerm: any = {
      id: 'art_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'art_card_1',
        name: 'Test Artifact',
        type_line: 'Artifact',
      },
    };
    (g.state as any).battlefield.push(artifactPerm);
    triggerETBEffectsForPermanent(g as any, artifactPerm, p1);

    const a1 = evaluateInterveningIfClauseDetailed(g as any, String(p1), artifactClause);
    expect(a1.matched).toBe(true);
    expect(a1.value).toBe(true);

    // Planeswalker enters.
    const pwPerm: any = {
      id: 'pw_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'pw_card_1',
        name: 'Test Planeswalker',
        type_line: 'Legendary Planeswalker — Test',
        loyalty: '3',
      },
      counters: { loyalty: 3 },
    };
    (g.state as any).battlefield.push(pwPerm);
    triggerETBEffectsForPermanent(g as any, pwPerm, p1);

    const p1res = evaluateInterveningIfClauseDetailed(g as any, String(p1), pwClause);
    expect(p1res.matched).toBe(true);
    expect(p1res.value).toBe(true);

    // Next turn: both should reset to false.
    g.applyEvent({ type: 'nextTurn' });

    const a2 = evaluateInterveningIfClauseDetailed(g as any, String(p1), artifactClause);
    expect(a2.matched).toBe(true);
    expect(a2.value).toBe(false);

    const p2 = evaluateInterveningIfClauseDetailed(g as any, String(p1), pwClause);
    expect(p2.matched).toBe(true);
    expect(p2.value).toBe(false);
  });
});
