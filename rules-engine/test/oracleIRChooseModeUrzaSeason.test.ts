import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { collectSpellResolutionEffectStepsWithOverlay } from '../src/oracleIRCompilerEnvelope.js';

describe('choose_mode: Urza recovery + Season {P}', () => {
  it("does not duplicate Urza's Command modes outside choose_mode", () => {
    const text =
      "Choose two —\n• Creatures you don't control get -2/-0 until end of turn.\n• Create a tapped Powerstone token.\n• Create a tapped 0/0 colorless Construct artifact creature token with \"This token gets +1/+1 for each artifact you control.\"\n• Scry 1, then draw a card.";

    const collected = collectSpellResolutionEffectStepsWithOverlay(text, "Urza's Command");
    expect(collected.map((s) => s.kind)).toEqual(['choose_mode']);

    const choose = collected[0] as any;
    expect(choose.modes).toHaveLength(4);
    expect(choose.modes[0].steps.map((s: any) => s.kind)).toContain('modify_pt');
    expect(choose.modes[2].steps.map((s: any) => s.kind)).toContain('create_token');
  });

  it('parses Season of Gathering as {P}-budget choose_mode', () => {
    const text =
      'Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — Put a +1/+1 counter on a creature you control. It gains vigilance and trample until end of turn.\n{P}{P} — Choose artifact or enchantment. Destroy all permanents of the chosen type.\n{P}{P}{P} — Draw cards equal to the greatest power among creatures you control.';

    const ir = parseOracleTextToIR(text, 'Season of Gathering');
    const spellSteps = ir.abilities.flatMap((a) => a.steps);
    const choose = spellSteps.find((s) => s.kind === 'choose_mode') as any;
    expect(choose).toBeTruthy();
    expect(choose.pBudget).toBe(5);
    expect(choose.canRepeatModes).toBe(true);
    expect(choose.modes).toHaveLength(3);
    expect(choose.modes.map((m: any) => m.pCost)).toEqual([1, 2, 3]);

    const collected = collectSpellResolutionEffectStepsWithOverlay(text, 'Season of Gathering');
    expect(collected.map((s) => s.kind)).toEqual(['choose_mode']);
  });
});
