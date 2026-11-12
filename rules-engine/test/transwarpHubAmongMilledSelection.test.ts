import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { buildMoveZoneSelectionOptions } from '../src/oracleIRExecutorPlayerSelectionOptions.js';
import { isControllerOptionalTriggeredAbilityEffectText } from '../src/oracleIRPerPlayerOptional.js';
import type { GameState } from '../../shared/src';

const EFFECT =
  'mill five cards. You may put up to two artifact cards from among them into your hand.';

describe('Transwarp Hub mill + among-them selection', () => {
  it('is not a whole-ability optional may', () => {
    expect(isControllerOptionalTriggeredAbilityEffectText(EFFECT)).toBe(false);
  });

  it('parses mill then optional among-them move_zone', () => {
    const ir = parseOracleTextToIR(EFFECT, 'Transwarp Hub');
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    expect(steps.map((s) => s.kind)).toEqual(['mill', 'move_zone']);
    expect((steps[1] as any).optional).toBe(true);
  });

  it('builds a graveyard selection for up to two artifacts from among milled cards', () => {
    const ir = parseOracleTextToIR(EFFECT, 'Transwarp Hub');
    const move = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'move_zone')!;
    const milled = [
      { id: 'c1', name: 'Sol Ring', type_line: 'Artifact' },
      { id: 'c2', name: 'Island', type_line: 'Basic Land — Island' },
      { id: 'c3', name: 'Mind Stone', type_line: 'Artifact' },
      { id: 'c4', name: 'Swamp', type_line: 'Basic Land — Swamp' },
      { id: 'c5', name: 'Plains', type_line: 'Basic Land — Plains' },
    ];
    const state = {
      players: [{ id: 'p1', library: [], hand: [], graveyard: [...milled], exile: [] }],
      battlefield: [],
    } as GameState;
    const built = buildMoveZoneSelectionOptions(state, move as any, {
      controllerId: 'p1',
      sourceId: 'src',
      lastMovedCards: milled,
    } as any);
    expect(built).toBeTruthy();
    expect(built!.searchZone).toBe('graveyard');
    expect(built!.maxSelections).toBe(2);
    expect(built!.minSelections).toBe(0);
    expect(built!.selectableCardIds.sort()).toEqual(['c1', 'c3']);
  });

  it('moves chosen milled artifacts to hand when choices are supplied', () => {
    const ir = parseOracleTextToIR(EFFECT, 'Transwarp Hub');
    const steps = ir.abilities.flatMap((a) => a.steps || []);
    const library = [
      { id: 'c1', name: 'Sol Ring', type_line: 'Artifact' },
      { id: 'c2', name: 'Island', type_line: 'Basic Land — Island' },
      { id: 'c3', name: 'Mind Stone', type_line: 'Artifact' },
      { id: 'c4', name: 'Swamp', type_line: 'Basic Land — Swamp' },
      { id: 'c5', name: 'Talisman', type_line: 'Artifact' },
      { id: 'c6', name: 'Plains', type_line: 'Basic Land — Plains' },
    ];
    const state = {
      players: [{ id: 'p1', library: [...library], hand: [], graveyard: [], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'src',
      selectorContext: { chosenObjectIds: ['c1', 'c3'] },
    }, { allowOptional: true });
    expect((result.state.players[0]?.hand || []).map((c: any) => c.id).sort()).toEqual(['c1', 'c3']);
  });
});
