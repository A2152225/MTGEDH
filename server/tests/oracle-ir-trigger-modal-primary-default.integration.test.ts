import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { isOracleIrTriggerPrimaryEnabled } from '../src/state/modules/oracleIrTriggerExecution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function ensureZonesForPlayer(g: any, pid: PlayerID) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
}

function setupPlayerLibrary(g: any, pid: PlayerID, libraryIds: string[]) {
  const player = (g.state as any).players.find((entry: any) => entry.id === pid);
  player.library = libraryIds.map((id) => ({ id, name: id, zone: 'library' }));
  ensureZonesForPlayer(g, pid);
  (g.state as any).zones[pid].library = player.library.map((card: any) => ({ ...card }));
  (g.state as any).zones[pid].libraryCount = player.library.length;
  g.libraries = g.libraries || new Map();
  g.libraries.set(pid, player.library.map((card: any) => ({ ...card })));
}

const MODAL_ORACLE_TEXT = 'Choose one —\n• Draw a card.\n• You gain 2 life.';

describe('oracle IR trigger modal primary production default', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_TRIGGER_LEGACY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
    if (previousLegacy === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    } else {
      process.env.ORACLE_IR_TRIGGER_LEGACY = previousLegacy;
    }
  });

  it('enables trigger primary when env overrides are cleared', () => {
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);
  });

  it('applies pre-selected draw mode from mode_1 under production default', () => {
    const gameId = 'oracle_ir_default_trigger_modal_draw';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['drawn-card']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Modal Trigger',
      MODAL_ORACLE_TEXT,
      {
        id: 'trigger-modal-default-1',
        source: 'source-1',
        selectedModes: ['mode_1'],
      },
    );

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    const handIds = (player?.hand || (game.state as any).zones?.[p1]?.hand || [])
      .map((entry: any) => entry.id);
    expect(handIds).toEqual(['drawn-card']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues Effect Program mode selection when trigger has no pre-selected mode', () => {
    const gameId = 'oracle_ir_default_trigger_modal_unresolved';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['drawn-card']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Modal Trigger',
      MODAL_ORACLE_TEXT,
      {
        id: 'trigger-modal-default-unresolved',
        source: 'source-1',
      },
    );

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();
    expect((modeStep as any)?.effectProgramPrompt).toBe(true);
    expect((modeStep as any)?.modes?.map((mode: any) => mode.id)).toEqual(['Mode 1', 'Mode 2']);
  });

  it('completes draw mode via resumeEffectProgramResolution under production default', () => {
    const gameId = 'oracle_ir_default_trigger_modal_ep_resume';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['drawn-card']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Modal Trigger',
      MODAL_ORACLE_TEXT,
      {
        id: 'trigger-modal-default-ep',
        source: 'source-1',
      },
    );

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(modeStep!.id), {
      stepId: String(modeStep!.id),
      playerId: p1,
      selections: [{ id: 'Mode 1', label: 'Draw a card.' }],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = resumeEffectProgramResolution({
      game: ctx,
      gameId,
      step: completedStep!,
      response: completedStep!.response!,
      persistPrompt: false,
    });

    expect(resumed.status).toBe('completed');

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    const handIds = (player?.hand || (game.state as any).zones?.[p1]?.hand || [])
      .map((entry: any) => entry.id);
    expect(handIds).toEqual(['drawn-card']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('applies pre-selected gain-life mode from mode_2 under production default', () => {
    const gameId = 'oracle_ir_default_trigger_modal_gain_life';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['lib-1']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = player?.life ?? (game.state as any).life?.[p1] ?? 40;
    const libraryBefore = player.library.length;

    executeTriggerEffect(
      ctx,
      p1,
      'Modal Trigger',
      MODAL_ORACLE_TEXT,
      {
        id: 'trigger-modal-default-gain',
        source: 'source-1',
        selectedModes: ['mode_2'],
      },
    );

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    const lifeAfter = playerAfter?.life ?? (game.state as any).life?.[p1] ?? lifeBefore;
    expect(lifeAfter).toBe(lifeBefore + 2);
    expect((playerAfter?.library || []).length).toBe(libraryBefore);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('completes gain-life mode via resumeEffectProgramResolution under production default', () => {
    const gameId = 'oracle_ir_default_trigger_modal_ep_gain_life';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['lib-1']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = player?.life ?? (game.state as any).life?.[p1] ?? 40;
    const libraryBefore = player.library.length;

    executeTriggerEffect(
      ctx,
      p1,
      'Modal Trigger',
      MODAL_ORACLE_TEXT,
      {
        id: 'trigger-modal-default-ep-gain',
        source: 'source-1',
      },
    );

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(modeStep!.id), {
      stepId: String(modeStep!.id),
      playerId: p1,
      selections: [{ id: 'Mode 2', label: 'You gain 2 life.' }],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = resumeEffectProgramResolution({
      game: ctx,
      gameId,
      step: completedStep!,
      response: completedStep!.response!,
      persistPrompt: false,
    });

    expect(resumed.status).toBe('completed');

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    const lifeAfter = playerAfter?.life ?? (game.state as any).life?.[p1] ?? lifeBefore;
    expect(lifeAfter).toBe(lifeBefore + 2);
    expect((playerAfter?.library || []).length).toBe(libraryBefore);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
