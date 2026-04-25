import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChoiceEventType } from '../../rules-engine/src/choiceEvents.js';
import {
  buildEffectProgramFromOracleIR,
  createEffectProgramRuntime,
  runEffectProgram,
  type EffectProgram,
  type EffectProgramHandlers,
} from '../../rules-engine/src/effectProgram.js';
import { createOracleIREffectProgramHandlers } from '../../rules-engine/src/effectProgramOracleRunner.js';
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

  it('preserves structured top-library selections for EffectProgram scry prompts', () => {
    const program: EffectProgram = {
      ...makeProgram(),
      steps: [
        {
          id: 'effect-program-1:clause-0:scry-choice',
          kind: 'choice',
          bindingKey: 'scry-binding-1',
          choiceRequest: {
            type: ChoiceEventType.SCRY,
            playerId: 'p1',
            description: 'Source Card: Scry 2.',
            mandatory: true,
            sourceId: 'source-1',
            sourceName: 'Source Card',
            payload: {
              cards: [
                { id: 'top-a', name: 'Top A' },
                { id: 'top-b', name: 'Top B' },
              ],
              scryCount: 2,
            },
          },
        },
      ],
    };
    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: {} }));
    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);

    expect(step).toMatchObject({
      type: 'scry',
      cards: [
        { id: 'top-a', name: 'Top A' },
        { id: 'top-b', name: 'Top B' },
      ],
      scryCount: 2,
      effectProgramPrompt: true,
      effectProgramBindingKey: 'scry-binding-1',
    });

    const choiceResponse = createEffectProgramChoiceResponse(step, {
      stepId: step.id,
      playerId: 'p1',
      selections: {
        keepTopOrder: [{ id: 'top-b', label: 'Top B' }],
        bottomOrder: ['top-a'],
      },
      cancelled: false,
      timestamp: 123,
    });

    expect(choiceResponse.selections).toEqual({
      keepTopOrder: ['top-b'],
      bottomOrder: ['top-a'],
    });
  });

  it('preserves EffectProgram explore prompt fields and selections through queueing', () => {
    const program: EffectProgram = {
      ...makeProgram(),
      steps: [
        {
          id: 'effect-program-1:clause-0:explore-choice',
          kind: 'choice',
          bindingKey: 'explore-binding-1',
          choiceRequest: {
            type: ChoiceEventType.EXPLORE_DECISION,
            playerId: 'p1',
            description: 'Explorer explores.',
            mandatory: true,
            sourceId: 'explorer-1',
            sourceName: 'Explorer',
            payload: {
              permanentId: 'explorer-1',
              permanentName: 'Explorer',
              revealedCard: { id: 'top-spell', name: 'Top Spell', type_line: 'Creature - Scout' },
              isLand: false,
            },
          },
        },
      ],
    };
    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: {} }));
    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);

    expect(step).toMatchObject({
      type: 'explore_decision',
      permanentId: 'explorer-1',
      permanentName: 'Explorer',
      revealedCard: { id: 'top-spell', name: 'Top Spell' },
      isLand: false,
      effectProgramPrompt: true,
      effectProgramBindingKey: 'explore-binding-1',
    });

    const choiceResponse = createEffectProgramChoiceResponse(step, {
      stepId: step.id,
      playerId: 'p1',
      selections: {
        permanentId: 'explorer-1',
        toGraveyard: true,
      },
      cancelled: false,
      timestamp: 123,
    });

    expect(choiceResponse.selections).toEqual({
      permanentId: 'explorer-1',
      toGraveyard: true,
    });
  });

  it('preserves EffectProgram proliferate prompt fields and selections through queueing', () => {
    const program: EffectProgram = {
      ...makeProgram(),
      steps: [
        {
          id: 'effect-program-1:clause-0:proliferate-choice',
          kind: 'choice',
          bindingKey: 'proliferate-binding-1',
          choiceRequest: {
            type: ChoiceEventType.PROLIFERATE,
            playerId: 'p1',
            description: 'Choose permanents and/or players to proliferate.',
            mandatory: true,
            sourceId: 'source-1',
            sourceName: 'Source Card',
            payload: {
              proliferateId: 'proliferate-1',
              availableTargets: [
                {
                  id: 'countered-creature',
                  name: 'Countered Creature',
                  counters: { '+1/+1': 1 },
                  isPlayer: false,
                  type: 'permanent',
                  controller: 'p1',
                },
                {
                  id: 'p2',
                  name: 'P2',
                  counters: { poison: 2 },
                  isPlayer: true,
                  type: 'player',
                },
              ],
            },
          },
        },
      ],
    };
    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: {} }));
    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);

    expect(step).toMatchObject({
      type: 'proliferate',
      proliferateId: 'proliferate-1',
      availableTargets: [
        {
          id: 'countered-creature',
          name: 'Countered Creature',
          counters: { '+1/+1': 1 },
          isPlayer: false,
          type: 'permanent',
          controller: 'p1',
        },
        {
          id: 'p2',
          name: 'P2',
          counters: { poison: 2 },
          isPlayer: true,
          type: 'player',
        },
      ],
      effectProgramPrompt: true,
      effectProgramBindingKey: 'proliferate-binding-1',
    });

    const choiceResponse = createEffectProgramChoiceResponse(step, {
      stepId: step.id,
      playerId: 'p1',
      selections: {
        selectedTargetIds: ['countered-creature', 'p2'],
      },
      cancelled: false,
      timestamp: 123,
    });

    expect(choiceResponse.selections).toEqual(['countered-creature', 'p2']);
  });

  it('preserves EffectProgram clash prompt fields and selections through queueing', () => {
    const program: EffectProgram = {
      ...makeProgram(),
      steps: [
        {
          id: 'effect-program-1:clause-0:clash-choice',
          kind: 'choice',
          bindingKey: 'clash-binding-1',
          choiceRequest: {
            type: ChoiceEventType.CLASH,
            playerId: 'p1',
            description: 'Source Card: Clash with an opponent.',
            mandatory: true,
            sourceId: 'source-1',
            sourceName: 'Source Card',
            payload: {
              revealedCard: { id: 'top-card', name: 'Top Card', cmc: 4 },
              opponentId: 'p2',
            },
          },
        },
      ],
    };
    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: {} }));
    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);

    expect(step).toMatchObject({
      type: 'clash',
      revealedCard: { id: 'top-card', name: 'Top Card', cmc: 4 },
      opponentId: 'p2',
      effectProgramPrompt: true,
      effectProgramBindingKey: 'clash-binding-1',
    });

    const choiceResponse = createEffectProgramChoiceResponse(step, {
      stepId: step.id,
      playerId: 'p1',
      selections: {
        putOnBottom: true,
      },
      cancelled: false,
      timestamp: 123,
    });

    expect(choiceResponse.selections).toEqual({ putOnBottom: true });
  });

  it('preserves EffectProgram fateseal prompt fields through queueing', () => {
    const program: EffectProgram = {
      ...makeProgram(),
      steps: [
        {
          id: 'effect-program-1:clause-0:fateseal-choice',
          kind: 'choice',
          bindingKey: 'fateseal-binding-1',
          choiceRequest: {
            type: ChoiceEventType.FATESEAL,
            playerId: 'p1',
            description: 'Source Card: Fateseal 2.',
            mandatory: true,
            sourceId: 'source-1',
            sourceName: 'Source Card',
            payload: {
              opponentId: 'p2',
              opponentName: 'P2',
              cards: [
                { id: 'opp-top-a', name: 'Opponent Top A' },
                { id: 'opp-top-b', name: 'Opponent Top B' },
              ],
              fatesealCount: 2,
            },
          },
        },
      ],
    };
    const paused = runEffectProgram(createEffectProgramRuntime({ program, state: {} }));
    const step = queueEffectProgramChoice(gameId, paused.pendingChoice!);

    expect(step).toMatchObject({
      type: 'fateseal',
      opponentId: 'p2',
      opponentName: 'P2',
      cards: [
        { id: 'opp-top-a', name: 'Opponent Top A' },
        { id: 'opp-top-b', name: 'Opponent Top B' },
      ],
      fatesealCount: 2,
      effectProgramPrompt: true,
      effectProgramBindingKey: 'fateseal-binding-1',
    });

    const choiceResponse = createEffectProgramChoiceResponse(step, {
      stepId: step.id,
      playerId: 'p1',
      selections: {
        keepTopOrder: [{ id: 'opp-top-b', label: 'Opponent Top B' }],
        bottomOrder: ['opp-top-a'],
      },
      cancelled: false,
      timestamp: 123,
    });

    expect(choiceResponse.selections).toEqual({
      keepTopOrder: ['opp-top-b'],
      bottomOrder: ['opp-top-a'],
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

  it('hydrates effect-program state from game libraries and syncs library changes back', () => {
    const game = {
      state: {
        id: gameId,
        format: 'commander',
        players: [{ id: 'p1', name: 'P1', seat: 0 }],
        startingLife: 40,
        life: {},
        turnPlayer: 'p1',
        priority: 'p1',
        stack: [],
        battlefield: [],
        commandZone: {},
        phase: 'pre_game',
        active: true,
        zones: { p1: { libraryCount: 2 } },
      } as any,
      libraries: new Map<string, any[]>([
        ['p1', [
          { id: 'top-a', name: 'Top A' },
          { id: 'top-b', name: 'Top B' },
        ]],
      ]),
      seq: 3,
      bumpSeq() {
        this.seq += 1;
      },
    };
    const program: EffectProgram = {
      id: 'library-program',
      controllerId: 'p1',
      sourceId: 'source-1',
      sourceName: 'Library Source',
      steps: [
        {
          id: 'library-program:choice',
          kind: 'choice',
          bindingKey: 'top-library-choice',
          choiceRequest: {
            type: ChoiceEventType.SCRY,
            playerId: 'p1',
            description: 'Library Source: Scry 1.',
            mandatory: true,
            payload: { scryCount: 1 },
          },
        },
        {
          id: 'library-program:command',
          kind: 'command',
          guard: { bindingKey: 'top-library-choice', cancelledEquals: false, onFalse: 'skip' },
          command: { kind: 'rotate_library' },
        },
      ],
    };
    const handlers: EffectProgramHandlers<any> = {
      createChoiceEvent: ({ state, step }) => ({
        id: 'library-choice-event',
        type: ChoiceEventType.SCRY,
        playerId: 'p1',
        description: step.choiceRequest?.description || 'Scry 1.',
        mandatory: true,
        timestamp: 1,
        cards: [(((state.players[0] as any).library || []) as any[])[0]],
        scryCount: 1,
      }),
      applyCommand: ({ state }) => {
        const player = state.players[0] as any;
        const library = Array.isArray(player.library) ? player.library : [];
        return {
          ...state,
          players: [
            {
              ...player,
              library: [library[1], library[0]].filter(Boolean),
            },
          ],
        };
      },
    };

    const started = startEffectProgramResolution({
      game,
      gameId,
      program,
      handlers: handlers as any,
      persistPrompt: false,
    });

    expect(started.status).toBe('waiting_for_choice');
    expect(started.queuedStep).toMatchObject({
      type: 'scry',
      cards: [{ id: 'top-a', name: 'Top A' }],
      scryCount: 1,
    });
    expect((game.state.players[0] as any).library).toBeUndefined();

    const completedStep = ResolutionQueueManager.completeStep(gameId, started.queuedStep!.id, {
      stepId: started.queuedStep!.id,
      playerId: 'p1',
      selections: { keepTopOrder: [], bottomOrder: ['top-a'] },
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

    expect(resumed.status).toBe('completed');
    expect((game.libraries.get('p1') || []).map((card: any) => card.id)).toEqual(['top-b', 'top-a']);
    expect((game.state.players[0] as any).library).toBeUndefined();
    expect(game.state.zones.p1.libraryCount).toBe(2);
  });

  it('runs Oracle IR top-library prompts through the resolution service with live libraries', () => {
    const game = {
      state: {
        id: gameId,
        format: 'commander',
        players: [{ id: 'p1', name: 'P1', seat: 0 }],
        startingLife: 40,
        life: {},
        turnPlayer: 'p1',
        priority: 'p1',
        stack: [],
        battlefield: [],
        commandZone: {},
        phase: 'pre_game',
        active: true,
        zones: { p1: { libraryCount: 2 } },
      } as any,
      libraries: new Map<string, any[]>([
        ['p1', [
          { id: 'top-a', name: 'Top A' },
          { id: 'top-b', name: 'Top B' },
        ]],
      ]),
      seq: 11,
      bumpSeq() {
        this.seq += 1;
      },
    };
    const program = buildEffectProgramFromOracleIR({
      id: 'live-scry-program',
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

    const started = startEffectProgramResolution({
      game,
      gameId,
      program,
      handlers: createOracleIREffectProgramHandlers({ controllerId: 'p1', sourceId: 'source-1', sourceName: 'Scry Source' }) as any,
      persistPrompt: false,
    });

    expect(started.status).toBe('waiting_for_choice');
    expect(started.queuedStep).toMatchObject({
      type: 'scry',
      cards: [{ id: 'top-a', name: 'Top A' }],
      scryCount: 1,
      effectProgramPrompt: true,
    });
    expect((game.state.players[0] as any).library).toBeUndefined();

    const completedStep = ResolutionQueueManager.completeStep(gameId, started.queuedStep!.id, {
      stepId: started.queuedStep!.id,
      playerId: 'p1',
      selections: { keepTopOrder: [], bottomOrder: ['top-a'] },
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

    expect(resumed.status).toBe('completed');
    expect((game.libraries.get('p1') || []).map((card: any) => card.id)).toEqual(['top-b', 'top-a']);
    expect((game.state.players[0] as any).library).toBeUndefined();
    expect(game.state.zones.p1.libraryCount).toBe(2);
  });

  it('syncs temporary effect-program graveyard snapshots into zones', () => {
    const game = {
      state: {
        id: gameId,
        format: 'commander',
        players: [{ id: 'p1', name: 'P1', seat: 0 }],
        startingLife: 40,
        life: {},
        turnPlayer: 'p1',
        priority: 'p1',
        stack: [],
        battlefield: [],
        commandZone: {},
        phase: 'pre_game',
        active: true,
        zones: { p1: { graveyard: [], graveyardCount: 0 } },
      } as any,
      libraries: new Map<string, any[]>(),
      seq: 5,
      bumpSeq() {
        this.seq += 1;
      },
    };
    const program: EffectProgram = {
      id: 'graveyard-sync-program',
      controllerId: 'p1',
      steps: [
        {
          id: 'graveyard-sync-command',
          kind: 'command',
          command: { kind: 'put_graveyard_snapshot' },
        },
      ],
    };

    const result = startEffectProgramResolution({
      game,
      gameId,
      program,
      handlers: {
        applyCommand: ({ state }) => ({
          ...state,
          players: [
            {
              ...state.players[0],
              graveyard: [{ id: 'grave-a', name: 'Grave A' }],
            } as any,
          ],
        }),
      } as any,
      persistPrompt: false,
    });

    expect(result.status).toBe('completed');
    expect((game.state.players[0] as any).graveyard).toBeUndefined();
    expect(game.state.zones.p1.graveyard).toEqual([{ id: 'grave-a', name: 'Grave A', zone: 'graveyard', faceDown: false }]);
    expect(game.state.zones.p1.graveyardCount).toBe(1);
  });
});