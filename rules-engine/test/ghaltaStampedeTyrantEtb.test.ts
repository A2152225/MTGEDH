import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { buildMoveZoneSelectionOptions } from '../src/oracleIRExecutorPlayerStepHandlers';
import { parseMoveZoneAnyNumberTypedFromYourHand } from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

const GHALTA_ORACLE =
  'Trample\nWhen Ghalta enters, put any number of creature cards from your hand onto the battlefield.';

function ghaltaHandState(): GameState {
  return {
    players: [{
      id: controllerId,
      library: [],
      hand: [
        { id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant' },
        { id: 'elf-1', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
      ],
      graveyard: [],
      exile: [],
    }],
    battlefield: [],
  } as GameState;
}

function ghaltaMoveStep() {
  const ir = parseOracleTextToIR(GHALTA_ORACLE, 'Ghalta, Stampede Tyrant');
  const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
    (entry) => entry.kind === 'move_zone' && /creature cards from your hand/i.test(String((entry as any).what?.text || '')),
  );
  expect(step).toBeTruthy();
  return step!;
}

describe('Ghalta, Stampede Tyrant — put any number of creatures from hand', () => {
  it('parses any-number creature cards from hand onto the battlefield', () => {
    const step = ghaltaMoveStep();
    expect(step.kind).toBe('move_zone');
    expect((step as any).to).toBe('battlefield');
    expect(parseMoveZoneAnyNumberTypedFromYourHand((step as any).what)).toEqual({ cardType: 'creature' });
  });

  it('requires a player choice instead of dumping every creature from hand', () => {
    const step = ghaltaMoveStep();
    const result = applyOracleIRStepsToGameState(ghaltaHandState(), [step], {
      controllerId,
      sourceId: 'ghalta-1',
      sourceName: 'Ghalta, Stampede Tyrant',
    }, { haltOnPlayerChoiceRequired: true });

    expect((result.automationGaps || []).some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect((result.state.players[0]?.hand || []).map((card: any) => card.id)).toEqual(['bear-1', 'bolt-1', 'elf-1']);
    expect(result.state.battlefield || []).toHaveLength(0);
  });

  it('puts only the chosen creature cards onto the battlefield', () => {
    const step = ghaltaMoveStep();
    const result = applyOracleIRStepsToGameState(ghaltaHandState(), [step], {
      controllerId,
      sourceId: 'ghalta-1',
      selectorContext: { chosenObjectIds: ['bear-1'] },
    });

    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).map((perm: any) => perm?.card?.name)).toEqual(['Grizzly Bears']);
    expect((result.state.players[0]?.hand || []).map((card: any) => card.id).sort()).toEqual(['bolt-1', 'elf-1']);
  });

  it('puts nothing when the player explicitly chooses zero creatures', () => {
    const step = ghaltaMoveStep();
    const result = applyOracleIRStepsToGameState(ghaltaHandState(), [step], {
      controllerId,
      sourceId: 'ghalta-1',
      selectorContext: { chosenObjectIds: [] },
    });

    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).map((card: any) => card.id)).toEqual(['bear-1', 'bolt-1', 'elf-1']);
  });

  it('builds a 0-to-N hand selection with only creature cards selectable', () => {
    const step = ghaltaMoveStep();
    const ctx = buildOracleIRExecutionContext({
      controllerId,
      sourceId: 'ghalta-1',
      sourceName: 'Ghalta, Stampede Tyrant',
    });
    const built = buildMoveZoneSelectionOptions(ghaltaHandState(), step as any, ctx);
    expect(built).toBeTruthy();
    expect(built?.minSelections).toBe(0);
    expect(built?.maxSelections).toBe(2);
    expect(built?.destination).toBe('battlefield');
    expect(built?.remainderDestination).toBe('none');
    expect(built?.searchZone).toBe('hand');
    expect(built?.selectableCardIds).toEqual(['bear-1', 'elf-1']);
  });
});
