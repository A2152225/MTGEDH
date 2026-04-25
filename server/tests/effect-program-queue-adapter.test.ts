import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChoiceEventType } from '../../rules-engine/src/choiceEvents.js';
import {
  createEffectProgramRuntime,
  runEffectProgram,
  type EffectProgram,
  type EffectProgramHandlers,
} from '../../rules-engine/src/effectProgram.js';
import {
  appendEffectProgramPromptEvent,
  buildEffectProgramPromptSnapshot,
  clearEffectProgramRuntimes,
  createEffectProgramChoiceResponse,
  getEffectProgramRuntimeForStep,
  queueEffectProgramChoice,
  readEffectProgramQueueMetadata,
  resumeEffectProgramResolution,
  startEffectProgramResolution,
} from '../src/state/effects/index.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const gameId = 't_effect_program_queue_adapter';

function makeProgram(): EffectProgram {
  return {
    id: 'effect-program-1',
    controllerId: 'p1',
    sourceId: 'source-1',
    sourceName: 'Source Card',
    steps: [
      {
        id: 'effect-program-1:clause-0:choice',
        kind: 'choice',
        bindingKey: 'choice-binding-1',
        clause: {
          abilityIndex: 0,
          clauseIndex: 0,
          raw: 'You may draw a card.',
        },
        choiceRequest: {
          type: ChoiceEventType.OPTION_CHOICE,
          playerId: 'p1',
          description: 'Source Card: You may draw a card.',
          mandatory: false,
          sourceId: 'source-1',
          sourceName: 'Source Card',
          payload: {
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
            minSelections: 1,
            maxSelections: 1,
          },
        },
      },
    ],
  };
}

