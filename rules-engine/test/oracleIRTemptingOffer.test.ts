import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import type { OracleEffectStep } from '../src/oracleIR';

const TEMPT_WITH_DISCOVERY_ORACLE =
  'Tempting offer — Search your library for a land card and put it onto the battlefield. Each opponent may search their library for a land card and put it onto the battlefield. For each opponent who searches a library this way, search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.';

describe('oracleIR Tempting Offer', () => {
  it('parses Tempt with Discovery as tempting_offer before remaining search clauses', () => {
    const ir = parseOracleTextToIR(TEMPT_WITH_DISCOVERY_ORACLE, 'Tempt with Discovery');
    const steps = (ir.abilities || []).flatMap((ability: any) => ability.steps || []);
    expect(steps[0]?.kind).toBe('tempting_offer');
    expect(steps[0]).toMatchObject({
      kind: 'tempting_offer',
      who: { kind: 'each_opponent' },
    });
    expect(steps.some((step: any) => step.kind === 'search_library' && steps.indexOf(step) === 0)).toBe(false);
  });

  it('halts on tempting_offer without searching libraries', () => {
    const state = {
      players: [
        { id: 'p1', hand: [], library: [{ id: 'p1-forest', name: 'Forest', type_line: 'Basic Land — Forest' }], graveyard: [], exile: [] },
        { id: 'p2', hand: [], library: [{ id: 'p2-island', name: 'Island', type_line: 'Basic Land — Island' }], graveyard: [], exile: [] },
      ],
      battlefield: [],
      zones: {
        p1: { hand: [], libraryCount: 1 },
        p2: { hand: [], libraryCount: 1 },
      },
    } as any;
    const ir = parseOracleTextToIR(TEMPT_WITH_DISCOVERY_ORACLE, 'Tempt with Discovery');
    const steps = (ir.abilities || []).flatMap((ability: any) => ability.steps || []) as OracleEffectStep[];
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'tempt-1',
      sourceName: 'Tempt with Discovery',
      interactivePlayerChoices: true,
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });

    expect(result.automationGaps.some((gap) =>
      gap.reasonCode === 'player_choice_required' && gap.stepKind === 'tempting_offer',
    )).toBe(true);
    expect((result.state.battlefield || [])).toHaveLength(0);
    expect(result.state.players[0].library).toHaveLength(1);
    expect(result.state.players[1].library).toHaveLength(1);
  });
});
