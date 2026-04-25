import { describe, expect, it } from 'vitest';
import { ChoiceEventType, type ChoiceEvent, type ChoiceResponse } from '../src/choiceEventsTypes';
import type { GameState } from '../../shared/src';
import {
  bindEffectProgramChoiceResponse,
  buildEffectProgramFromOracleIR,
  createChoiceEventFromEffectProgramChoiceRequest,
  createEffectProgramRuntime,
  runEffectProgram,
  type EffectProgram,
} from '../src/effectProgram';
import {
  buildEffectProgramsFromOracleText,
  createOracleIREffectProgramHandlers,
  runOracleEffectProgram,
} from '../src/effectProgramOracleRunner';
import {
  auditEffectProgramKeywords,
  createEffectProgramKeywordExpansionHandler,
  getEffectProgramKeywordEntry,
} from '../src/effectProgramKeywordRegistry';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [{ id: 'drawn-card', name: 'Drawn Card' }],
        hand: [],
        graveyard: [],
      } as any,
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {} as any,
    phase: 'pre_game' as any,
    active: true,
    ...overrides,
  } as any;
}

function makeOptionChoiceEvent(): ChoiceEvent {
  return {
    id: 'choice-1',
    type: ChoiceEventType.OPTION_CHOICE,
    playerId: 'p1',
    description: 'Use the optional effect?',
    mandatory: false,
    timestamp: 1,
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    minSelections: 1,
    maxSelections: 1,
  };
}

function makeChoiceResponse(selections: readonly string[]): ChoiceResponse {
  return {
    eventId: 'choice-1',
    playerId: 'p1',
    selections,
    cancelled: false,
    timestamp: 2,
  };
}

