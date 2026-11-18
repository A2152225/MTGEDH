import { describe, expect, it } from 'vitest';

import { enumerateAIActionCandidates } from '../src/socket/ai-handlers/aiActionCandidateHandlers.js';
import {
  freePlanarDieRollCandidate,
  tryAIFreePlanarDieRoll,
} from '../src/socket/ai-handlers/aiPlanarDieRoll.js';

/** The AI rolls the planar die once per turn, in main phase 1, and only while the roll is free. */

function state(overrides: Record<string, unknown> = {}) {
  return {
    houseRules: { enablePlanechase: true },
    turnPlayer: 'p1',
    step: 'MAIN1',
    phase: 'precombatMain',
    stack: [],
    priority: 'p1',
    players: [{ id: 'p1', name: 'Ada' }],
    currentPlane: { id: 'plane-1', name: 'Plane 1', type_line: 'Plane — Test', oracle_text: '' },
    planarDeckFaceDown: [{ id: 'plane-2', name: 'Plane 2', type_line: 'Plane — Test', oracle_text: '' }],
    manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
    ...overrides,
  };
}

describe('AI planar die candidate', () => {
  it('offers the free roll only in main phase 1', () => {
    expect(freePlanarDieRollCandidate(state(), 'p1')).toMatchObject({ kind: 'roll_planar_die' });
    expect(freePlanarDieRollCandidate(state({ step: 'MAIN2' }), 'p1')).toBeNull();
    expect(freePlanarDieRollCandidate(state({ houseRules: {} }), 'p1')).toBeNull();
    expect(freePlanarDieRollCandidate(state({ planarDieSpecialActionsThisTurn: { p1: 1 } }), 'p1')).toBeNull();
  });

  it('is enumerated for a main-phase action list and not while responding', async () => {
    const game = { state: state() };
    const main = await enumerateAIActionCandidates(game as any, 'p1' as any, {
      mode: 'main',
      kinds: ['roll_planar_die'],
    });
    expect(main.map((candidate) => candidate.kind)).toEqual(['roll_planar_die']);

    const response = await enumerateAIActionCandidates(game as any, 'p1' as any, {
      mode: 'response',
      kinds: ['roll_planar_die'],
    });
    expect(response.map((candidate) => candidate.kind)).not.toContain('roll_planar_die');
  });

  it('rolls once for free and will not pay for a second roll', async () => {
    const game = { state: state(), bumpSeq() {} };
    const chats: string[] = [];
    const io = {
      to: () => ({ emit: (_event: string, payload: any) => chats.push(payload.message) }),
    };

    const rolled = await tryAIFreePlanarDieRoll(io as any, game, '', 'p1' as any, { face: 'blank' });
    expect(rolled).toBe(true);
    expect(game.state.planarDieSpecialActionsThisTurn).toEqual({ p1: 1 });
    expect(chats[0]).toMatch(/^Ada rolled the planar die: a blank face\.$/);

    const again = await tryAIFreePlanarDieRoll(io as any, game, '', 'p1' as any, { face: 'blank' });
    expect(again).toBe(false);
    expect(game.state.planarDieSpecialActionsThisTurn).toEqual({ p1: 1 });
  });
});