describe('effect-program queue adapter', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    clearEffectProgramRuntimes(gameId);
  });
  

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    clearEffectProgramRuntimes(gameId);
  });

  it('queues choice pauses with effect-program resume metadata', () => {
    const paused = runEffectProgram(createEffectProgramRuntime({ program: makeProgram(), state: {} }));

    expect(paused.status).toBe('waiting_for_choice');
    expect(paused.pendingChoice).toBeDefined();

    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!, { priority: -10 });
    const queue = ResolutionQueueManager.getQueue(gameId);

    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]?.id).toBe(step.id);
    expect(step).toMatchObject({
      type: 'option_choice',
      playerId: 'p1',
      description: 'Source Card: You may draw a card.',
      mandatory: false,
      sourceId: 'source-1',
      sourceName: 'Source Card',
      priority: -10,
      effectProgramPrompt: true,
      effectProgramId: 'effect-program-1',
      effectProgramSourceId: 'source-1',
      effectProgramSourceName: 'Source Card',
      effectProgramCursor: 0,
      effectProgramStepId: 'effect-program-1:clause-0:choice',
      effectProgramBindingKey: 'choice-binding-1',
      effectProgramClause: {
        abilityIndex: 0,
        clauseIndex: 0,
        raw: 'You may draw a card.',
      },
    });

    expect(readEffectProgramQueueMetadata(step)).toEqual({
      effectProgramId: 'effect-program-1',
      effectProgramSourceId: 'source-1',
      effectProgramSourceName: 'Source Card',
      effectProgramCursor: 0,
      effectProgramStepId: 'effect-program-1:clause-0:choice',
      effectProgramBindingKey: 'choice-binding-1',
      effectProgramClause: {
        abilityIndex: 0,
        clauseIndex: 0,
        raw: 'You may draw a card.',
      },
    });
  });

  it('creates choice responses from queued effect-program steps', () => {
    const paused = runEffectProgram(createEffectProgramRuntime({ program: makeProgram(), state: {} }));
    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);

    const choiceResponse = createEffectProgramChoiceResponse(step, {
      stepId: step.id,
      playerId: 'p1',
      selections: [{ id: 'yes', label: 'Yes' }] as any,
      cancelled: false,
      timestamp: 123,
    });

    expect(choiceResponse).toEqual({
      eventId: step.choiceEvent?.id,
      playerId: 'p1',
      selections: ['yes'],
      cancelled: false,
      timestamp: 123,
    });
  });

  it('preserves EffectProgram mode-selection prompt fields through queueing and snapshots', () => {
    const program: EffectProgram = {
      ...makeProgram(),
      steps: [
        {
          id: 'effect-program-1:clause-0:mode-choice',
          kind: 'choice',
          bindingKey: 'mode-binding-1',
          clause: {
            abilityIndex: 0,
            clauseIndex: 0,
            raw: 'Choose one or both.',
          },
          choiceRequest: {
            type: ChoiceEventType.MODE_SELECTION,
            playerId: 'p1',
            description: 'Source Card: Choose one or both.',
            mandatory: true,
            sourceId: 'source-1',
            sourceName: 'Source Card',
            payload: {
              modes: [
                { id: 'draw', label: 'Draw a card' },
                { id: 'gain', label: 'Gain 3 life' },
              ],
              minModes: 1,
              maxModes: 2,
              allowDuplicates: false,
            },
          },
        },
      ],
    };
    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: {} }));

    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);

    expect(step).toMatchObject({
      type: 'mode_selection',
      playerId: 'p1',
      mandatory: true,
      modes: [
        { id: 'draw', label: 'Draw a card' },
        { id: 'gain', label: 'Gain 3 life' },
      ],
      minModes: 1,
      maxModes: 2,
      allowDuplicates: false,
      effectProgramPrompt: true,
      effectProgramStepId: 'effect-program-1:clause-0:mode-choice',
      effectProgramBindingKey: 'mode-binding-1',
    });

    const snapshot = buildEffectProgramPromptSnapshot(step);
    expect(snapshot?.queuedResolutionStep).toMatchObject({
      type: 'mode_selection',
      modes: [
        { id: 'draw', label: 'Draw a card' },
        { id: 'gain', label: 'Gain 3 life' },
      ],
      minModes: 1,
      maxModes: 2,
      allowDuplicates: false,
    });
    expect((snapshot?.queuedResolutionStep as any).effectProgramId).toBeUndefined();
    expect((snapshot?.queuedResolutionStep as any).effectProgramPrompt).toBeUndefined();
    expect((snapshot?.queuedResolutionStep as any).effectProgramBindingKey).toBeUndefined();
  });

  it('preserves EffectProgram target and color prompt fields through queueing', () => {
    const targetProgram: EffectProgram = {
      ...makeProgram(),
      steps: [
        {
          id: 'effect-program-1:clause-0:target-choice',
          kind: 'choice',
          bindingKey: 'target-binding-1',
          choiceRequest: {
            type: ChoiceEventType.TARGET_SELECTION,
            playerId: 'p1',
            description: 'Source Card: Choose target creature.',
            mandatory: true,
            sourceId: 'source-1',
            sourceName: 'Source Card',
            payload: {
              validTargets: [{ id: 'creature-1', label: 'Runeclaw Bear' }],
              targetTypes: ['creature'],
              minTargets: 1,
              maxTargets: 1,
              targetDescription: 'target creature',
            },
          },
        },
      ],
    };
    const colorProgram: EffectProgram = {
      ...makeProgram(),
      id: 'effect-program-2',
      steps: [
        {
          id: 'effect-program-2:clause-0:color-choice',
          kind: 'choice',
          bindingKey: 'color-binding-1',
          choiceRequest: {
            type: ChoiceEventType.COLOR_CHOICE,
            playerId: 'p1',
            description: 'Source Card: Choose a color.',
            mandatory: true,
            sourceId: 'source-1',
            sourceName: 'Source Card',
            payload: {
              colors: [{ id: 'G', label: 'Green' }],
              minColors: 1,
              maxColors: 1,
            },
          },
        },
      ],
    };

    const targetPaused = runEffectProgram(createEffectProgramRuntime({ program: targetProgram, state: {} }));
    const targetStep = queueEffectProgramChoice(gameId, targetPaused.pendingChoice!);
    const colorPaused = runEffectProgram(createEffectProgramRuntime({ program: colorProgram, state: {} }));
    const colorStep = queueEffectProgramChoice(gameId, colorPaused.pendingChoice!);

    expect(targetStep).toMatchObject({
      type: 'target_selection',
      validTargets: [{ id: 'creature-1', label: 'Runeclaw Bear' }],
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'target creature',
      effectProgramPrompt: true,
      effectProgramBindingKey: 'target-binding-1',
    });
    expect(colorStep).toMatchObject({
      type: 'color_choice',
      colors: [{ id: 'G', label: 'Green' }],
      minColors: 1,
      maxColors: 1,
      effectProgramPrompt: true,
      effectProgramId: 'effect-program-2',
      effectProgramBindingKey: 'color-binding-1',
    });
  });

  it('builds and appends canonical prompt snapshots for persistence', () => {
    const paused = runEffectProgram(createEffectProgramRuntime({ program: makeProgram(), state: {} }));
    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);
    const appended: any[] = [];

    const snapshot = buildEffectProgramPromptSnapshot(step);
    expect(snapshot).toMatchObject({
      playerId: 'p1',
      sourceId: 'source-1',
      effectProgram: {
        effectProgramId: 'effect-program-1',
        effectProgramCursor: 0,
        effectProgramStepId: 'effect-program-1:clause-0:choice',
        effectProgramBindingKey: 'choice-binding-1',
      },
    });
    expect(snapshot?.queuedResolutionStep.id).toBe(step.id);
    expect((snapshot?.queuedResolutionStep as any).effectProgramId).toBeUndefined();
    expect((snapshot?.queuedResolutionStep as any).effectProgramPrompt).toBeUndefined();
    expect((snapshot?.queuedResolutionStep as any).effectProgramCursor).toBeUndefined();

    const didAppend = appendEffectProgramPromptEvent({ seq: 42 }, gameId, step, {
      additionalPayload: { reason: 'test' },
      appendEventFn: (eventGameId, seq, type, payload) => {
        appended.push({ eventGameId, seq, type, payload });
      },
    });

    expect(didAppend).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      eventGameId: gameId,
      seq: 42,
      type: 'resolveTopOfStackPrompt',
      payload: {
        playerId: 'p1',
        sourceId: 'source-1',
        queuedResolutionStep: { id: step.id },
        effectProgram: {
          effectProgramId: 'effect-program-1',
          effectProgramStepId: 'effect-program-1:clause-0:choice',
          effectProgramBindingKey: 'choice-binding-1',
        },
        reason: 'test',
      },
    });
  });

  it('starts and resumes effect programs through queued responses', () => {
    const game = {
      state: { count: 0 } as any,
      seq: 7,
      bumpSeq() {
        this.seq += 1;
      },
    };
    const handlers: EffectProgramHandlers<any> = {
      applyCommand: ({ state }) => ({ ...state, count: Number((state as any).count || 0) + 1 }),
    };
    const program: EffectProgram = {
      ...makeProgram(),
      steps: [
        ...makeProgram().steps,
        {
          id: 'effect-program-1:clause-1:command',
          kind: 'command',
          guard: { bindingKey: 'choice-binding-1', selectionIncludes: 'yes', onFalse: 'skip' },
          command: { kind: 'increment' },
        },
      ],
    };

    const started = startEffectProgramResolution({
      game,
      gameId,
      program,
      handlers: handlers as any,
      state: game.state,
      persistPrompt: false,
    });

    expect(started.status).toBe('waiting_for_choice');
    expect(started.queuedStep).toBeDefined();
    expect(getEffectProgramRuntimeForStep(gameId, started.queuedStep!.id)).toBeDefined();

    const completedStep = ResolutionQueueManager.completeStep(gameId, started.queuedStep!.id, {
      stepId: started.queuedStep!.id,
      playerId: 'p1',
      selections: ['yes'],
      cancelled: false,
      timestamp: 100,
    });

    const resumed = resumeEffectProgramResolution({
      game,
      gameId,
      step: completedStep!,
      response: completedStep!.response!,
      persistPrompt: false,
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.status).toBe('completed');
    expect(game.state.count).toBe(1);
    expect(getEffectProgramRuntimeForStep(gameId, started.queuedStep!.id)).toBeUndefined();
  });
});