import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { resolveBoundSelfOrSourceCreatureTargetId } from '../src/oracleIRExecutorBoundSelfCreatureTarget.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { asGameState } from './helpers/gameStateFixture';

const HIDEOUT_CONNIVE =
  '{3}, {T}: Target Villain you control connives. Activate only as a sorcery. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on that creature.)';

function makeState(): GameState {
  return asGameState({
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [
          { id: 'lib1', name: 'Top', type_line: 'Instant' },
          { id: 'lib2', name: 'Next', type_line: 'Sorcery' },
        ],
        hand: [
          { id: 'h1', name: 'Land', type_line: 'Basic Land — Plains' },
          { id: 'h2', name: 'Spell', type_line: 'Instant' },
        ],
        graveyard: [],
        exile: [],
      } as any,
    ],
    battlefield: [
      {
        id: 'villain1',
        name: 'Audit Villain',
        type_line: 'Creature — Human Villain',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'villain1', name: 'Audit Villain', type_line: 'Creature — Human Villain' },
        counters: {},
      },
      {
        id: 'bear1',
        name: 'Bear',
        type_line: 'Creature — Bear',
        controller: 'p1',
        owner: 'p1',
        card: { id: 'bear1', name: 'Bear', type_line: 'Creature — Bear' },
        counters: {},
      },
    ],
    stack: [],
  });
}

describe('Villainous Hideout connive', () => {
  it('parses a single connive step without reminder pollution', () => {
    const ir = parseOracleTextToIR(HIDEOUT_CONNIVE, 'Villainous Hideout');
    const activated = ir.abilities.find((ability) => ability.type === 'activated' && /connive/i.test(String(ability.text || '')));
    expect(activated?.steps).toEqual([
      expect.objectContaining({
        kind: 'connive',
        target: { kind: 'raw', text: 'Target Villain you control' },
        amount: { kind: 'number', value: 1 },
      }),
    ]);
  });

  it('resolves Target Villain you control to a Villain permanent', () => {
    const state = makeState();
    const resolved = resolveBoundSelfOrSourceCreatureTargetId(
      state,
      { kind: 'raw', text: 'Target Villain you control' },
      {
        controllerId: 'p1',
        selectorContext: { chosenObjectIds: ['villain1'] },
      } as any,
    );
    expect(resolved).toBe('villain1');

    const unboundSingle = resolveBoundSelfOrSourceCreatureTargetId(
      state,
      { kind: 'raw', text: 'Target Villain you control' },
      { controllerId: 'p1' } as any,
    );
    expect(unboundSingle).toBe('villain1');
  });

  it('draws then records a discard-choice gap for connive', () => {
    const ir = parseOracleTextToIR(HIDEOUT_CONNIVE, 'Villainous Hideout');
    const steps = ir.abilities
      .filter((ability) => ability.type === 'activated')
      .flatMap((ability) => ability.steps || []);
    const start = makeState();

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      selectorContext: { chosenObjectIds: ['villain1'] },
      targetCreatureId: 'villain1',
      targetPermanentId: 'villain1',
    } as any);

    const p1 = result.state.players.find((p) => p.id === 'p1') as any;
    expect(p1.hand.map((c: any) => c.id).sort()).toEqual(['h1', 'h2', 'lib1']);
    expect(result.skippedSteps.some((s) => s.kind === 'connive')).toBe(true);
    expect(
      result.automationGaps?.some(
        (gap) => gap.stepKind === 'connive' && gap.reasonCode === 'player_choice_required',
      ),
    ).toBe(true);
    expect(result.appliedSteps.some((s) => s.kind === 'conditional')).toBe(false);
  });
});
