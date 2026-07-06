import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { resolvePlayers } from '../src/oracleIRExecutorPlayerUtils';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  inferOracleIrTargetBinding,
  oracleIrTargetBindingToBaseContext,
  oracleIrTargetBindingToEventHint,
} from '../src/oracleIrTargetBinding';

const MANA_LEAK_TEXT = 'Counter target spell unless its controller pays {3}.';

function makeFourPlayerCounterState() {
  return {
    players: [
      { id: 'p_caster', seat: 0, library: [], hand: [], graveyard: [] },
      { id: 'p_victim', seat: 1, library: [], hand: [], graveyard: [] },
      { id: 'p_other1', seat: 2, library: [], hand: [], graveyard: [] },
      { id: 'p_other2', seat: 3, library: [], hand: [], graveyard: [] },
    ],
    stack: [
      {
        id: 'spell-victim',
        type: 'spell',
        controller: 'p_victim',
        owner: 'p_victim',
        card: { id: 'cultivate-card', name: 'Cultivate', type_line: 'Sorcery' },
      },
    ],
    manaPool: {
      p_victim: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
  } as any;
}

function buildSpellIrContextLikeServer(
  state: any,
  controllerId: string,
  targetIds: string[],
  extra?: Record<string, unknown>,
) {
  const targetBinding = inferOracleIrTargetBinding(state, targetIds, controllerId);
  const baseCtx = oracleIrTargetBindingToBaseContext(targetBinding);
  return buildOracleIRExecutionContext(
    {
      controllerId,
      sourceName: 'Mana Leak',
      sourceObjectType: 'spell',
      ...baseCtx,
      selectorContext: {
        ...baseCtx.selectorContext,
        ...(extra || {}),
      },
      ...(extra || {}),
    },
    {
      ...oracleIrTargetBindingToEventHint(targetBinding),
      sourceObjectType: 'spell',
    },
  );
}

describe('counterspell unless-pay target binding', () => {
  it('binds stack spell targets to targetSpellId via inferOracleIrTargetBinding', () => {
    const state = makeFourPlayerCounterState();
    const binding = inferOracleIrTargetBinding(state, ['spell-victim'], 'p_caster');
    expect(binding).toEqual({
      targetSpellId: 'spell-victim',
      chosenObjectIds: ['spell-victim'],
    });
  });

  it('resolves its controller to the targeted spell controller in four-player games', () => {
    const state = makeFourPlayerCounterState();
    const irCtx = buildSpellIrContextLikeServer(state, 'p_caster', ['spell-victim']);
    const steps = parseOracleTextToIR(MANA_LEAK_TEXT, 'Mana Leak').abilities[0]?.steps ?? [];

    expect(irCtx.targetSpellId).toBe('spell-victim');
    expect(irCtx.selectorContext?.targetSpellId).toBe('spell-victim');

    const unlessStep = steps[0] as any;
    expect(unlessStep.who).toEqual({ kind: 'controller_of_referenced_object' });
    expect(resolvePlayers(state, unlessStep.who, irCtx)).toEqual(['p_victim']);
  });

  it('binds Arcane Denial stack targets the same way as Mana Leak', () => {
    const state = makeFourPlayerCounterState();
    const arcaneDenialText = 'Counter target spell. Its controller may draw a card.';
    const binding = inferOracleIrTargetBinding(state, ['spell-victim'], 'p_caster');
    expect(binding.targetSpellId).toBe('spell-victim');

    const steps = parseOracleTextToIR(arcaneDenialText, 'Arcane Denial').abilities[0]?.steps ?? [];
    const counterStep = steps.find((step) => step.kind === 'counter_spell');
    expect(counterStep).toBeTruthy();
  });

  it('counters the targeted spell when its controller declines in four-player games', () => {
    const state = makeFourPlayerCounterState();
    const steps = parseOracleTextToIR(MANA_LEAK_TEXT, 'Mana Leak').abilities[0]?.steps ?? [];
    const irCtx = buildSpellIrContextLikeServer(state, 'p_caster', ['spell-victim'], {
      unlessPaysManaChoice: 'decline',
    });

    const result = applyOracleIRStepsToGameState(state, steps, irCtx, { allowOptional: true });

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['counter_spell', 'unless_pays_mana']);
    expect(result.state.stack).toEqual([]);
    expect(
      (result.state.players.find((p: any) => p.id === 'p_victim')?.graveyard || []).map((c: any) => c.id),
    ).toEqual(['cultivate-card']);
  });

  it('does not guess a payer without spell binding in four-player games', () => {
    const state = makeFourPlayerCounterState();
    const steps = parseOracleTextToIR(MANA_LEAK_TEXT, 'Mana Leak').abilities[0]?.steps ?? [];
    const irCtx = buildOracleIRExecutionContext(
      { controllerId: 'p_caster', sourceName: 'Mana Leak' },
      { sourceObjectType: 'spell' },
    );
    const unlessStep = steps[0] as any;

    expect(resolvePlayers(state, unlessStep.who, irCtx)).toEqual([]);
  });
});
