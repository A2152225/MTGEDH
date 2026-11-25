import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { splitSubtypeUnion } from '../src/oracleIRExecutorBattlefieldSubtypeCompoundResolvers';

function makeState(over: Record<string, unknown> = {}) {
  return {
    id: 'swarmyard-regen',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] },
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: 'main1',
    active: true,
    ...over,
  } as any;
}

function permanent(id: string, typeLine: string, controller = 'p1') {
  return {
    id,
    controller,
    owner: controller,
    name: id,
    type_line: typeLine,
    card: { id: `${id}-card`, name: id, type_line: typeLine },
    tapped: false,
    counters: {},
  };
}

describe('regenerate multi-subtype OR targets (Swarmyard)', () => {
  it('splitSubtypeUnion parses Oxford-comma creature-type lists', () => {
    expect(splitSubtypeUnion('Insect, Rat, Spider, or Squirrel')).toEqual([
      'Insect',
      'Rat',
      'Spider',
      'Squirrel',
    ]);
    expect(splitSubtypeUnion('ape or a monkey')).toEqual(['ape', 'monkey']);
    expect(splitSubtypeUnion('Merfolk and/or Knight')).toEqual(['Merfolk', 'Knight']);
  });

  it('applies regenerate for a unique unbound Insect/Rat/Spider/Squirrel', () => {
    const ir = parseOracleTextToIR(
      '{T}: Regenerate target Insect, Rat, Spider, or Squirrel.',
      'Swarmyard',
    );
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []).filter(
      (step) => step.kind === 'regenerate',
    );
    expect(steps.length).toBeGreaterThan(0);

    const result = applyOracleIRStepsToGameState(
      makeState({
        battlefield: [
          permanent('swarmyard', 'Land'),
          permanent('rat-1', 'Creature — Rat'),
          permanent('bear-1', 'Creature — Bear'),
        ],
      }),
      steps,
      {
        controllerId: 'p1',
        sourceId: 'swarmyard',
        sourceName: 'Swarmyard',
      },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['regenerate']);
    expect(result.skippedSteps).toEqual([]);
    expect(((result.state as any).regenerationShields || [])).toEqual([
      expect.objectContaining({
        permanentId: 'rat-1',
        controllerId: 'p1',
        isUsed: false,
      }),
    ]);
  });

  it('applies regenerate when targetPermanentId is bound to a matching subtype', () => {
    const ir = parseOracleTextToIR(
      'Regenerate target Insect, Rat, Spider, or Squirrel.',
      'Swarmyard',
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const result = applyOracleIRStepsToGameState(
      makeState({
        battlefield: [
          permanent('insect-1', 'Creature — Insect'),
          permanent('spider-1', 'Creature — Spider'),
          permanent('bear-1', 'Creature — Bear'),
        ],
      }),
      steps,
      {
        controllerId: 'p1',
        sourceName: 'Swarmyard',
        targetPermanentId: 'spider-1',
      },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['regenerate']);
    expect(((result.state as any).regenerationShields || [])).toEqual([
      expect.objectContaining({ permanentId: 'spider-1' }),
    ]);
  });

  it('does not auto-pick when multiple legal unbound targets exist', () => {
    const ir = parseOracleTextToIR(
      'Regenerate target Insect, Rat, Spider, or Squirrel.',
      'Swarmyard',
    );
    const steps = ir.abilities[0]?.steps ?? [];

    const result = applyOracleIRStepsToGameState(
      makeState({
        battlefield: [
          permanent('rat-1', 'Creature — Rat'),
          permanent('squirrel-1', 'Creature — Squirrel'),
        ],
      }),
      steps,
      {
        controllerId: 'p1',
        sourceName: 'Swarmyard',
      },
    );

    expect(result.appliedSteps).toEqual([]);
    expect(result.skippedSteps.some((step) => step.kind === 'regenerate')).toBe(true);
  });
});
