import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KnownCardRef, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { categorizeSpellWithoutPrimaryRetirement } from '../src/rules-engine/targeting.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { isOracleIrSpellPrimaryEnabled } from '../src/state/modules/oracleIrSpellExecution.js';
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

describe('oracle IR modal spell primary production default', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_SPELL_LEGACY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
    if (previousLegacy === undefined) {
      delete process.env.ORACLE_IR_SPELL_LEGACY;
    } else {
      process.env.ORACLE_IR_SPELL_LEGACY = previousLegacy;
    }
  });

  it('enables spell primary when env overrides are cleared', () => {
    expect(isOracleIrSpellPrimaryEnabled()).toBe(true);
  });

  it('resolves pre-selected draw mode through resolveTopOfStack under production default', () => {
    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    expect(categorizeSpellWithoutPrimaryRetirement('Test Charm', oracleText)?.op).toBeUndefined();

    const gameId = 'oracle_ir_default_modal_spell_draw';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'charm_default',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    };

    g.importDeckResolved(p1, [card] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: card.id,
      targets: [],
    });

    const stackItem = (g.state as any).stack?.[0];
    expect(stackItem).toBeTruthy();
    stackItem.selectedModes = ['mode_1'];

    g.resolveTopOfStack();

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const handIds = (player?.hand || (g.state as any).zones?.[p1]?.hand || [])
      .map((entry: any) => entry.id);
    expect(handIds).toEqual(['drawn-card']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues Effect Program mode selection when resolveTopOfStack has no pre-selected mode', () => {
    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_default_modal_spell_unresolved';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'charm_default_unresolved',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    };

    g.importDeckResolved(p1, [card] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: card.id,
      targets: [],
    });

    g.resolveTopOfStack();

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();
    expect((modeStep as any)?.effectProgramPrompt).toBe(true);
    expect((modeStep as any)?.modes?.map((mode: any) => mode.id)).toEqual(['Mode 1', 'Mode 2']);
  });

  it('completes draw mode via resumeEffectProgramResolution under production default', () => {
    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_default_modal_spell_ep_resume';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'charm_default_ep_resume',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    };

    g.importDeckResolved(p1, [card] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: card.id,
      targets: [],
    });

    g.resolveTopOfStack();

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

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const handIds = (player?.hand || (g.state as any).zones?.[p1]?.hand || [])
      .map((entry: any) => entry.id);
    expect(handIds).toEqual(['drawn-card']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('resolves pre-selected gain-life mode through resolveTopOfStack under production default', () => {
    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_default_modal_spell_gain_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'charm_default_gain',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    };

    g.importDeckResolved(p1, [card] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = player?.life ?? (g.state as any).life?.[p1] ?? 40;
    const libraryBefore = player.library.length;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: card.id,
      targets: [],
    });

    const stackItem = (g.state as any).stack?.[0];
    expect(stackItem).toBeTruthy();
    stackItem.selectedModes = ['mode_2'];

    g.resolveTopOfStack();

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    const lifeAfter = playerAfter?.life ?? (g.state as any).life?.[p1] ?? lifeBefore;
    expect(lifeAfter).toBe(lifeBefore + 2);
    expect((playerAfter?.library || []).length).toBe(libraryBefore);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('completes gain-life mode via resumeEffectProgramResolution under production default', () => {
    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_default_modal_spell_ep_gain_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'charm_default_ep_gain',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    };

    g.importDeckResolved(p1, [card] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = player?.life ?? (g.state as any).life?.[p1] ?? 40;
    const libraryBefore = player.library.length;

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: card.id,
      targets: [],
    });

    g.resolveTopOfStack();

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

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    const lifeAfter = playerAfter?.life ?? (g.state as any).life?.[p1] ?? lifeBefore;
    expect(lifeAfter).toBe(lifeBefore + 2);
    expect((playerAfter?.library || []).length).toBe(libraryBefore);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
