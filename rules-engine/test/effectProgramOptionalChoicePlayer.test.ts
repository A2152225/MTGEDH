import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { ChoiceEventType } from '../src/choiceEventsTypes';
import { createEffectProgramRuntime } from '../src/effectProgram';
import { buildEffectProgramsFromOracleText, runOracleEffectProgram } from '../src/effectProgramOracleRunner';
import { readOptionalStepChoiceWho } from '../src/effectProgramOptionalChoicePlayer';

const JACE_TRIGGER = "At the beginning of combat on each opponent's turn, they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.";

function makeState(): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] } as any,
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] } as any,
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p2',
    priority: 'p2',
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: 'combat',
    step: 'BEGIN_COMBAT',
    active: true,
    turnNumber: 5,
    manaPool: { p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 } },
  } as any;
}

function buildJaceTriggerProgram() {
  const { programs } = buildEffectProgramsFromOracleText({
    idPrefix: 'jace-trigger',
    oracleText: JACE_TRIGGER,
    controllerId: 'p1',
    sourceId: 'jace',
    sourceName: 'Jace, Multiverse Architect',
  });
  return programs[0]!;
}

describe('effect program optional ("may") choice player', () => {
  it('records the optional step actor on the compiled yes/no choice', () => {
    const program = buildJaceTriggerProgram();
    const mayChoice = program.steps.find((step: any) => step.kind === 'choice' && String(step.id).endsWith(':may-choice')) as any;
    expect(mayChoice).toBeTruthy();
    expect(mayChoice.choiceRequest.type).toBe(ChoiceEventType.OPTION_CHOICE);
    expect(mayChoice.choiceRequest.payload.optionalStepWho).toBeTruthy();
    expect(mayChoice.choiceRequest.payload.optionalStepWho.kind).not.toBe('you');
  });

  it('does not record an actor for "you may" steps', () => {
    expect(readOptionalStepChoiceWho({ who: { kind: 'you' } })).toBeUndefined();
    expect(readOptionalStepChoiceWho({})).toBeUndefined();
    expect(readOptionalStepChoiceWho({ who: { kind: 'target_player' } })).toEqual({ kind: 'target_player' });
  });

  it('asks the bound opponent, not the controller, at runtime', () => {
    const program = buildJaceTriggerProgram();
    const result: any = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'jace', sourceName: 'Jace, Multiverse Architect', targetPlayerId: 'p2' } as any,
      {},
    );
    expect(result.status).toBe('waiting_for_choice');
    const choiceEvent = result.pendingChoice?.choiceEvent;
    expect(choiceEvent?.type).toBe(ChoiceEventType.OPTION_CHOICE);
    expect(choiceEvent?.playerId).toBe('p2');
  });
});