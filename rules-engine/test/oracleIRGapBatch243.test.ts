import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch243');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function unknownRaws(steps: readonly { kind: string; raw?: string }[]): string[] {
  return steps.filter((step) => step.kind === 'unknown').map((step) => String(step.raw || ''));
}

describe('Oracle IR gap batch 243 support', () => {
  it('parses trailing persist as a structured keyword grant', () => {
    const steps = collectStepsFromText(
      'Other creatures you control gain "{T}: This creature deals 2 damage to any target" until end of turn. Persist.'
    );
    expect(unknownRaws(steps)).toEqual([]);
    expect(steps.some((step) => step.kind === 'grant_static_ability' && (step as any).abilities?.includes('persist'))).toBe(
      true
    );
  });

  it('parses trailing undying as a structured keyword grant', () => {
    const steps = collectStepsFromText('Exile it unless you sacrifice another creature. Undying.');
    expect(unknownRaws(steps)).toEqual([]);
    expect(steps.some((step) => step.kind === 'grant_static_ability' && (step as any).abilities?.includes('undying'))).toBe(
      true
    );
  });

  it('parses each-creature remove_counter plus trailing persist without unknown steps', () => {
    const steps = collectStepsFromText('Remove a -1/-1 counter from each creature you control. Persist.');
    expect(unknownRaws(steps)).toEqual([]);
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'remove_counter',
          target: expect.objectContaining({ text: 'each creature you control' }),
        }),
        expect.objectContaining({
          kind: 'grant_static_ability',
          abilities: ['persist'],
        }),
      ])
    );
  });

  it('parses subtype other-than-self +1/+1 and flying compound buffs', () => {
    const steps = collectStepsFromText(
      'Dinosaurs you control other than this creature get +1/+1 and gain flying until end of turn.'
    );
    expect(unknownRaws(steps)).toEqual([]);
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'modify_pt',
          target: expect.objectContaining({ text: 'dinosaurs you control other than this creature' }),
        }),
        expect.objectContaining({
          kind: 'grant_temporary_ability',
          target: expect.objectContaining({ text: 'dinosaurs you control other than this creature' }),
        }),
      ])
    );
  });
});
