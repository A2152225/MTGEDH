import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { buildEffectProgramFromOracleIR } from '../src/effectProgram';

function payStepFor(text: string) {
  const steps = parseOracleTextToIR(text, 'Test Well').abilities.flatMap((a: any) => a.steps);
  return { steps, pay: steps.find((s: any) => s.kind === 'pay_mana') as any };
}

describe('"you may pay {X}, where X is ... the amount of life you gained" wordings', () => {
  for (const wording of [
    'less than or equal to the amount of life you gained',
    'no more than the amount of life you gained',
    'at most the amount of life you gained this turn',
  ]) {
    it(`parses "${wording}" as a bounded optional {X} payment and builds an X prompt with a per-X cost`, () => {
      const { steps, pay } = payStepFor(`Whenever you gain life, you may pay {X}, where X is ${wording}. If you do, draw X cards.`);
      expect(pay, JSON.stringify(steps.map((s: any) => s.kind))).toBeTruthy();
      expect(String(pay.mana).toUpperCase()).toBe('{X}');
      const program = buildEffectProgramFromOracleIR({
        id: 'well-test', controllerId: 'p1' as any, sourceId: 'src', sourceName: 'Test Well', abilityIndex: 0, steps: steps as any,
      } as any);
      const xChoice: any = program.steps.find((s: any) => s.choiceRequest?.type === 'x_value_selection');
      expect(xChoice).toBeTruthy();
      expect(xChoice.choiceRequest.payload.maxFromReferenceAmount).toBe(true);
      expect(xChoice.choiceRequest.payload.costPerX).toBe('{1}');
    });
  }
});