import { describe, expect, it } from 'vitest';
import {
  collectActivatedAbilitySteps,
  tryApplyOracleIRToActivatedAbility,
} from '../src/state/modules/oracleIrAbilityExecution.js';
import { isActivatedAbilityEffectFullyWired } from '../src/state/modules/oracleIrStepWiring.js';

const CARETAKER_ORACLE =
  "(Gain the next level as a sorcery to add its ability.)\n" +
  "Whenever one or more tokens you control enter, draw a card. This ability triggers only once each turn.\n" +
  "{W}: Level 2\n" +
  "When this Class becomes level 2, create a token that's a copy of target token you control.\n" +
  "{3}{W}: Level 3\n" +
  "Creature tokens you control get +2/+2.";

function makeClassCtx(level?: number) {
  return {
    state: {
      players: [{ id: 'p1', name: 'Player 1' }],
      battlefield: [
        {
          id: 'class-1',
          controller: 'p1',
          owner: 'p1',
          ...(typeof level === 'number' ? { level } : {}),
          card: {
            name: "Caretaker's Talent",
            type_line: 'Enchantment — Class',
            oracle_text: CARETAKER_ORACLE,
          },
        },
      ],
      life: { p1: 40 },
      turnNumber: 1,
      zones: { p1: { hand: [], library: [], graveyard: [], exile: [] } },
    },
    gameId: 'test_class_level_activated_ir',
    bumpSeq: () => {},
    libraries: new Map(),
  } as any;
}

describe("oracle IR Class level abilities (Caretaker's Talent)", () => {
  it('parses "{W}: Level 2" as a wired gain_class_level step', () => {
    const steps = collectActivatedAbilitySteps('{W}: Level 2', "Caretaker's Talent");
    expect(steps).toEqual([
      expect.objectContaining({ kind: 'gain_class_level', level: 2 }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('parses bare "Level 2" effect text as wired gain_class_level', () => {
    const steps = collectActivatedAbilitySteps('Level 2', "Caretaker's Talent");
    expect(steps).toEqual([
      expect.objectContaining({ kind: 'gain_class_level', level: 2 }),
    ]);
    expect(isActivatedAbilityEffectFullyWired(steps)).toBe(true);
  });

  it('levels a Class permanent from 1 to 2 when Level 2 resolves', () => {
    const ctx = makeClassCtx();
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: "Caretaker's Talent",
      oracleText: '{W}: Level 2',
      sourcePermanentId: 'class-1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBe(1);
    const permanent = (ctx.state.battlefield || []).find((perm: any) => perm.id === 'class-1');
    expect(permanent?.level).toBe(2);
  });

  it('levels a Class permanent from 2 to 3 when Level 3 resolves', () => {
    const ctx = makeClassCtx(2);
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: "Caretaker's Talent",
      oracleText: 'Level 3',
      sourcePermanentId: 'class-1',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBe(1);
    const permanent = (ctx.state.battlefield || []).find((perm: any) => perm.id === 'class-1');
    expect(permanent?.level).toBe(3);
  });

  it('does not skip from level 1 directly to level 3', () => {
    const ctx = makeClassCtx(1);
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: "Caretaker's Talent",
      oracleText: '{3}{W}: Level 3',
      sourcePermanentId: 'class-1',
      allowOptional: true,
    });

    expect(result.handled).toBe(false);
    const permanent = (ctx.state.battlefield || []).find((perm: any) => perm.id === 'class-1');
    expect(permanent?.level ?? 1).toBe(1);
  });
});
