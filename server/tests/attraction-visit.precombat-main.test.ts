import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import {
  extractVisitAbilityEffect,
  processAttractionVisitRollAtPrecombatMain,
} from '../src/state/modules/triggers/attraction-visit.js';

describe('Attraction visit roll at precombat main', () => {
  it('extracts visit ability text after Visit header', () => {
    const oracle =
      'Visit \u2014 Create a 1/1 white Mouse creature token.\n' +
      'Prize \u2014 Draw a card.';

    expect(extractVisitAbilityEffect(oracle)).toMatch(/create a 1\/1 white mouse creature token/i);
    expect(extractVisitAbilityEffect(oracle)).not.toMatch(/prize/i);
  });

  it('queues visit triggers when roll matches lit-up numbers', () => {
    const g = createInitialGameState('attraction_visit_roll');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.seedRng(4);

    (g.state as any).battlefield = [
      {
        id: 'attraction_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Test Attraction',
          type_line: 'Artifact — Attraction',
          litUpNumbers: [3, 4, 5],
          visitAbility: 'Create a 1/1 white Mouse creature token.',
          oracle_text: 'Visit \u2014 Create a 1/1 white Mouse creature token.',
        },
      },
    ];

    const result = processAttractionVisitRollAtPrecombatMain(g as any, p1);
    expect(result).toBeTruthy();
    expect(result?.roll).toBeGreaterThanOrEqual(1);
    expect(result?.roll).toBeLessThanOrEqual(6);

    const visitTriggers = ((g.state as any).stack || []).filter(
      (item: any) => item?.triggerType === 'attraction_visit',
    );

    if (result?.roll && [3, 4, 5].includes(result.roll)) {
      expect(visitTriggers).toHaveLength(1);
      expect(String(visitTriggers[0]?.effect || '')).toMatch(/create a 1\/1 white mouse creature token/i);
    } else {
      expect(visitTriggers).toHaveLength(0);
    }
  });

  it('runs visit roll at MAIN1 when no sagas are present', () => {
    const g = createInitialGameState('attraction_main1');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.seedRng(2);

    (g.state as any).turnPlayer = p1;
    (g.state as any).activePlayer = p1;
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'DRAW';
    (g.state as any).battlefield = [
      {
        id: 'attraction_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Test Attraction',
          type_line: 'Artifact — Attraction',
          litUpNumbers: [2],
          visitAbility: 'Draw a card.',
        },
      },
    ];

    g.applyEvent({ type: 'nextStep' });

    expect((g.state as any).lastDieRoll?.result).toBeGreaterThanOrEqual(1);
  });
});