describe('EffectProgram', () => {
  it('runs deterministic command steps through the supplied handler', () => {
    const program: EffectProgram = {
      id: 'program-1',
      controllerId: 'p1',
      steps: [
        {
          id: 'draw-command',
          kind: 'command',
          command: { kind: 'test_increment' },
        },
      ],
    };

    const result = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }), {
      applyCommand: ({ state }) => ({ count: state.count + 1 }),
    });

    expect(result.status).toBe('completed');
    expect(result.state.count).toBe(1);
    expect(result.runtime.cursor).toBe(1);
    expect(result.trace.map(entry => entry.outcome)).toEqual(['applied']);
  });

  it('accepts command handler results that only wrap state', () => {
    const program: EffectProgram = {
      id: 'program-state-wrapper',
      controllerId: 'p1',
      steps: [
        {
          id: 'wrapped-state-command',
          kind: 'command',
          command: { kind: 'test_increment' },
        },
      ],
    };

    const result = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }), {
      applyCommand: ({ state }) => ({ state: { count: state.count + 1 } }),
    });

    expect(result.status).toBe('completed');
    expect(result.state).toEqual({ count: 1 });
  });

  it('pauses at choice steps and resumes after the choice response is bound', () => {
    const program: EffectProgram = {
      id: 'program-2',
      controllerId: 'p1',
      steps: [
        {
          id: 'choice-step',
          kind: 'choice',
          bindingKey: 'use-effect',
          choiceEvent: makeOptionChoiceEvent(),
        },
        {
          id: 'after-choice',
          kind: 'command',
          command: { kind: 'test_increment' },
        },
      ],
    };

    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }));

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.choiceEvent.id).toBe('choice-1');
    expect(paused.runtime.cursor).toBe(0);

    const resumedRuntime = bindEffectProgramChoiceResponse(paused.runtime, makeChoiceResponse(['yes']), 'use-effect');
    const completed = runEffectProgram(resumedRuntime, {
      applyCommand: ({ state }) => ({ count: state.count + 1 }),
    });

    expect(completed.status).toBe('completed');
    expect(completed.state.count).toBe(1);
    expect(completed.runtime.bindings['use-effect']).toMatchObject({ selections: ['yes'] });
  });

  it('uses choice bindings as guards for follow-up command steps', () => {
    const program: EffectProgram = {
      id: 'program-3',
      controllerId: 'p1',
      steps: [
        {
          id: 'may-choice',
          kind: 'choice',
          bindingKey: 'may',
          choiceEvent: makeOptionChoiceEvent(),
        },
        {
          id: 'guarded-command',
          kind: 'command',
          guard: { bindingKey: 'may', selectionIncludes: 'yes', onFalse: 'skip' },
          command: { kind: 'test_increment' },
        },
      ],
    };

    const declinedRuntime = bindEffectProgramChoiceResponse(
      createEffectProgramRuntime({ program, state: { count: 0 } }),
      makeChoiceResponse(['no']),
      'may'
    );
    const declined = runEffectProgram(declinedRuntime, {
      applyCommand: ({ state }) => ({ count: state.count + 1 }),
    });

    expect(declined.status).toBe('completed');
    expect(declined.state.count).toBe(0);
    expect(declined.trace.map(entry => entry.outcome)).toEqual(['applied', 'skipped']);

    const acceptedRuntime = bindEffectProgramChoiceResponse(
      createEffectProgramRuntime({ program, state: { count: 0 } }),
      makeChoiceResponse(['yes']),
      'may'
    );
    const accepted = runEffectProgram(acceptedRuntime, {
      applyCommand: ({ state }) => ({ count: state.count + 1 }),
    });

    expect(accepted.status).toBe('completed');
    expect(accepted.state.count).toBe(1);
  });

  it('builds guarded effect-program steps from optional Oracle IR clauses', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'oracle-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Optional Source',
      steps: [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          optional: true,
          raw: 'You may draw a card.',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['choice', 'command']);
    expect(program.steps[0]).toMatchObject({ kind: 'choice', bindingKey: 'oracle-program:clause-0:may' });
    expect(program.steps[1]).toMatchObject({
      kind: 'command',
      guard: { bindingKey: 'oracle-program:clause-0:may', selectionIncludes: 'yes' },
    });
  });

  it('lowers ability-level intervening-if clauses into executable condition steps', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'intervening-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Conditional Source',
      interveningIf: 'you gained life this turn',
      steps: [
        {
          kind: 'conditional',
          condition: { kind: 'if', raw: 'you gained life this turn' },
          steps: [
            {
              kind: 'draw',
              who: { kind: 'you' },
              amount: { kind: 'number', value: 1 },
              raw: 'draw a card',
            } as any,
          ],
          raw: 'if you gained life this turn, draw a card',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['condition', 'command']);
    expect(program.steps[0]).toMatchObject({
      id: 'intervening-program:intervening-if',
      kind: 'condition',
      condition: { kind: 'if', raw: 'you gained life this turn' },
      interveningIf: true,
      onFalse: { action: 'halt' },
    });
    expect((program.steps[1] as any).command.step.kind).toBe('draw');

    const declined = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }), {
      evaluateCondition: () => false,
      applyCommand: ({ state }) => ({ count: state.count + 1 }),
    });

    expect(declined.status).toBe('halted');
    expect(declined.state.count).toBe(0);
    expect(declined.trace.map(entry => entry.outcome)).toEqual(['halted']);

    const accepted = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }), {
      evaluateCondition: () => true,
      applyCommand: ({ state }) => ({ count: state.count + 1 }),
    });

    expect(accepted.status).toBe('completed');
    expect(accepted.state.count).toBe(1);
    expect(accepted.trace.map(entry => entry.outcome)).toEqual(['applied', 'applied']);
  });

  it('records halted trace outcome for unknown halt conditions', () => {
    const program: EffectProgram = {
      id: 'unknown-halt-program',
      controllerId: 'p1',
      steps: [
        {
          id: 'unknown-condition',
          kind: 'condition',
          condition: { kind: 'if', raw: 'some unknown condition' },
          onUnknown: 'halt',
        },
      ],
    };

    const result = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }), {
      evaluateCondition: () => 'unknown',
    });

    expect(result.status).toBe('halted');
    expect(result.trace).toMatchObject([
      {
        stepId: 'unknown-condition',
        kind: 'condition',
        outcome: 'halted',
      },
    ]);
  });

  it('preserves intervening-if clauses as first-class steps when building from Oracle text', () => {
    const { programs } = buildEffectProgramsFromOracleText({
      idPrefix: 'lifegain-trigger',
      oracleText: 'At the beginning of your end step, if you gained life this turn, draw a card.',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Lifegain Source',
    });

    expect(programs).toHaveLength(1);
    expect(programs[0]?.steps.map(step => step.kind)).toEqual(['condition', 'command']);
    expect(programs[0]?.steps[0]).toMatchObject({
      id: 'lifegain-trigger:ability-0:intervening-if',
      kind: 'condition',
      condition: { kind: 'if', raw: 'you gained life this turn' },
      interveningIf: true,
    });
    expect((programs[0]?.steps[1] as any).command.step.kind).toBe('draw');
  });

  it('evaluates EffectProgram condition steps through the Oracle runner by default', () => {
    const { programs } = buildEffectProgramsFromOracleText({
      idPrefix: 'lifegain-runner-trigger',
      oracleText: 'At the beginning of your end step, if you gained life this turn, draw a card.',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Lifegain Source',
    });
    const program = programs[0]!;

    const falseResult = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Lifegain Source' }
    );

    expect(falseResult.status).toBe('halted');
    expect(falseResult.state.players.find(player => player.id === 'p1')?.hand).toEqual([]);

    const trueResult = runOracleEffectProgram(
      createEffectProgramRuntime({
        program,
        state: makeState({ lifeGainedThisTurn: { p1: 1 } } as any),
      }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Lifegain Source' }
    );

    const player = trueResult.state.players.find(playerState => playerState.id === 'p1') as any;
    expect(trueResult.status).toBe('completed');
    expect((player.hand || []).map((card: any) => card.id)).toEqual(['drawn-card']);
    expect(trueResult.events).toMatchObject([
      {
        type: 'oracle_ir_execution',
        stepId: 'lifegain-runner-trigger:ability-0:clause-0:command',
        appliedStepKinds: ['draw'],
      },
    ]);
  });

  it('lowers ordinary conditional Oracle IR wrappers into skip-able condition blocks', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'ordinary-conditional-program',
      controllerId: 'p1',
      sourceName: 'Conditional Source',
      steps: [
        {
          kind: 'conditional',
          condition: { kind: 'if', raw: 'you control an artifact' },
          steps: [
            {
              kind: 'gain_life',
              who: { kind: 'you' },
              amount: { kind: 'number', value: 2 },
              raw: 'you gain 2 life',
            } as any,
          ],
          raw: 'If you control an artifact, you gain 2 life.',
        } as any,
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'draw a card',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['condition', 'command', 'command']);
    expect(program.steps[0]).toMatchObject({
      id: 'ordinary-conditional-program:clause-0:condition',
      kind: 'condition',
      condition: { kind: 'if', raw: 'you control an artifact' },
      onFalse: { action: 'skip_to_step', stepId: 'ordinary-conditional-program:clause-1:command' },
    });

    const falseResult = runEffectProgram(createEffectProgramRuntime({ program, state: { applied: [] as string[] } }), {
      evaluateCondition: () => false,
      applyCommand: ({ state, step }) => ({
        applied: [...state.applied, String((step.command as any).step.kind)],
      }),
    });

    expect(falseResult.status).toBe('completed');
    expect(falseResult.state.applied).toEqual(['draw']);
    expect(falseResult.trace.map(entry => entry.outcome)).toEqual(['skipped', 'applied']);

    const trueResult = runEffectProgram(createEffectProgramRuntime({ program, state: { applied: [] as string[] } }), {
      evaluateCondition: () => true,
      applyCommand: ({ state, step }) => ({
        applied: [...state.applied, String((step.command as any).step.kind)],
      }),
    });

    expect(trueResult.status).toBe('completed');
    expect(trueResult.state.applied).toEqual(['gain_life', 'draw']);
    expect(trueResult.trace.map(entry => entry.outcome)).toEqual(['applied', 'applied', 'applied']);
  });

  it('creates concrete choice events from generated choice requests', () => {
    const choiceEvent = createChoiceEventFromEffectProgramChoiceRequest({
      eventId: 'effect-choice-1',
      timestamp: 10,
      request: {
        type: ChoiceEventType.COLOR_CHOICE,
        playerId: 'p1',
        sourceId: 'source-1',
        sourceName: 'Mana Source',
        description: 'Choose a color.',
        mandatory: true,
        payload: {
          minColors: 1,
          maxColors: 1,
        },
      },
    });

    expect(choiceEvent).toMatchObject({
      id: 'effect-choice-1',
      type: ChoiceEventType.COLOR_CHOICE,
      playerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Mana Source',
      description: 'Choose a color.',
      mandatory: true,
      timestamp: 10,
      minColors: 1,
      maxColors: 1,
    });
    expect((choiceEvent as any).colors.map((color: any) => color.id)).toEqual(['W', 'U', 'B', 'R', 'G']);
  });

  it('uses generated choice requests as the default pause source', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'oracle-program-choice',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Color Source',
      steps: [
        {
          kind: 'choose_color',
          raw: 'Choose a color.',
        } as any,
      ],
    });

    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }));

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.step.bindingKey).toBe('oracle-program-choice:clause-0:choice');
    expect(paused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.COLOR_CHOICE,
      playerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Color Source',
      description: 'Color Source: Choose a color.',
    });
  });

  it('uses Oracle IR mana options to constrain generated color prompts', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'oracle-program-limited-color-choice',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Limited Color Source',
      steps: [
        {
          kind: 'choose_color',
          manaOptions: ['{R}', '{G}'],
          raw: 'Choose red or green.',
        } as any,
      ],
    });

    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: { count: 0 } }));

    expect(paused.status).toBe('waiting_for_choice');
    expect((paused.pendingChoice?.choiceEvent as any).colors).toEqual([
      { id: 'R', label: 'Red' },
      { id: 'G', label: 'Green' },
    ]);
  });

  it('feeds target choice bindings into later Oracle IR command execution', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'chosen-target-creature',
          controller: 'p2',
          owner: 'p2',
          tapped: false,
          card: {
            id: 'chosen-target-creature-card',
            name: 'Runeclaw Bear',
            type_line: 'Creature - Bear',
            power: '2',
            toughness: '2',
          },
          counters: {},
        } as any,
      ],
    } as any);
    const program = buildEffectProgramFromOracleIR({
      id: 'target-binding-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Target Source',
      steps: [
        {
          kind: 'choose_target_creature',
          target: { kind: 'raw', text: 'target creature' },
          raw: 'Choose target creature',
        } as any,
        {
          kind: 'tap_or_untap',
          target: { kind: 'raw', text: 'that creature' },
          mode: 'tap',
          raw: 'Tap that creature',
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: start }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Target Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.step.bindingKey).toBe('target-binding-program:clause-0:choice');

    const resumedRuntime = bindEffectProgramChoiceResponse(
      paused.runtime,
      {
        eventId: paused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: ['chosen-target-creature'],
        cancelled: false,
        timestamp: 2,
      },
      paused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      resumedRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Target Source' }
    );

    const permanent = ((completed.state as any).battlefield || []).find(
      (candidate: any) => candidate.id === 'chosen-target-creature'
    );
    expect(completed.status).toBe('completed');
    expect(permanent?.tapped).toBe(true);
    expect(completed.events).toMatchObject([
      {
        type: 'oracle_ir_execution',
        stepId: 'target-binding-program:clause-1:command',
        appliedStepKinds: ['tap_or_untap'],
      },
    ]);
  });

  it('populates target choice events from current battlefield state', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'friendly-creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: { id: 'friendly-card', name: 'Silvercoat Lion', type_line: 'Creature - Cat' },
          counters: {},
        } as any,
        {
          id: 'friendly-artifact',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: { id: 'artifact-card', name: 'Mind Stone', type_line: 'Artifact' },
          counters: {},
        } as any,
        {
          id: 'opponent-creature',
          controller: 'p2',
          owner: 'p2',
          tapped: false,
          card: { id: 'opponent-card', name: 'Runeclaw Bear', type_line: 'Creature - Bear' },
          counters: {},
        } as any,
      ],
    } as any);
    const program = buildEffectProgramFromOracleIR({
      id: 'target-options-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Target Source',
      steps: [
        {
          kind: 'choose_target_creature',
          target: { kind: 'raw', text: 'target creature you control' },
          raw: 'Choose target creature you control',
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: start }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Target Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.TARGET_SELECTION,
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      validTargets: [
        {
          id: 'friendly-creature',
          label: 'Silvercoat Lion',
          description: 'Creature - Cat',
        },
      ],
    });
  });

  it('filters target choice events for creatures you do not control', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'friendly-creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: { id: 'friendly-card', name: 'Silvercoat Lion', type_line: 'Creature - Cat' },
          counters: {},
        } as any,
        {
          id: 'opponent-creature',
          controller: 'p2',
          owner: 'p2',
          tapped: false,
          card: { id: 'opponent-card', name: 'Runeclaw Bear', type_line: 'Creature - Bear' },
          counters: {},
        } as any,
      ],
    } as any);
    const program = buildEffectProgramFromOracleIR({
      id: 'opponent-target-options-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Target Source',
      steps: [
        {
          kind: 'choose_target_creature',
          target: { kind: 'raw', text: "target creature you don't control" },
          raw: "Choose target creature you don't control",
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: start }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Target Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect((paused.pendingChoice?.choiceEvent as any).validTargets).toEqual([
      {
        id: 'opponent-creature',
        label: 'Runeclaw Bear',
        description: 'Creature - Bear',
      },
    ]);
  });

  it('excludes the source permanent from another-target creature prompts', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'source-1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: { id: 'source-card', name: 'Source Creature', type_line: 'Creature - Wizard' },
          counters: {},
        } as any,
        {
          id: 'other-creature',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: { id: 'other-card', name: 'Other Creature', type_line: 'Creature - Soldier' },
          counters: {},
        } as any,
      ],
    } as any);
    const program = buildEffectProgramFromOracleIR({
      id: 'another-target-options-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Target Source',
      steps: [
        {
          kind: 'choose_target_creature',
          target: { kind: 'raw', text: 'another target creature' },
          raw: 'Choose another target creature',
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: start }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Target Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect((paused.pendingChoice?.choiceEvent as any).validTargets).toEqual([
      {
        id: 'other-creature',
        label: 'Other Creature',
        description: 'Creature - Soldier',
      },
    ]);
  });

  it('populates opponent choice events from current player state', () => {
    const start = makeState({
      players: [
        { id: 'p1', name: 'Controller', life: 20, manaPool: {} } as any,
        { id: 'p2', name: 'First Opponent', life: 20, manaPool: {} } as any,
        { id: 'p3', name: 'Second Opponent', life: 20, manaPool: {} } as any,
      ],
    } as any);
    const program = buildEffectProgramFromOracleIR({
      id: 'opponent-options-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Opponent Source',
      steps: [
        {
          kind: 'choose_opponent',
          raw: 'Choose an opponent',
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: start }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Opponent Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.PLAYER_CHOICE,
      allowSelf: false,
      allowOpponents: true,
      validPlayers: [
        { id: 'p2', name: 'First Opponent' },
        { id: 'p3', name: 'Second Opponent' },
      ],
    });
  });

  it('feeds color choice bindings into chosen-color Oracle IR mana execution', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'color-binding-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Mana Source',
      steps: [
        {
          kind: 'choose_color',
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          raw: 'Choose a color',
        } as any,
        {
          kind: 'add_mana',
          who: { kind: 'you' },
          mana: '{W}',
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: 'Add one mana of the chosen color',
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Mana Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');

    const resumedRuntime = bindEffectProgramChoiceResponse(
      paused.runtime,
      {
        eventId: paused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: ['R'],
        cancelled: false,
        timestamp: 2,
      },
      paused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      resumedRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Mana Source' }
    );

    const pool = (completed.state as any).manaPool?.p1;
    expect(completed.status).toBe('completed');
    expect(pool?.red).toBe(1);
    expect(pool?.white ?? 0).toBe(0);
    expect(completed.events).toMatchObject([
      {
        type: 'oracle_ir_execution',
        stepId: 'color-binding-program:clause-1:command',
        appliedStepKinds: ['add_mana'],
      },
    ]);
  });

  it('continues standalone chosen-color mana steps after the color choice', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'standalone-color-mana-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Mana Source',
      steps: [
        {
          kind: 'add_mana',
          who: { kind: 'you' },
          mana: '{W}',
          manaOptions: ['{R}', '{G}'],
          requiresChosenMana: true,
          raw: 'Add one mana of any one color.',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['choice', 'command']);

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Mana Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect((paused.pendingChoice?.choiceEvent as any).colors).toEqual([
      { id: 'R', label: 'Red' },
      { id: 'G', label: 'Green' },
    ]);

    const resumedRuntime = bindEffectProgramChoiceResponse(
      paused.runtime,
      {
        eventId: paused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: ['G'],
        cancelled: false,
        timestamp: 2,
      },
      paused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      resumedRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Mana Source' }
    );

    expect(completed.status).toBe('completed');
    expect((completed.state as any).manaPool?.p1?.green).toBe(1);
    expect(completed.events).toMatchObject([
      {
        type: 'oracle_ir_execution',
        stepId: 'standalone-color-mana-program:clause-0:command',
        appliedStepKinds: ['add_mana'],
      },
    ]);
  });

  it('lowers choose_mode Oracle IR steps into mode-selection prompts with command continuations', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'mode-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Modal Source',
      steps: [
        {
          kind: 'choose_mode',
          minModes: 1,
          maxModes: 1,
          modes: [
            {
              label: 'Draw',
              raw: 'Draw a card.',
              steps: [
                {
                  kind: 'draw',
                  who: { kind: 'you' },
                  amount: { kind: 'number', value: 1 },
                  raw: 'Draw a card.',
                } as any,
              ],
            },
            {
              label: 'Gain',
              raw: 'You gain 2 life.',
              steps: [
                {
                  kind: 'gain_life',
                  who: { kind: 'you' },
                  amount: { kind: 'number', value: 2 },
                  raw: 'You gain 2 life.',
                } as any,
              ],
            },
          ],
          raw: 'Choose one - Draw a card; or you gain 2 life.',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['choice', 'command']);
    expect(program.steps[0]).toMatchObject({
      kind: 'choice',
      bindingKey: 'mode-program:clause-0:choice',
      choiceRequest: {
        type: ChoiceEventType.MODE_SELECTION,
        payload: {
          minModes: 1,
          maxModes: 1,
          modes: [
            { id: 'Draw', label: 'Draw', description: 'Draw a card.' },
            { id: 'Gain', label: 'Gain', description: 'You gain 2 life.' },
          ],
        },
      },
    });
    expect(program.steps[1]).toMatchObject({
      kind: 'command',
      guard: {
        bindingKey: 'mode-program:clause-0:choice',
        cancelledEquals: false,
      },
    });
  });

  it('feeds mode choice bindings into choose_mode Oracle IR command execution', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'mode-binding-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Modal Source',
      steps: [
        {
          kind: 'choose_mode',
          minModes: 1,
          maxModes: 1,
          modes: [
            {
              label: 'Draw',
              raw: 'Draw a card.',
              steps: [
                {
                  kind: 'draw',
                  who: { kind: 'you' },
                  amount: { kind: 'number', value: 1 },
                  raw: 'Draw a card.',
                } as any,
              ],
            },
            {
              label: 'Gain',
              raw: 'You gain 2 life.',
              steps: [
                {
                  kind: 'gain_life',
                  who: { kind: 'you' },
                  amount: { kind: 'number', value: 2 },
                  raw: 'You gain 2 life.',
                } as any,
              ],
            },
          ],
          raw: 'Choose one - Draw a card; or you gain 2 life.',
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Modal Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.MODE_SELECTION,
      modes: [
        { id: 'Draw', label: 'Draw' },
        { id: 'Gain', label: 'Gain' },
      ],
    });

    const resumedRuntime = bindEffectProgramChoiceResponse(
      paused.runtime,
      {
        eventId: paused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: [{ id: 'Draw', label: 'Draw' }] as any,
        cancelled: false,
        timestamp: 2,
      },
      paused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      resumedRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Modal Source' }
    );

    const player = completed.state.players.find(playerState => playerState.id === 'p1') as any;
    expect(completed.status).toBe('completed');
    expect((player.hand || []).map((card: any) => card.id)).toEqual(['drawn-card']);
    expect((player.library || []).map((card: any) => card.id)).toEqual([]);
    expect(completed.events).toMatchObject([
      {
        type: 'oracle_ir_execution',
        stepId: 'mode-binding-program:clause-0:command',
        appliedStepKinds: ['choose_mode', 'draw'],
      },
    ]);
  });

  it('scopes mode choice bindings to the matching choose_mode command', () => {
    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [
            { id: 'first-card', name: 'First Card' },
            { id: 'second-card', name: 'Second Card' },
          ],
          hand: [],
          graveyard: [],
        } as any,
      ],
    } as any);
    const program = buildEffectProgramFromOracleIR({
      id: 'multi-mode-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Modal Source',
      steps: [
        {
          kind: 'choose_mode',
          minModes: 1,
          maxModes: 1,
          modes: [
            {
              label: 'First Draw',
              raw: 'Draw a card.',
              steps: [
                {
                  kind: 'draw',
                  who: { kind: 'you' },
                  amount: { kind: 'number', value: 1 },
                  raw: 'Draw a card.',
                } as any,
              ],
            },
          ],
          raw: 'Choose one - Draw a card.',
        } as any,
        {
          kind: 'choose_mode',
          minModes: 1,
          maxModes: 1,
          modes: [
            {
              label: 'Second Draw',
              raw: 'Draw a card.',
              steps: [
                {
                  kind: 'draw',
                  who: { kind: 'you' },
                  amount: { kind: 'number', value: 1 },
                  raw: 'Draw a card.',
                } as any,
              ],
            },
          ],
          raw: 'Choose one - Draw a card.',
        } as any,
      ],
    });

    const firstPaused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Modal Source' }
    );
    const afterFirstRuntime = bindEffectProgramChoiceResponse(
      firstPaused.runtime,
      {
        eventId: firstPaused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: ['First Draw'],
        cancelled: false,
        timestamp: 2,
      },
      firstPaused.pendingChoice!.step.bindingKey
    );
    const secondPaused = runOracleEffectProgram(
      afterFirstRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Modal Source' }
    );

    expect(secondPaused.status).toBe('waiting_for_choice');
    expect(secondPaused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.MODE_SELECTION,
      modes: [{ id: 'Second Draw', label: 'Second Draw' }],
    });
    expect((secondPaused.state.players.find(player => player.id === 'p1') as any).hand.map((card: any) => card.id)).toEqual(['first-card']);

    const afterSecondRuntime = bindEffectProgramChoiceResponse(
      secondPaused.runtime,
      {
        eventId: secondPaused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: ['Second Draw'],
        cancelled: false,
        timestamp: 3,
      },
      secondPaused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      afterSecondRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Modal Source' }
    );

    expect(completed.status).toBe('completed');
    expect((completed.state.players.find(player => player.id === 'p1') as any).hand.map((card: any) => card.id)).toEqual([
      'first-card',
      'second-card',
    ]);
  });

  it('builds effect programs from Oracle text and executes deterministic Oracle IR command steps', () => {
    const { programs } = buildEffectProgramsFromOracleText({
      idPrefix: 'divination-program',
      oracleText: 'Draw a card.',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Draw Source',
    });

    expect(programs).toHaveLength(1);
    expect(programs[0]?.steps.map(step => step.kind)).toEqual(['command']);

    const result = runOracleEffectProgram(
      createEffectProgramRuntime({ program: programs[0]!, state: makeState() }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Draw Source' }
    );

    const player = result.state.players.find(playerState => playerState.id === 'p1') as any;
    expect(result.status).toBe('completed');
    expect((player.hand || []).map((card: any) => card.id)).toEqual(['drawn-card']);
    expect((player.library || []).map((card: any) => card.id)).toEqual([]);
    expect(result.events).toEqual([
      {
        type: 'oracle_ir_execution',
        stepId: 'divination-program:ability-0:clause-0:command',
        appliedStepKinds: ['draw'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
      },
    ]);
  });

  it('exposes reusable Oracle IR EffectProgram handlers for external resolution services', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'handler-factory-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Draw Source',
      steps: [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Draw a card.',
        } as any,
      ],
    });

    const result = runEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      createOracleIREffectProgramHandlers({ controllerId: 'p1', sourceId: 'source-1', sourceName: 'Draw Source' })
    );

    expect(result.status).toBe('completed');
    expect((result.state.players.find(playerState => playerState.id === 'p1') as any).hand.map((card: any) => card.id)).toEqual(['drawn-card']);
    expect(result.events).toEqual([
      {
        type: 'oracle_ir_execution',
        stepId: 'handler-factory-program:clause-0:command',
        appliedStepKinds: ['draw'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
      },
    ]);
  });

  it('feeds scry choices into Oracle IR top-library execution', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'scry-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Scry Source',
      steps: [
        {
          kind: 'scry',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Scry 1.',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['choice', 'command']);
    expect(program.steps[0]).toMatchObject({
      kind: 'choice',
      choiceRequest: { type: ChoiceEventType.SCRY },
    });

    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          library: [
            { id: 'top-a', name: 'Top A' },
            { id: 'top-b', name: 'Top B' },
            { id: 'remaining-c', name: 'Remaining C' },
          ],
          hand: [],
          graveyard: [],
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Scry Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.SCRY,
      scryCount: 1,
      cards: [{ id: 'top-a', name: 'Top A' }],
    });

    const resumedRuntime = bindEffectProgramChoiceResponse(
      paused.runtime,
      {
        eventId: paused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: { keepTopOrder: [], bottomOrder: ['top-a'] },
        cancelled: false,
        timestamp: 2,
      } as ChoiceResponse,
      paused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      resumedRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Scry Source' }
    );

    expect(completed.status).toBe('completed');
    expect((completed.state.players.find(player => player.id === 'p1') as any).library.map((card: any) => card.id)).toEqual([
      'top-b',
      'remaining-c',
      'top-a',
    ]);
    expect(completed.events).toEqual([
      {
        type: 'oracle_ir_execution',
        stepId: 'scry-program:clause-0:command',
        appliedStepKinds: ['scry'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
      },
    ]);
  });

  it('feeds surveil choices into Oracle IR top-library execution', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'surveil-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Surveil Source',
      steps: [
        {
          kind: 'surveil',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 2 },
          raw: 'Surveil 2.',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['choice', 'command']);

    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          library: [
            { id: 'top-a', name: 'Top A' },
            { id: 'top-b', name: 'Top B' },
            { id: 'remaining-c', name: 'Remaining C' },
          ],
          hand: [],
          graveyard: [{ id: 'old-graveyard', name: 'Old Graveyard' }],
        } as any,
      ],
    });

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Surveil Source' }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.SURVEIL,
      surveilCount: 2,
      cards: [
        { id: 'top-a', name: 'Top A' },
        { id: 'top-b', name: 'Top B' },
      ],
    });

    const resumedRuntime = bindEffectProgramChoiceResponse(
      paused.runtime,
      {
        eventId: paused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: { keepTopOrder: ['top-b'], toGraveyard: ['top-a'] },
        cancelled: false,
        timestamp: 2,
      } as ChoiceResponse,
      paused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      resumedRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Surveil Source' }
    );

    const player = completed.state.players.find(playerState => playerState.id === 'p1') as any;
    expect(completed.status).toBe('completed');
    expect(player.library.map((card: any) => card.id)).toEqual(['top-b', 'remaining-c']);
    expect(player.graveyard.map((card: any) => card.id)).toEqual(['old-graveyard', 'top-a']);
    expect(completed.events).toEqual([
      {
        type: 'oracle_ir_execution',
        stepId: 'surveil-program:clause-0:command',
        appliedStepKinds: ['surveil'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
      },
    ]);
  });

  it('feeds opponent and fateseal choices into Oracle IR opponent-library execution', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'fateseal-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Fateseal Source',
      steps: [
        {
          kind: 'fateseal',
          who: { kind: 'you' },
          target: { kind: 'target_opponent' },
          amount: { kind: 'number', value: 2 },
          raw: 'Fateseal 2.',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['choice', 'choice', 'command']);
    expect(program.steps[0]).toMatchObject({
      kind: 'choice',
      choiceRequest: { type: ChoiceEventType.PLAYER_CHOICE },
    });
    expect(program.steps[1]).toMatchObject({
      kind: 'choice',
      choiceRequest: { type: ChoiceEventType.FATESEAL },
    });

    const state = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          library: [],
          hand: [],
          graveyard: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          library: [
            { id: 'opp-top-a', name: 'Opponent Top A' },
            { id: 'opp-top-b', name: 'Opponent Top B' },
            { id: 'opp-remaining-c', name: 'Opponent Remaining C' },
          ],
          hand: [],
          graveyard: [],
        } as any,
      ],
    });

    const opponentPaused = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Fateseal Source' }
    );

    expect(opponentPaused.status).toBe('waiting_for_choice');
    expect(opponentPaused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.PLAYER_CHOICE,
      validPlayers: [{ id: 'p2', name: 'P2' }],
      allowSelf: false,
    });

    const afterOpponentRuntime = bindEffectProgramChoiceResponse(
      opponentPaused.runtime,
      {
        eventId: opponentPaused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: ['p2'],
        cancelled: false,
        timestamp: 2,
      },
      opponentPaused.pendingChoice!.step.bindingKey
    );
    const fatesealPaused = runOracleEffectProgram(
      afterOpponentRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Fateseal Source' }
    );

    expect(fatesealPaused.status).toBe('waiting_for_choice');
    expect(fatesealPaused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.FATESEAL,
      opponentId: 'p2',
      opponentName: 'P2',
      fatesealCount: 2,
      cards: [
        { id: 'opp-top-a', name: 'Opponent Top A' },
        { id: 'opp-top-b', name: 'Opponent Top B' },
      ],
    });

    const afterFatesealRuntime = bindEffectProgramChoiceResponse(
      fatesealPaused.runtime,
      {
        eventId: fatesealPaused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: { keepTopOrder: ['opp-top-b'], bottomOrder: ['opp-top-a'] },
        cancelled: false,
        timestamp: 3,
      } as ChoiceResponse,
      fatesealPaused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      afterFatesealRuntime,
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Fateseal Source' }
    );

    const opponent = completed.state.players.find(playerState => playerState.id === 'p2') as any;
    expect(completed.status).toBe('completed');
    expect(opponent.library.map((card: any) => card.id)).toEqual(['opp-top-b', 'opp-remaining-c', 'opp-top-a']);
    expect(completed.events).toEqual([
      {
        type: 'oracle_ir_execution',
        stepId: 'fateseal-program:clause-0:command',
        appliedStepKinds: ['fateseal'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
      },
    ]);
  });

  it('keeps unsupported multi-player top-library Oracle IR steps as command automation gaps', () => {
    const program = buildEffectProgramFromOracleIR({
      id: 'scry-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Scry Source',
      steps: [
        {
          kind: 'scry',
          who: { kind: 'each_player' },
          amount: { kind: 'number', value: 1 },
          raw: 'Each player scries 1.',
        } as any,
      ],
    });

    expect(program.steps.map(step => step.kind)).toEqual(['command']);

    const result = runOracleEffectProgram(
      createEffectProgramRuntime({ program, state: makeState() }),
      { controllerId: 'p1', sourceId: 'source-1', sourceName: 'Scry Source' }
    );

    expect(result.status).toBe('completed');
    expect(result.events).toEqual([
      {
        type: 'oracle_ir_execution',
        stepId: 'scry-program:clause-0:command',
        appliedStepKinds: [],
        skippedStepKinds: ['scry'],
        automationGapCount: 1,
        pendingOptionalStepCount: 0,
      },
    ]);
  });

  it('expands deterministic keyword steps through the keyword registry', () => {
    const program: EffectProgram = {
      id: 'keyword-program',
      controllerId: 'p1',
      sourceName: 'Keyword Source',
      steps: [
        {
          id: 'investigate-keyword',
          kind: 'keyword',
          keyword: 'investigate',
          raw: 'Investigate twice.',
          parameters: { amount: 2 },
        },
      ],
    };

    const result = runEffectProgram(createEffectProgramRuntime({ program, state: { applied: [] as string[] } }), {
      expandKeyword: createEffectProgramKeywordExpansionHandler(),
      applyCommand: ({ state, step }) => ({
        applied: [...state.applied, String((step.command as any).step.kind)],
      }),
    });

    expect(result.status).toBe('completed');
    expect(result.state.applied).toEqual(['investigate']);
    expect(result.trace.map(entry => entry.outcome)).toEqual(['expanded', 'applied']);
  });

  it('expands supported choice-requiring keyword steps through semantic Oracle IR lowering', () => {
    const program: EffectProgram = {
      id: 'keyword-choice-program',
      controllerId: 'p1',
      sourceName: 'Keyword Source',
      steps: [
        {
          id: 'scry-keyword',
          kind: 'keyword',
          keyword: 'scry',
          raw: 'Scry 2.',
          parameters: { amount: 2 },
        },
      ],
    };

    const paused = runOracleEffectProgram(
      createEffectProgramRuntime({
        program,
        state: makeState({
          players: [
            {
              id: 'p1',
              name: 'P1',
              seat: 0,
              library: [
                { id: 'top-a', name: 'Top A' },
                { id: 'top-b', name: 'Top B' },
              ],
              hand: [],
              graveyard: [],
            } as any,
          ],
        }),
      }),
      { controllerId: 'p1', sourceName: 'Keyword Source' },
      {},
      { expandKeyword: createEffectProgramKeywordExpansionHandler() }
    );

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.trace.map(entry => entry.outcome)).toEqual(['expanded', 'waiting']);
    expect(paused.pendingChoice?.choiceEvent).toMatchObject({
      type: ChoiceEventType.SCRY,
      scryCount: 2,
    });

    const resumedRuntime = bindEffectProgramChoiceResponse(
      paused.runtime,
      {
        eventId: paused.pendingChoice!.choiceEvent.id,
        playerId: 'p1',
        selections: { keepTopOrder: ['top-b'], bottomOrder: ['top-a'] },
        cancelled: false,
        timestamp: 2,
      } as ChoiceResponse,
      paused.pendingChoice!.step.bindingKey
    );
    const completed = runOracleEffectProgram(
      resumedRuntime,
      { controllerId: 'p1', sourceName: 'Keyword Source' },
      {},
      { expandKeyword: createEffectProgramKeywordExpansionHandler() }
    );

    expect(completed.status).toBe('completed');
    expect((completed.state.players.find(player => player.id === 'p1') as any).library.map((card: any) => card.id)).toEqual([
      'top-b',
      'top-a',
    ]);
  });

  it('keeps partial choice-requiring keyword steps as command automation gaps', () => {
    const program: EffectProgram = {
      id: 'keyword-choice-gap-program',
      controllerId: 'p1',
      sourceName: 'Keyword Source',
      steps: [
        {
          id: 'clash-keyword',
          kind: 'keyword',
          keyword: 'clash',
          raw: 'Clash with an opponent.',
        },
      ],
    };

    const result = runEffectProgram(createEffectProgramRuntime({ program, state: { applied: [] as string[] } }), {
      expandKeyword: createEffectProgramKeywordExpansionHandler(),
      applyCommand: ({ state, step }) => ({
        applied: [...state.applied, String((step.command as any).step.kind)],
      }),
    });

    expect(result.status).toBe('completed');
    expect(result.state.applied).toEqual(['clash']);
    expect(result.trace.map(entry => entry.outcome)).toEqual(['expanded', 'applied']);
  });

  it('audits missing and partial keyword registry coverage', () => {
    expect(getEffectProgramKeywordEntry('manifest_dread')?.oracleStepKind).toBe('manifest_dread');
    expect(auditEffectProgramKeywords(['investigate', 'scry', 'clash', 'brand new keyword'])).toEqual([
      {
        keyword: 'clash',
        status: 'partial',
        message: 'Keyword "clash" is marked partial in the EffectProgram registry.',
      },
      {
        keyword: 'brand new keyword',
        status: 'missing',
        message: 'No EffectProgram keyword registry entry for "brand new keyword".',
      },
    ]);
  });
});
