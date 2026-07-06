import { describe, expect, it } from 'vitest';

import { parseTargetRequirements } from '../src/rules-engine/targeting.js';
import { validatePerOpponentTargetSelections } from '../src/socket/perOpponentTargetValidation.js';

const LUMINATE_TEXT =
  'For each opponent, exile up to one target creature that player controls and that player gains life equal to its power.';

describe('per-opponent target selection', () => {
  it('parses Luminate Primordial as per-opponent up-to-one creature targeting', () => {
    const reqs = parseTargetRequirements(LUMINATE_TEXT);
    expect(reqs?.perOpponent).toBe(true);
    expect(reqs?.minTargets).toBe(0);
    expect(reqs?.maxTargets).toBe(1);
    expect(reqs?.targetTypes).toContain('creature');
  });

  it('accepts at most one target per opponent controller', () => {
    const error = validatePerOpponentTargetSelections({
      selections: ['c1', 'c2'],
      validTargets: [
        { id: 'c1', controller: 'p_opp1' },
        { id: 'c2', controller: 'p_opp2' },
        { id: 'c3', controller: 'p_opp1' },
      ],
      targetsPerOpponent: {
        p_opp1: [{ id: 'c1' }, { id: 'c3' }],
        p_opp2: [{ id: 'c2' }],
      },
      minTargetsPerOpponent: 0,
      maxTargetsPerOpponent: 1,
    });
    expect(error).toBeNull();
  });

  it('rejects two targets for the same opponent', () => {
    const error = validatePerOpponentTargetSelections({
      selections: ['c1', 'c3'],
      validTargets: [
        { id: 'c1', controller: 'p_opp1' },
        { id: 'c3', controller: 'p_opp1' },
      ],
      targetsPerOpponent: {
        p_opp1: [{ id: 'c1' }, { id: 'c3' }],
      },
      minTargetsPerOpponent: 0,
      maxTargetsPerOpponent: 1,
    });
    expect(error).toMatch(/too many targets/i);
  });

  it('allows zero selections per opponent when min is zero', () => {
    const error = validatePerOpponentTargetSelections({
      selections: [],
      validTargets: [{ id: 'c1', controller: 'p_opp1' }],
      targetsPerOpponent: {
        p_opp1: [{ id: 'c1' }],
      },
      minTargetsPerOpponent: 0,
      maxTargetsPerOpponent: 1,
    });
    expect(error).toBeNull();
  });
});
