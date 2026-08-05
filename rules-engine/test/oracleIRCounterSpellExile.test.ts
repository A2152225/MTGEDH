import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import type { GameState, PlayerID } from '../../shared/src/index.js';

function baseState(stack: any[]): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    players: [
      { id: p1, life: 40, hand: [], library: [], graveyard: [], exile: [] },
      { id: p2, life: 40, hand: [], library: [], graveyard: [], exile: [] },
    ],
    stack,
    battlefield: [],
  } as any;
}

describe('oracle IR counter_spell leave-stack destination', () => {
  it('exiles a flashback spell when countered', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = baseState([
      {
        id: 'stack_flashback',
        type: 'spell',
        controller: p2,
        castFromGraveyard: true,
        card: {
          id: 'think_twice',
          name: 'Think Twice',
          type_line: 'Instant',
          castFromGraveyard: true,
          castWithAbility: 'flashback',
        },
      },
    ]);

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Counterspell',
      sourceId: 'counter_source',
      targetSpellId: 'stack_flashback',
    });

    const result = applyOracleIRStepsToGameState(
      state,
      [{ kind: 'counter_spell', target: { kind: 'raw', text: 'target spell' }, raw: 'Counter target spell.' } as any],
      ctx,
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['counter_spell']);
    expect((result.state as any).stack).toHaveLength(0);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.exile || []).map((card: any) => card.id)).toContain('think_twice');
    expect((owner?.graveyard || []).map((card: any) => card.id)).not.toContain('think_twice');
  });

  it('puts an ordinary spell into its controller graveyard when countered', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = baseState([
      {
        id: 'stack_bolt',
        type: 'spell',
        controller: p2,
        card: {
          id: 'bolt',
          name: 'Lightning Bolt',
          type_line: 'Instant',
        },
      },
    ]);

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Counterspell',
      sourceId: 'counter_source',
      targetSpellId: 'stack_bolt',
    });

    const result = applyOracleIRStepsToGameState(
      state,
      [{ kind: 'counter_spell', target: { kind: 'raw', text: 'target spell' }, raw: 'Counter target spell.' } as any],
      ctx,
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['counter_spell']);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.graveyard || []).map((card: any) => card.id)).toContain('bolt');
    expect((owner?.exile || []).map((card: any) => card.id)).not.toContain('bolt');
  });

  it('ceases a ceaseOnCounter copy instead of changing zones', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = baseState([
      {
        id: 'stack_copy',
        type: 'spell',
        controller: p2,
        card: {
          id: 'bolt_copy',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          ceaseOnCounter: true,
        },
      },
    ]);

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Counterspell',
      sourceId: 'counter_source',
      targetSpellId: 'stack_copy',
    });

    const result = applyOracleIRStepsToGameState(
      state,
      [{ kind: 'counter_spell', target: { kind: 'raw', text: 'target spell' }, raw: 'Counter target spell.' } as any],
      ctx,
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['counter_spell']);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.graveyard || []).map((card: any) => card.id)).not.toContain('bolt_copy');
    expect((owner?.exile || []).map((card: any) => card.id)).not.toContain('bolt_copy');
  });
});
