import { describe, expect, it } from 'vitest';

import { parseTargetRequirements } from '../src/rules-engine/targeting.js';
import { buildGroupedSpellTargetMetadata, buildSpellTargetListFromRequirements } from '../src/socket/game-actions.js';
import { validateGroupedTargetSelections, validatePerOpponentTargetSelections } from '../src/socket/perOpponentTargetValidation.js';

const LUMINATE_TEXT =
  'For each opponent, exile up to one target creature that player controls and that player gains life equal to its power.';
const GUFF_TEXT =
  "For each player, choose target nonenchantment, nonland permanent that player controls. Those permanents' owners shuffle them into their libraries.";

describe('per-opponent target selection', () => {
  it('parses Luminate Primordial as per-opponent up-to-one creature targeting', () => {
    const reqs = parseTargetRequirements(LUMINATE_TEXT);
    expect(reqs?.perOpponent).toBe(true);
    expect(reqs?.minTargets).toBe(0);
    expect(reqs?.maxTargets).toBe(1);
    expect(reqs?.targetTypes).toContain('creature');
    expect(reqs?.groupedTargets).toMatchObject({
      groupPlayers: 'each_opponent',
      minTargetsPerGroup: 0,
      maxTargetsPerGroup: 1,
    });
  });

  it('parses Guff as required each-player targeting with land and enchantment exclusions', () => {
    const reqs = parseTargetRequirements(GUFF_TEXT);
    expect(reqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['permanent'],
      targetFilterExcludeTypes: ['enchantment', 'land'],
      groupedTargets: {
        groupBy: 'controller',
        groupPlayers: 'each_player',
        minTargetsPerGroup: 1,
        maxTargetsPerGroup: 1,
      },
    });
    expect(reqs?.perOpponent).toBeUndefined();
  });

  it('builds one required group for every active player, including the caster', () => {
    const reqs = parseTargetRequirements(GUFF_TEXT);
    const game = {
      state: {
        players: [
          { id: 'p1', name: 'Caster' },
          { id: 'p2', name: 'Second' },
          { id: 'p3', name: 'Third' },
          { id: 'judge', name: 'Judge', spectator: true },
        ],
        battlefield: [
          { id: 'a1', controller: 'p1', owner: 'p1', card: { name: 'Rock', type_line: 'Artifact' } },
          { id: 'land2', controller: 'p2', owner: 'p2', card: { name: 'Land', type_line: 'Land' } },
          { id: 'c2', controller: 'p2', owner: 'p2', card: { name: 'Bear', type_line: 'Creature' } },
          { id: 'e3', controller: 'p3', owner: 'p3', card: { name: 'Aura', type_line: 'Enchantment' } },
        ],
      },
    };
    const validTargets = buildSpellTargetListFromRequirements(game, 'p1', reqs);
    expect(validTargets.map((target) => target.id)).toEqual(['a1', 'c2']);

    const grouped = buildGroupedSpellTargetMetadata(game, 'p1', reqs, validTargets);
    expect(grouped.metadata?.groups.map((group: any) => group.playerId)).toEqual(['p1', 'p2', 'p3']);
    expect(grouped.missingRequiredPlayerIds).toEqual(['p3']);
  });

  it('requires exactly one unique candidate from every controller group', () => {
    const groups = [
      { playerId: 'p1', required: true, minTargets: 1, maxTargets: 1, targets: [{ id: 'a1', controller: 'p1' }] },
      { playerId: 'p2', required: true, minTargets: 1, maxTargets: 1, targets: [{ id: 'b1', controller: 'p2' }, { id: 'b2', controller: 'p2' }] },
    ];
    const validTargets = groups.flatMap((group) => group.targets);
    expect(validateGroupedTargetSelections({ selections: ['a1', 'b2'], validTargets, groups })).toBeNull();
    expect(validateGroupedTargetSelections({ selections: ['a1'], validTargets, groups })).toMatch(/player p2/i);
    expect(validateGroupedTargetSelections({ selections: ['a1', 'b1', 'b2'], validTargets, groups })).toMatch(/too many/i);
    expect(validateGroupedTargetSelections({ selections: ['a1', 'a1'], validTargets, groups })).toMatch(/duplicate/i);
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
