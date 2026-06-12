import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import type { GameState } from '../../shared/src/index.js';

function collectSteps(abilities: ReturnType<typeof parseOracleTextToIR>['abilities']): any[] {
  const steps: any[] = [];
  for (const ability of abilities) {
    if (Array.isArray(ability.steps)) {
      steps.push(...ability.steps);
    }
  }
  return steps;
}

describe('Inspiring Call oracle IR', () => {
  it('does not parse indestructible reminder text as a destroy step', () => {
    const text =
      'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy them.)';
    const steps = collectSteps(parseOracleTextToIR(text, 'Inspiring Call').abilities);
    expect(steps.some((step) => step.kind === 'destroy')).toBe(false);
  });

  it('draws one card per creature with a +1/+1 counter', () => {
    const text =
      'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy them.)';
    const steps = collectSteps(parseOracleTextToIR(text, 'Inspiring Call').abilities);

    const state = {
      players: [{
        id: 'p1',
        library: [
          { id: 'd1', name: 'One' },
          { id: 'd2', name: 'Two' },
          { id: 'd3', name: 'Three' },
        ],
        hand: [],
      }],
      battlefield: [
        { id: 'c1', controller: 'p1', card: { type_line: 'Creature — Merfolk' }, counters: { '+1/+1': 1 } },
        { id: 'c2', controller: 'p1', card: { type_line: 'Creature — Elf' }, counters: { '+1/+1': 2 } },
        { id: 'c3', controller: 'p1', card: { type_line: 'Creature — Human' }, counters: {} },
      ],
      zones: {
        p1: {
          library: [
            { id: 'd1', name: 'One' },
            { id: 'd2', name: 'Two' },
            { id: 'd3', name: 'Three' },
          ],
          hand: [],
        },
      },
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'spell_1',
      sourceName: 'Inspiring Call',
    });

    expect(result.skippedSteps?.some((entry) => entry.step?.kind === 'draw')).toBe(false);
    expect(result.appliedSteps.some((step) => step.kind === 'draw')).toBe(true);
    const player = (result.state as any).players.find((entry: any) => entry.id === 'p1');
    expect((player?.hand || []).length).toBe(2);
  });

  it('grants indestructible to creatures with +1/+1 counters via antecedent those creatures', () => {
    const text =
      'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy them.)';
    const steps = collectSteps(parseOracleTextToIR(text, 'Inspiring Call').abilities);

    const state = {
      players: [{
        id: 'p1',
        library: [{ id: 'd1', name: 'One' }, { id: 'd2', name: 'Two' }],
        hand: [],
      }],
      battlefield: [
        { id: 'c1', controller: 'p1', card: { type_line: 'Creature — Merfolk' }, counters: { '+1/+1': 1 } },
        { id: 'c2', controller: 'p1', card: { type_line: 'Creature — Elf' }, counters: { '+1/+1': 2 } },
        { id: 'c3', controller: 'p1', card: { type_line: 'Creature — Human' }, counters: {} },
      ],
      zones: { p1: { library: [{ id: 'd1', name: 'One' }, { id: 'd2', name: 'Two' }], hand: [] } },
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'spell_1',
      sourceName: 'Inspiring Call',
    });

    expect(result.skippedSteps || []).toEqual([]);
    const c1 = (result.state as any).battlefield.find((perm: any) => perm.id === 'c1');
    const c2 = (result.state as any).battlefield.find((perm: any) => perm.id === 'c2');
    const c3 = (result.state as any).battlefield.find((perm: any) => perm.id === 'c3');
    expect(c1?.temporaryEffects?.some((effect: any) =>
      (effect.grantedAbilities || []).includes('indestructible')
      || String(effect.description || '').includes('indestructible')
    )).toBe(true);
    expect(c2?.temporaryEffects?.some((effect: any) =>
      (effect.grantedAbilities || []).includes('indestructible')
      || String(effect.description || '').includes('indestructible')
    )).toBe(true);
    expect(c3?.temporaryEffects || []).toHaveLength(0);
  });
});
