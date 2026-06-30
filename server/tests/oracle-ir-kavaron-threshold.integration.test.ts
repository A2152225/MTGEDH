import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  collectActivatedAbilitySteps,
  readStationChargeThresholdFromActivatedOracleText,
  tryApplyOracleIRToActivatedAbility,
} from '../src/state/modules/oracleIrAbilityExecution.js';

const KAVARON_THRESHOLD =
  '12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.';

function makeCtx(overrides: { charge?: number } = {}) {
  return {
    state: {
      players: [{ id: 'p1', name: 'Player 1' }],
      battlefield: [
        {
          id: 'kavaron_1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          counters: { charge: overrides.charge ?? 12 },
          card: {
            name: 'Kavaron, Memorial World',
            type_line: 'Land — Spacecraft',
            oracle_text:
              '{T}: Add {R}.\n' +
              "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)\n" +
              KAVARON_THRESHOLD,
          },
        },
        {
          id: 'bear_1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
      life: { p1: 40 },
      turnNumber: 1,
      pendingExileAtNextEndStep: [],
      zones: { p1: { hand: [], library: [], graveyard: [], exile: [] } },
    },
    gameId: 'test_kavaron_oracle_ir_threshold',
    bumpSeq: () => {},
    libraries: new Map(),
  } as any;
}

describe('oracle IR Kavaron threshold activated ability (integration)', () => {
  it('collects wired steps from full 12+ threshold oracle line', () => {
    const steps = collectActivatedAbilitySteps(KAVARON_THRESHOLD, 'Kavaron, Memorial World');
    expect(steps.map((step) => step.kind)).toEqual(['create_token', 'modify_pt', 'grant_temporary_ability']);
    expect(readStationChargeThresholdFromActivatedOracleText(KAVARON_THRESHOLD, 'Kavaron, Memorial World')).toBe(12);
  });

  it('parses stationChargeThreshold separately from mana cost in IR', () => {
    const ir = parseOracleTextToIR(KAVARON_THRESHOLD, 'Kavaron, Memorial World');
    expect(ir.abilities[0]?.stationChargeThreshold).toBe(12);
    expect(ir.abilities[0]?.cost).toBe('{1}{R}, {T}, Sacrifice a land');
  });

  it('applies Kavaron 12+ token and pump through tryApplyOracleIRToActivatedAbility', () => {
    const ctx = makeCtx({ charge: 12 });
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Kavaron, Memorial World',
      oracleText: KAVARON_THRESHOLD,
      sourcePermanentId: 'kavaron_1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(3);

    const tokens = (ctx.state.battlefield || []).filter((perm: any) => perm.isToken);
    expect(tokens.length).toBe(1);
    expect(String(tokens[0]?.card?.type_line || '')).toMatch(/Robot/i);

    const bear = (ctx.state.battlefield || []).find((perm: any) => perm.id === 'bear_1');
    expect(bear?.powerBoost || bear?.tempPowerBoost || (bear as any)?.grantedAbilities?.length).toBeTruthy();
  });
});
