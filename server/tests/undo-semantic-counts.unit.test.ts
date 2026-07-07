import { describe, expect, it } from 'vitest';

import { countSemanticActions } from '../src/socket/undo.js';

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
