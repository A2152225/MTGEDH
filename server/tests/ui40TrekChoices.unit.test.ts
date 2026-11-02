import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor';
import { buildMoveZoneSelectionOptions } from '../../rules-engine/src/oracleIRExecutorPlayerStepHandlers';

const ASSESSOR = "Whenever this creature attacks, assimilate a creature card exiled with it. (Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)";
const ex = (id: string, type_line = 'Creature \u2014 Bear') => ({ id, name: 'Card ' + id, type_line, oracle_text: '', zone: 'exile', exiledWithSourceId: 'src', exiledBy: 'src' });
function state(exile: any[]): any {
  return { id: 'g', format: 'commander', turnPlayer: 'p1', priority: 'p1', stack: [], startingLife: 40, life: {},
    players: [{ id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] }, { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile }],
    battlefield: [{ id: 'src', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'src_c', name: 'Assimilation Assessor', type_line: 'Artifact Creature \u2014 Borg', oracle_text: ASSESSOR } }] };
}
function step(): any {
  const ir: any = parseOracleTextToIR(ASSESSOR, 'Assimilation Assessor');
  return (ir.abilities || []).flatMap((a: any) => a.steps || []).find((s: any) => s.kind === 'move_zone');
}

describe('UI40: assimilate a creature card exiled with it', () => {
  it('asks the player when several creature cards are exiled with the source', () => {
    const res: any = applyOracleIRStepsToGameState(state([ex('e1'), ex('e2')]), [step()], { controllerId: 'p1', sourceId: 'src' } as any);
    expect(res.state.battlefield.length).toBe(1);
    expect(res.automationGaps.some((g: any) => /choose a card exiled with source/.test(String(g.message || g.reason || JSON.stringify(g))))).toBe(true);
  });
  it('builds an exile pick with only the creature cards selectable, max 1', () => {
    const built: any = buildMoveZoneSelectionOptions(state([ex('e1'), ex('e2'), ex('x1', 'Instant')]), step(), { controllerId: 'p1', sourceId: 'src' } as any);
    expect(built.searchZone).toBe('exile');
    expect([...built.selectableCardIds].sort()).toEqual(['e1', 'e2']);
    expect(built.maxSelections).toBe(1);
    expect(built.minSelections).toBe(1);
  });
  it('moves the chosen card on resume, and auto-moves a lone candidate', () => {
    const chosen: any = applyOracleIRStepsToGameState(state([ex('e1'), ex('e2')]), [step()], { controllerId: 'p1', sourceId: 'src', selectorContext: { chosenObjectIds: ['e2'] } } as any);
    const moved = chosen.state.battlefield.find((p: any) => p.id !== 'src');
    expect(moved?.card?.id || moved?.card?.name).toMatch(/e2/);
    expect(moved.counters['+1/+1']).toBe(1);
    const lone: any = applyOracleIRStepsToGameState(state([ex('e1')]), [step()], { controllerId: 'p1', sourceId: 'src' } as any);
    expect(lone.state.battlefield.length).toBe(2);
  });
});