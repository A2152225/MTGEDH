import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { asGameState } from './helpers/gameStateFixture';

const ABILITY =
  '{2}{G}: Put a +1/+1 counter on each creature you control that entered this turn. If you put two or more +1/+1 counters on creatures this way, draw a card.';

function board(): GameState {
  const creature = (id: string, entered: boolean) => ({
    id,
    controller: 'p1',
    owner: 'p1',
    enteredThisTurn: entered,
    card: { id: `${id}-card`, name: id, type_line: 'Creature — Elf', oracle_text: '' },
    counters: {},
  });
  return asGameState({
    players: [
      { id: 'p1', hand: [], library: [{ id: 'drawn', name: 'Forest' }], exile: [], graveyard: [] },
      { id: 'p2', hand: [], library: [], exile: [], graveyard: [] },
    ],
    battlefield: [creature('new-a', true), creature('new-b', true), creature('old', false)],
    zones: {
      p1: { hand: [], library: [{ id: 'drawn', name: 'Forest' }], graveyard: [], exile: [] },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  });
}

describe('Guinan entered-this-turn counters', () => {
  it('puts counters only on creatures that entered this turn and draws when two or more were added', () => {
    const ir = parseOracleTextToIR(ABILITY, 'Guinan, Ancient Advisor');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const result = applyOracleIRStepsToGameState(
      board(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'guinan',
        sourceName: 'Guinan, Ancient Advisor',
        sourceObjectType: 'ability',
      }),
      { allowOptional: true },
    );

    expect(result.skippedSteps.map((step) => step.kind)).not.toContain('add_counter');
    const counters = (id: string) => {
      const perm = (result.state.battlefield || []).find((entry: any) => entry.id === id) as any;
      return Number(perm?.counters?.['+1/+1'] || 0);
    };
    expect(counters('new-a')).toBe(1);
    expect(counters('new-b')).toBe(1);
    expect(counters('old')).toBe(0);
    const hand = ((result.state as any).zones?.p1?.hand || (result.state.players || []).find((p: any) => p.id === 'p1')?.hand || []) as any[];
    expect(hand.map((card) => card.name)).toContain('Forest');
  });
});
