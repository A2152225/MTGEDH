import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KnownCardRef, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { categorizeSpell, resolveSpell } from '../src/rules-engine/targeting.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import {
  isOracleIrSpellLegacyForced,
  isOracleIrSpellPrimaryEnabled,
  isOracleIrTriggerLegacyForced,
  isOracleIrTriggerPrimaryEnabled,
} from '../src/state/modules/oracleIrFeatureFlags.js';
import { isCategorizeOpcodeDeletedFromResolveSpell } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { resumeLegacyModalSpellModeSelection } from '../src/state/modules/stackResolveSpellLegacyModalUtils.js';
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
    exile: [],
    exileCount: 0,
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

function castAndResolve(
  g: any,
  p1: PlayerID,
  card: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'>,
  libraryIds: string[],
  afterImport?: (game: any) => void,
) {
  g.importDeckResolved(p1, [card] as any);
  g.drawCards(p1, 1);
  setupPlayerLibrary(g, p1, libraryIds);
  ensureZonesForPlayer(g, p1);
  if (afterImport) {
    afterImport(g);
  }

  (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
  (g.state as any).turnPlayer = p1;
  (g.state as any).priority = p1;

  g.applyEvent!({
    type: 'castSpell',
    playerId: p1,
    cardId: card.id,
    targets: [],
  });

  expect((g.state as any).stack?.length || 0).toBe(1);
  g.resolveTopOfStack();
}

describe('oracle IR legacy forced integration', () => {
  const previousSpellPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousSpellLegacy = process.env.ORACLE_IR_SPELL_LEGACY;
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const previousTriggerLegacy = process.env.ORACLE_IR_TRIGGER_LEGACY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  afterEach(() => {
    if (previousSpellPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousSpellPrimary;
    }
    if (previousSpellLegacy === undefined) {
      delete process.env.ORACLE_IR_SPELL_LEGACY;
    } else {
      process.env.ORACLE_IR_SPELL_LEGACY = previousSpellLegacy;
    }
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
    if (previousTriggerLegacy === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    } else {
      process.env.ORACLE_IR_TRIGGER_LEGACY = previousTriggerLegacy;
    }
  });

  it('forces spell legacy path via ORACLE_IR_SPELL_PRIMARY=0 (P4e)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    expect(isOracleIrSpellLegacyForced()).toBe(true);
    expect(isOracleIrSpellPrimaryEnabled()).toBe(false);

    // LEGACY alias no longer forces opt-out when PRIMARY is unset.
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    process.env.ORACLE_IR_SPELL_LEGACY = '1';
    expect(isOracleIrSpellPrimaryEnabled()).toBe(true);
    expect(isOracleIrSpellLegacyForced()).toBe(false);
  });

  it('forces trigger legacy path via ORACLE_IR_TRIGGER_PRIMARY=0 (P4e)', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
    expect(isOracleIrTriggerLegacyForced()).toBe(true);
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(false);

    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    process.env.ORACLE_IR_TRIGGER_LEGACY = '1';
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);
    expect(isOracleIrTriggerLegacyForced()).toBe(false);
  });

  it('draw categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Draw two cards.';
    const spellSpec = categorizeSpell('Test Divination', oracleText);
    expect(spellSpec?.op).toBe('DRAW_CARDS');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_draw';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'draw_legacy',
      name: 'Test Divination',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, ['lib-1', 'lib-2', 'lib-3']);

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const handCount = (g.state as any).zones?.[p1]?.hand?.length ?? player?.hand?.length ?? 0;
    const libraryCount = ctx.libraries?.get(p1)?.length ?? player?.library?.length ?? 0;
    // Stack resolve uses deleted categorize op — no draw under SPELL_LEGACY.
    expect(handCount).toBe(0);
    expect(libraryCount).toBe(3);
  });

  it('applies draw triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_draw';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['lib-1', 'lib-2']);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      { id: 'trigger-legacy-1', source: 'mulldrifter-1' },
    );

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    const handCount = (game.state as any).zones?.[p1]?.hand?.length ?? player?.hand?.length ?? 0;
    const libraryCount = ctx.libraries?.get(p1)?.length ?? player?.library?.length ?? 0;
    expect(handCount).toBe(2);
    expect(libraryCount).toBe(0);
  });

  it('applies gain-life triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_gain_life';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const lifeBefore = (game.state as any).players.find((entry: any) => entry.id === p1)?.life ?? 40;

    executeTriggerEffect(
      ctx,
      p1,
      'Soul Warden',
      'You gain 1 life.',
      { id: 'trigger-legacy-gain', source: 'warden-1' },
    );

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (game.state as any).life?.[p1]).toBe(lifeBefore + 1);
  });

  it('gain-life categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'You gain 3 life.';
    const spellSpec = categorizeSpell('Healing Salve', oracleText);
    expect(spellSpec?.op).toBe('GAIN_LIFE');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_gain_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const playerBefore = (g.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = playerBefore?.life ?? (g.state as any).life?.[p1] ?? 40;
    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'gain_legacy',
      name: 'Healing Salve',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, ['lib-1']);

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (g.state as any).life?.[p1]).toBe(lifeBefore);
  });

  it('applies lose-life triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_lose_life';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const lifeBefore = (game.state as any).players.find((entry: any) => entry.id === p1)?.life ?? 40;

    executeTriggerEffect(
      ctx,
      p1,
      'Shock',
      'You lose 2 life.',
      { id: 'trigger-legacy-lose', source: 'shock-1' },
    );

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (game.state as any).life?.[p1]).toBe(lifeBefore - 2);
  });

  it('resolves pre-selected modal draw mode via IR fallback when spell legacy is forced', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    expect(categorizeSpell('Test Charm', oracleText)).toBeNull();

    const gameId = 'oracle_ir_legacy_forced_modal_spell_draw';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'charm_legacy',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'charm_legacy',
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

  it('resolves pre-selected modal gain-life mode via IR fallback when spell legacy is forced', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_legacy_forced_modal_spell_gain_life';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);
    (g.state as any).life = { [p1]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'charm_legacy_gain',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'charm_legacy_gain',
      targets: [],
    });

    const stackItem = (g.state as any).stack?.[0];
    expect(stackItem).toBeTruthy();
    stackItem.selectedModes = ['mode_2'];

    const lifeBefore = (g.state as any).players.find((entry: any) => entry.id === p1)?.life ?? 40;

    g.resolveTopOfStack();

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (g.state as any).life?.[p1]).toBe(lifeBefore + 2);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues legacy modal MODE_SELECTION when resolveTopOfStack has no pre-selected mode', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_legacy_forced_modal_spell_unresolved';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'charm_legacy_unresolved',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'charm_legacy_unresolved',
      targets: [],
    });

    g.resolveTopOfStack();

    expect((g.state as any).stack?.length || 0).toBe(1);

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();
    expect((modeStep as any)?.modeSelectionPurpose).toBe('modalSpellResolve');
    expect((modeStep as any)?.effectProgramPrompt).toBeFalsy();
    expect((modeStep as any)?.modes?.map((mode: any) => mode.id)).toEqual(['mode_1', 'mode_2']);
  });

  it('completes legacy modal draw mode via resumeLegacyModalSpellModeSelection', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_legacy_forced_modal_spell_resume';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'charm_legacy_resume',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'charm_legacy_resume',
      targets: [],
    });

    g.resolveTopOfStack();

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(modeStep!.id), {
      stepId: String(modeStep!.id),
      playerId: p1,
      selections: ['mode_1'],
      cancelled: false,
      timestamp: Date.now(),
    });

    expect(resumeLegacyModalSpellModeSelection(ctx, completedStep!, completedStep!.response!)).toBe(true);

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const handIds = (player?.hand || (g.state as any).zones?.[p1]?.hand || [])
      .map((entry: any) => entry.id);
    expect(handIds).toEqual(['drawn-card']);
    expect((g.state as any).stack?.length || 0).toBe(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('completes legacy modal gain-life mode via resumeLegacyModalSpellModeSelection', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const gameId = 'oracle_ir_legacy_forced_modal_spell_resume_gain';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);
    (g.state as any).life = { [p1]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'charm_legacy_resume_gain',
      name: 'Test Charm',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['drawn-card']);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'charm_legacy_resume_gain',
      targets: [],
    });

    g.resolveTopOfStack();

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();

    const lifeBefore = (g.state as any).players.find((entry: any) => entry.id === p1)?.life ?? 40;

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(modeStep!.id), {
      stepId: String(modeStep!.id),
      playerId: p1,
      selections: ['mode_2'],
      cancelled: false,
      timestamp: Date.now(),
    });

    expect(resumeLegacyModalSpellModeSelection(ctx, completedStep!, completedStep!.response!)).toBe(true);

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (g.state as any).life?.[p1]).toBe(lifeBefore + 2);
    expect((g.state as any).stack?.length || 0).toBe(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('scry categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Scry 2.';
    const spellSpec = categorizeSpell('Test Scry', oracleText);
    expect(spellSpec?.op).toBe('SCRY');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_scry';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'scry_legacy',
      name: 'Test Scry',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }, ['lib-1', 'lib-2', 'lib-3']);

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(0);
    expect((g.state as any).pendingScry?.[p1]).toBeUndefined();
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(3);
  });

  it('surveil categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Surveil 2.';
    const spellSpec = categorizeSpell('Test Surveil', oracleText);
    expect(spellSpec?.op).toBe('SURVEIL');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_surveil';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'surveil_legacy',
      name: 'Test Surveil',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }, ['lib-1', 'lib-2', 'lib-3']);

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(0);
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(3);
  });

  it('discard categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Target player discards two cards.';
    const spellSpec = categorizeSpell('Test Mind Rot', oracleText);
    expect(spellSpec?.op).toBe('DISCARD_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_discard';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const handCards = [
      { id: 'h1', name: 'Hand 1', zone: 'hand' },
      { id: 'h2', name: 'Hand 2', zone: 'hand' },
      { id: 'h3', name: 'Hand 3', zone: 'hand' },
    ];
    (g.state as any).zones[p2].hand = handCards.map((card) => ({ ...card }));
    (g.state as any).zones[p2].handCount = handCards.length;
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = handCards.map((card) => ({ ...card }));

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [{ kind: 'player', id: p2 }], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'discard_legacy',
      name: 'Test Mind Rot',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'discard_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(0);
    expect((g.state as any).zones[p2]?.hand?.length ?? 0).toBe(3);
  });

  it('applies scry triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_scry';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    ensureZonesForPlayer(game, p1);
    setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Opt',
      'Scry 1.',
      { id: 'trigger-legacy-scry', source: 'opt-1' },
    );

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(1);
    expect((scrySteps[0] as any)?.scryCount).toBe(1);
    expect((game.state as any).pendingScry?.[p1]).toBeUndefined();
  });

  it('applies surveil triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_surveil';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    ensureZonesForPlayer(game, p1);
    setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3', 'lib-4']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Discovery',
      'Surveil 2.',
      { id: 'trigger-legacy-surveil', source: 'discovery-1' },
    );

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(1);
    expect((surveilSteps[0] as any)?.surveilCount).toBe(2);
  });

  it('applies discard triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_discard';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const handCards = [
      { id: 'card-1', name: 'Island', zone: 'hand' },
      { id: 'card-2', name: 'Mountain', zone: 'hand' },
    ];
    (game.state as any).zones = {
      [p2]: {
        hand: handCards,
        handCount: handCards.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    const p2Player = (game.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = handCards.map((card) => ({ ...card }));

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    (game.state as any).pendingDiscard = {};

    executeTriggerEffect(
      ctx,
      p1,
      'Liliana',
      'Target player discards a card.',
      {
        id: 'trigger-legacy-discard',
        source: 'liliana-1',
        targets: [p2],
        targetPlayerId: p2,
      },
    );

    expect((game.state as any).pendingDiscard?.[p2]).toBeUndefined();
    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(1);
  });

  it('applies mill triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_mill';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Glimpse',
      'Target player mills three cards.',
      {
        id: 'trigger-legacy-mill',
        source: 'glimpse-1',
        targets: [p2],
        targetPlayerId: p2,
      },
    );

    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(3);
    expect((game.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('applies destroy triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_destroy';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Murderous Redcap',
      'Destroy target creature.',
      {
        id: 'trigger-legacy-destroy',
        source: 'redcap-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('applies each-opponent discard triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_discard_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const handCards = [
      { id: 'card-1', name: 'Island', zone: 'hand' },
      { id: 'card-2', name: 'Mountain', zone: 'hand' },
    ];
    (game.state as any).zones = {
      [p2]: {
        hand: handCards,
        handCount: handCards.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    const p2Player = (game.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = handCards.map((card) => ({ ...card }));

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    (game.state as any).pendingDiscard = {};

    executeTriggerEffect(
      ctx,
      p1,
      'Liliana',
      'Each opponent discards a card.',
      { id: 'trigger-legacy-discard-each', source: 'liliana-1' },
    );

    expect((game.state as any).pendingDiscard?.[p2]).toBeUndefined();
    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(1);
  });

  it('applies each-opponent mill triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_mill_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Glimpse',
      'Each opponent mills two cards.',
      { id: 'trigger-legacy-mill-each', source: 'glimpse-1' },
    );

    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(2);
    expect((game.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(2);
  });

  it('queues each-player discard triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_discard_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    const handCardsFor = (prefix: string) => [
      { id: `${prefix}-1`, name: 'Hand 1', zone: 'hand' },
      { id: `${prefix}-2`, name: 'Hand 2', zone: 'hand' },
      { id: `${prefix}-3`, name: 'Hand 3', zone: 'hand' },
    ];
    for (const [playerId, prefix] of [[p1, 'p1'], [p2, 'p2']] as const) {
      const handCards = handCardsFor(prefix);
      (game.state as any).zones[playerId].hand = handCards.map((card) => ({ ...card }));
      (game.state as any).zones[playerId].handCount = handCards.length;
      const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
      player.hand = handCards.map((card) => ({ ...card }));
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    (game.state as any).pendingDiscard = {};

    executeTriggerEffect(
      ctx,
      p1,
      'Wheel',
      'Each player discards two cards.',
      { id: 'trigger-legacy-discard-each-player', source: 'wheel-1' },
    );

    expect((game.state as any).pendingDiscard?.[p1]).toBeUndefined();
    expect((game.state as any).pendingDiscard?.[p2]).toBeUndefined();
    for (const playerId of [p1, p2]) {
      const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
        .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
      expect(discardSteps).toHaveLength(1);
      expect((discardSteps[0] as any)?.discardCount).toBe(2);
    }
  });

  it('routes each-player mill triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_mill_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p1, ['p1-mill-1', 'p1-mill-2', 'p1-mill-3', 'p1-mill-4']);
    setupPlayerLibrary(game, p2, ['p2-mill-1', 'p2-mill-2', 'p2-mill-3', 'p2-mill-4']);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Glimpse',
      'Each player mills two cards.',
      { id: 'trigger-legacy-mill-each-player', source: 'glimpse-1' },
    );

    for (const playerId of [p1, p2]) {
      const gy = (game.state as any).zones?.[playerId]?.graveyard || [];
      expect(gy.length).toBe(2);
      expect((game.state as any).zones?.[playerId]?.libraryCount ?? 0).toBe(2);
    }
  });

  it('destroy categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Destroy target creature.';
    const spellSpec = categorizeSpell('Test Murder', oracleText);
    expect(spellSpec?.op).toBe('DESTROY_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_destroy';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [{ kind: 'permanent', id: 'c1' }], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'destroy_legacy',
      name: 'Test Murder',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{B}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'destroy_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(true);
  });

  it('mill categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Target player mills three cards.';
    const spellSpec = categorizeSpell('Test Mill', oracleText);
    expect(spellSpec?.op).toBe('MILL_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_mill';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    setupPlayerLibrary(g, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [{ kind: 'player', id: p2 }], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'mill_legacy',
      name: 'Test Mill',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'mill_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(0);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(4);
  });

  it('each-opponent discard categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each opponent discards two cards.';
    const spellSpec = categorizeSpell('Test Opp Discard', oracleText);
    expect(spellSpec?.op).toBe('DISCARD_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_discard_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const handCards = [
      { id: 'h1', name: 'Hand 1', zone: 'hand' },
      { id: 'h2', name: 'Hand 2', zone: 'hand' },
      { id: 'h3', name: 'Hand 3', zone: 'hand' },
    ];
    (g.state as any).zones[p2].hand = handCards.map((card) => ({ ...card }));
    (g.state as any).zones[p2].handCount = handCards.length;
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = handCards.map((card) => ({ ...card }));

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'discard_each_legacy',
      name: 'Test Opp Discard',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }, ['lib-1']);

    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(0);
    expect((g.state as any).zones[p2]?.hand?.length ?? 0).toBe(3);
  });

  it('each-opponent mill categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each opponent mills two cards.';
    const spellSpec = categorizeSpell('Test Opp Mill', oracleText);
    expect(spellSpec?.op).toBe('MILL_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_mill_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    setupPlayerLibrary(g, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'mill_each_legacy',
      name: 'Test Opp Mill',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, ['lib-1']);

    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(0);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(4);
  });

  it('each-player discard categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each player discards two cards.';
    const spellSpec = categorizeSpell('Test Player Discard', oracleText);
    expect(spellSpec?.op).toBe('DISCARD_EACH_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_discard_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const p2HandCards = [
      { id: 'p2-1', name: 'Hand 1', zone: 'hand' },
      { id: 'p2-2', name: 'Hand 2', zone: 'hand' },
      { id: 'p2-3', name: 'Hand 3', zone: 'hand' },
    ];
    (g.state as any).zones[p2].hand = p2HandCards.map((card) => ({ ...card }));
    (g.state as any).zones[p2].handCount = p2HandCards.length;
    const p2Player = (g.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = p2HandCards.map((card) => ({ ...card }));

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'discard_each_player_legacy',
      name: 'Test Player Discard',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }, ['lib-1'], (game) => {
      const extraHand = [
        { id: 'p1-1', name: 'Hand 1', zone: 'hand' },
        { id: 'p1-2', name: 'Hand 2', zone: 'hand' },
        { id: 'p1-3', name: 'Hand 3', zone: 'hand' },
      ];
      const existingHand = Array.isArray((game.state as any).zones[p1]?.hand)
        ? (game.state as any).zones[p1].hand.map((card: any) => ({ ...card }))
        : [];
      const mergedHand = [...existingHand, ...extraHand];
      (game.state as any).zones[p1].hand = mergedHand;
      (game.state as any).zones[p1].handCount = mergedHand.length;
      const p1Player = (game.state as any).players.find((entry: any) => entry.id === p1);
      p1Player.hand = mergedHand.map((card: any) => ({ ...card }));
    });

    for (const playerId of [p1, p2]) {
      const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
        .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
      expect(discardSteps).toHaveLength(0);
    }
    expect((g.state as any).zones[p1]?.hand?.length ?? 0).toBe(3);
    expect((g.state as any).zones[p2]?.hand?.length ?? 0).toBe(3);
  });

  it('each-player mill categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each player mills two cards.';
    const spellSpec = categorizeSpell('Test Player Mill', oracleText);
    expect(spellSpec?.op).toBe('MILL_EACH_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_mill_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'mill_each_player_legacy',
      name: 'Test Player Mill',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, ['lib-1'], (game) => {
      setupPlayerLibrary(game, p1, ['p1-mill-1', 'p1-mill-2', 'p1-mill-3', 'p1-mill-4']);
      setupPlayerLibrary(game, p2, ['p2-mill-1', 'p2-mill-2', 'p2-mill-3', 'p2-mill-4']);
    });

    for (const playerId of [p1, p2]) {
      const gy = (g.state as any).zones?.[playerId]?.graveyard || [];
      expect(gy.length).toBe(playerId === p1 ? 1 : 0);
      expect((g.state as any).zones?.[playerId]?.libraryCount ?? 0).toBe(4);
    }
  });

  it('applies each-opponent lose-life triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_lose_life_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Ob Nixilis',
      'Each opponent loses 3 life.',
      { id: 'trigger-legacy-each-lose', source: 'nixilis-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(37);
  });

  it('applies each-player lose-life triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_lose_life_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Sulfuric Vortex',
      'Each player loses 2 life.',
      { id: 'trigger-legacy-each-player-lose', source: 'vortex-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(38);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(38);
  });

  it('gain-life target-player categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Target player gains 3 life.';
    const spellSpec = categorizeSpell('Healing Salve', oracleText);
    expect(spellSpec?.op).toBe('GAIN_LIFE_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_gain_life_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'gain_target_legacy',
      name: 'Healing Salve',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'gain_target_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(40);
  });

  it('each-opponent gain-life categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each opponent gains 1 life.';
    const spellSpec = categorizeSpell('Group Hug', oracleText);
    expect(spellSpec?.op).toBe('GAIN_LIFE_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_gain_life_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'gain_each_legacy',
      name: 'Group Hug',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }, ['lib-1']);

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(40);
  });

  it('each-player gain-life categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each player gains 2 life.';
    expect(categorizeSpell('Team Heal', oracleText)?.op).toBe('GAIN_LIFE_EACH_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('GAIN_LIFE_EACH_PLAYER')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_gain_life_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'gain_each_player_legacy',
      name: 'Team Heal',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{W}',
    }, ['lib-1']);

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(40);
  });

  it('applies gain-life target-player triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_gain_life_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Healing Salve',
      'Target player gains 3 life.',
      { id: 'trigger-legacy-gain-target', source: 'salve-1', targets: [p2], targetPlayerId: p2 },
    );

    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(43);
  });

  it('applies each-opponent gain-life triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_gain_life_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Group Hug',
      'Each opponent gains 1 life.',
      { id: 'trigger-legacy-gain-each', source: 'hug-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(41);
  });

  it('applies each-player gain-life triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_gain_life_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Team Heal',
      'Each player gains 2 life.',
      { id: 'trigger-legacy-gain-each-player', source: 'heal-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(42);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(42);
  });

  it('applies lose-life target-player triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_lose_life_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Bump',
      'Target player loses 2 life.',
      { id: 'trigger-legacy-lose-target', source: 'bump-1', targets: [p2], targetPlayerId: p2 },
    );

    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(38);
  });

  it('create-token categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Create a Treasure token.';
    const spellSpec = categorizeSpell('Test Strike It Rich', oracleText);
    expect(spellSpec?.op).toBe('CREATE_TOKEN');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_create_token';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'token_legacy',
      name: 'Test Strike It Rich',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Treasure')).toBe(false);
  });

  it('damage-target-player categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Deal 3 damage to target player.';
    expect(categorizeSpell('Test Lightning Strike', oracleText)?.op).toBe('DAMAGE_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DAMAGE_TARGET_PLAYER')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_damage_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'damage_target_legacy',
      name: 'Test Lightning Strike',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'damage_target_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(40);
  });

  it('each-opponent damage categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Deal 2 damage to each opponent.';
    expect(categorizeSpell('Test Fiery Impulse', oracleText)?.op).toBe('DAMAGE_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DAMAGE_EACH_OPPONENT')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_damage_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_each_opp_legacy',
      name: 'Test Fiery Impulse',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(40);
  });

  it('each-player damage categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Deal 1 damage to each player.';
    expect(categorizeSpell('Test Earthquake', oracleText)?.op).toBe('DAMAGE_EACH_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DAMAGE_EACH_PLAYER')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_damage_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_each_player_legacy',
      name: 'Test Earthquake',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{X}{R}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const p1After = (g.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (g.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (g.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (g.state as any).life?.[p2]).toBe(40);
  });

  it('creates a Treasure token via IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_create_token';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const battlefieldBefore = (game.state as any).battlefield?.length ?? 0;

    executeTriggerEffect(
      ctx,
      p1,
      'Smothering Tithe',
      'Create a Treasure token.',
      { id: 'trigger-legacy-create-token', source: 'tithe-1' },
    );

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Treasure')).toBe(true);
  });

  it('applies each-opponent damage triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_damage_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Guttersnipe',
      'Deal 2 damage to each opponent.',
      { id: 'trigger-legacy-damage-each-opp', source: 'guttersnipe-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(38);
  });

  it('applies each-player damage triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_damage_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Coalhauler Swine',
      'Deal 1 damage to each player.',
      { id: 'trigger-legacy-damage-each-player', source: 'swine-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(39);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(39);
  });

  it('applies damage-target-player triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_damage_target_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Lightning Strike',
      'Deal 3 damage to target player.',
      { id: 'trigger-legacy-damage-target', source: 'strike-1', targets: [p2], targetPlayerId: p2 },
    );

    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(37);
  });

  it('creature-token categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Create a 1/1 white Soldier creature token.';
    const spellSpec = categorizeSpell('Test Recruit', oracleText);
    expect(spellSpec?.op).toBe('CREATE_TOKEN');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_create_creature_token';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'creature_token_legacy',
      name: 'Test Recruit',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}',
    }, [], (game) => setupPlayerLibrary(game, p1, ['lib-1']));

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore);
    expect(battlefield.some((perm: any) => String(perm?.card?.name || '').includes('Soldier'))).toBe(false);
  });

  it('any-target damage categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Lightning Bolt deals 3 damage to any target.';
    expect(categorizeSpell('Lightning Bolt', oracleText)?.op).toBe('ANY_TARGET_DAMAGE');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('ANY_TARGET_DAMAGE')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_any_target_damage';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'bolt_legacy',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'bolt_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(true);
  });

  it('damage-target categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Deal 3 damage to target creature.';
    expect(categorizeSpell('Test Shock', oracleText)?.op).toBe('DAMAGE_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DAMAGE_TARGET')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_damage_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'damage_creature_legacy',
      name: 'Test Shock',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{R}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'damage_creature_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(true);
  });

  it('creates a creature token via IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_create_creature_token';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const battlefieldBefore = (game.state as any).battlefield?.length ?? 0;

    executeTriggerEffect(
      ctx,
      p1,
      'Recruit',
      'Create a 1/1 white Soldier creature token.',
      { id: 'trigger-legacy-create-creature-token', source: 'recruit-1' },
    );

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => String(perm?.card?.name || '').includes('Soldier'))).toBe(true);
  });

  it('applies any-target damage triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_any_target_damage';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Lightning Bolt',
      'Lightning Bolt deals 3 damage to any target.',
      { id: 'trigger-legacy-any-target-damage', source: 'bolt-1', targets: ['c1'] },
    );

    const perm = (game.state as any).battlefield.find((p: any) => p?.id === 'c1');
    expect(perm?.damageThisTurn ?? perm?.damageMarked ?? perm?.damage ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('applies damage-target triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_damage_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Shock',
      'Deal 3 damage to target creature.',
      { id: 'trigger-legacy-damage-target', source: 'shock-1', targets: ['c1'] },
    );

    const perm = (game.state as any).battlefield.find((p: any) => p?.id === 'c1');
    expect(perm?.damageThisTurn ?? perm?.damageMarked ?? perm?.damage ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('each-creature damage categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Deal 1 damage to each creature.';
    expect(categorizeSpell('Test Sweep', oracleText)?.op).toBe('DAMAGE_EACH');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DAMAGE_EACH')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_damage_each_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'damage_each_legacy',
      name: 'Test Sweep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p1, 'Knight', 1, 2, 2);
    });

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(2);
  });

  it('routes each-creature damage triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_damage_each_creature';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p1, 'Knight', 1, 2, 2);
    const creatureIds = (game.state as any).battlefield.map((perm: any) => perm.id);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Sweep',
      'Deal 1 damage to each creature.',
      { id: 'trigger-legacy-damage-each-creature', source: 'sweep-1' },
    );

    for (const creatureId of creatureIds) {
      const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === creatureId);
      expect(perm?.damageMarked ?? perm?.damage ?? perm?.damageThisTurn ?? perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('each-creature-you-control damage categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Deal 1 damage to each creature you control.';
    expect(categorizeSpell('Test Self Sweep', oracleText)?.op).toBe('DAMAGE_EACH');
    expect(categorizeSpell('Test Self Sweep', oracleText)?.controllerOnly).toBe(true);
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DAMAGE_EACH')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_damage_each_you_control';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'self_sweep_legacy',
      name: 'Test Self Sweep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{R}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Token', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(true);
  });

  it('routes each-creature-you-control damage triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_damage_each_you_control';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'P1 Token', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);
    const p1CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p1)?.id;
    const p2CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p2)?.id;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Self Sweep',
      'Deal 1 damage to each creature you control.',
      { id: 'trigger-legacy-damage-each-you-control', source: 'sweep-1' },
    );

    const p1Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p1CreatureId);
    const p2Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p2CreatureId);
    expect(p1Perm?.damageMarked ?? p1Perm?.damage ?? p1Perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(1);
    expect(p2Perm?.damageMarked ?? p2Perm?.damage ?? p2Perm?.counters?.damage ?? 0).toBe(0);
  });

  it('destroy-all-creatures categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Destroy all creatures.';
    expect(categorizeSpell('Test Wrath', oracleText)?.op).toBe('DESTROY_ALL');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DESTROY_ALL')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_destroy_all_creatures';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'wrath_legacy',
      name: 'Test Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(true);
  });

  it('routes destroy-all-creatures triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_destroy_all_creatures';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Wrath',
      'Destroy all creatures.',
      { id: 'trigger-legacy-destroy-all', source: 'wrath-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('destroy-each-creature categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Destroy each creature.';
    expect(categorizeSpell('Test Each Wrath', oracleText)?.op).toBe('DESTROY_EACH');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DESTROY_EACH')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_destroy_each_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'each_wrath_legacy',
      name: 'Test Each Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(true);
  });

  it('routes destroy-each-creature triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_destroy_each_creature';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Each Wrath',
      'Destroy each creature.',
      { id: 'trigger-legacy-destroy-each', source: 'each-wrath-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('exile-target-creature categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Exile target creature.';
    expect(categorizeSpell('Test Path to Exile', oracleText)?.op).toBe('EXILE_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('EXILE_TARGET')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_exile_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'exile_legacy',
      name: 'Test Path to Exile',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{W}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'exile_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(true);
  });

  it('applies exile-target-creature triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_exile_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Path to Exile',
      'Exile target creature.',
      {
        id: 'trigger-legacy-exile',
        source: 'path-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const exile2 = (game.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('exile-all-creatures categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Exile all creatures.';
    expect(categorizeSpell('Test Terminus', oracleText)?.op).toBe('EXILE_ALL');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('EXILE_ALL')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_exile_all_creatures';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'terminus_legacy',
      name: 'Test Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(true);
  });

  it('routes exile-all-creatures triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_exile_all_creatures';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Terminus',
      'Exile all creatures.',
      { id: 'trigger-legacy-exile-all', source: 'terminus-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('resolves exile-each-creature spells through IR primary when spell legacy is forced', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Exile each creature.';
    expect(categorizeSpell('Test Each Terminus', oracleText)).toBeNull();

    const gameId = 'oracle_ir_legacy_forced_spell_exile_each_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'each_terminus_legacy',
      name: 'Test Each Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Soldier', 1, 1, 1);
      game.createToken!(p2, 'Knight', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('routes exile-each-creature triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_exile_each_creature';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Each Terminus',
      'Exile each creature.',
      { id: 'trigger-legacy-exile-each', source: 'each-terminus-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('opponent-scoped exile-all categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Exile all creatures your opponents control.';
    expect(categorizeSpell('Test Opp Terminus', oracleText)?.op).toBe('EXILE_ALL');
    expect(categorizeSpell('Test Opp Terminus', oracleText)?.opponentOnly).toBe(true);
    expect(isCategorizeOpcodeDeletedFromResolveSpell('EXILE_ALL')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_exile_all_opponent_creatures';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'opp_terminus_legacy',
      name: 'Test Opp Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{4}{W}{W}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Token', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(true);
  });

  it('routes opponent-scoped exile-all-creatures triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_exile_all_opponent_creatures';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'P1 Token', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Opp Terminus',
      'Exile all creatures your opponents control.',
      { id: 'trigger-legacy-exile-all-opponent', source: 'opp-terminus-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
    expect((game.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(false);
  });

  it('exile-target-nonland categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Exile target nonland permanent.';
    expect(categorizeSpell('Test Oblivion Ring', oracleText)?.op).toBe('EXILE_TARGET');
    expect(categorizeSpell('Test Oblivion Ring', oracleText)?.nonlandOnly).toBe(true);
    expect(isCategorizeOpcodeDeletedFromResolveSpell('EXILE_TARGET')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_exile_nonland';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'exile_nonland_legacy',
      name: 'Test Oblivion Ring',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{2}{W}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'exile_nonland_legacy',
      targets: ['a1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'a1')).toBe(true);
  });

  it('applies exile-target-nonland-permanent triggers through legacy regex when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_exile_nonland';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    (game.state as any).battlefield = [
      {
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Oblivion Ring',
      'Exile target nonland permanent.',
      {
        id: 'trigger-legacy-exile-nonland',
        source: 'ring-1',
        targets: ['a1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'a1')).toBe(false);
    const exile2 = (game.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'a1_card')).toBe(true);
  });

  it('flicker categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = "Exile target creature you control, then return it to the battlefield under its owner's control.";
    const spellSpec = categorizeSpell('Test Momentary Blink', oracleText);
    expect(spellSpec?.op).toBe('FLICKER_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_flicker_immediate';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'flicker_immediate_legacy',
      name: 'Test Momentary Blink',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{1}{W}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);
    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p1,
        owner: p1,
        tapped: true,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    expect(resolveSpell(spellSpec as any, [{ kind: 'permanent', id: 'c1' }], g.state as any, p1)).toEqual([]);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'flicker_immediate_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm).toBeDefined();
    expect(perm?.tapped).toBe(true);
  });

  it('delayed flicker categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = "Exile target creature. Return it to the battlefield under its owner's control at the beginning of the next end step.";
    const spellSpec = categorizeSpell('Test Flickerwisp', oracleText);
    expect(spellSpec?.op).toBe('FLICKER_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_flicker_delayed';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [{ kind: 'permanent', id: 'c1' }], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'flicker_delayed_legacy',
      name: 'Test Flickerwisp',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{2}{W}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'flicker_delayed_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(true);
    const exile2 = (g.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'c1_card')).toBe(false);
    expect(((g.state as any).pendingFlickerReturns || []) as any[]).toHaveLength(0);
  });

  it('bounce-target categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = "Return target creature to its owner's hand.";
    const spellSpec = categorizeSpell('Test Unsummon', oracleText);
    expect(spellSpec?.op).toBe('BOUNCE_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_bounce_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [{ kind: 'permanent', id: 'c1' }], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'bounce_legacy',
      name: 'Test Unsummon',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'bounce_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(true);
    expect((g.state as any).zones?.[p2]?.hand?.some((card: any) => card?.id === 'c1_card')).toBe(false);
  });

  it('routes bounce-target-creature triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_bounce_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Unsummon',
      "Return target creature to its owner's hand.",
      {
        id: 'trigger-legacy-bounce',
        source: 'unsummon-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    expect((game.state as any).zones?.[p2]?.hand?.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('routes exile-target-player-graveyard triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_exile_graveyard';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);
    (game.state as any).zones[p2].graveyard = [{ id: 'dead-1', name: 'Dead Card', zone: 'graveyard' }];
    (game.state as any).zones[p2].graveyardCount = 1;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Bojuka Bog',
      "Exile all cards from target player's graveyard.",
      {
        id: 'trigger-legacy-exile-graveyard',
        source: 'bog-1',
        targets: [p2],
      },
    );

    expect(((game.state as any).zones?.[p2]?.graveyard || []).length).toBe(0);
    expect(((game.state as any).zones?.[p2]?.exile || []).some((card: any) => card?.id === 'dead-1')).toBe(true);
  });

  it('routes sacrifice-target-creature triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_sacrifice_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Edict',
      'Sacrifice target creature.',
      {
        id: 'trigger-legacy-sacrifice-target',
        source: 'edict-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('resolves sacrifice-a-creature spells through IR uncategorized fallback when spell legacy is forced', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Sacrifice a creature.';
    expect(categorizeSpell('Test Altar', oracleText)).toBeNull();

    const gameId = 'oracle_ir_legacy_forced_spell_sacrifice_a_creature';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'altar_legacy',
      name: 'Test Altar',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{B}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'Goat', 0, 1, 1);
    });

    expect((g.state as any).battlefield.length).toBe(0);
    const gy1 = (g.state as any).zones?.[p1]?.graveyard || [];
    expect(gy1.length).toBeGreaterThanOrEqual(1);
  });

  it('counter-target-spell categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Counter target spell.';
    const spellSpec = categorizeSpell('Test Counterspell', oracleText);
    expect(spellSpec?.op).toBe('COUNTER_TARGET_SPELL');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_counter_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackBoltId = 'stack_bolt_legacy_spell';

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.applyEvent!({
      type: 'pushStack',
      item: {
        id: stackBoltId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: [],
      },
    });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(
      spellSpec as any,
      [{ kind: 'stack', id: stackBoltId }],
      g.state as any,
      p1,
    )).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'counter_legacy',
      name: 'Test Counterspell',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'counter_legacy',
      targets: [stackBoltId],
    });

    expect((g.state as any).stack?.length || 0).toBe(2);
    g.resolveTopOfStack();

    // Counterspell resolved without effect; bolt remains on stack.
    expect((g.state as any).stack?.length || 0).toBe(1);
    expect((g.state as any).stack?.[0]?.id).toBe(stackBoltId);
    const gy2 = (g.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'bolt_card')).toBe(false);
  });

  it('counter-target-ability categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Counter target activated ability.';
    const spellSpec = categorizeSpell('Test Stifle', oracleText);
    expect(spellSpec?.op).toBe('COUNTER_TARGET_ABILITY');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_counter_ability';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackAbilityId = 'stack_ability_legacy_spell';

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.applyEvent!({
      type: 'pushStack',
      item: {
        id: stackAbilityId,
        type: 'activated_ability',
        controller: p2,
        description: '{T}: Draw a card.',
        isManaAbility: false,
      },
    });

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(
      spellSpec as any,
      [{ kind: 'stack', id: stackAbilityId }],
      g.state as any,
      p1,
    )).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'counter_ability_legacy',
      name: 'Test Stifle',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'counter_ability_legacy',
      targets: [stackAbilityId],
    });

    expect((g.state as any).stack?.length || 0).toBe(2);
    g.resolveTopOfStack();

    // Stifle resolved without effect; ability remains on stack.
    expect((g.state as any).stack?.length || 0).toBe(1);
    expect((g.state as any).stack?.[0]?.id).toBe(stackAbilityId);
  });

  it('routes counter-target-spell triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_counter_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackBoltId = 'stack_bolt_legacy_trigger';

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    game.applyEvent!({
      type: 'pushStack',
      item: {
        id: stackBoltId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: [],
      },
    });

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Counterspell',
      'Counter target spell.',
      {
        id: 'trigger-legacy-counter',
        source: 'counterspell-1',
        targets: [stackBoltId],
      },
    );

    expect((game.state as any).stack?.length || 0).toBe(0);
    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'bolt_card')).toBe(true);
  });

  it('tap-target categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Tap target creature.';
    const spellSpec = categorizeSpell('Test Twiddle', oracleText);
    expect(spellSpec?.op).toBe('TAP_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_tap_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [{ kind: 'permanent', id: 'c1' }], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'tap_legacy',
      name: 'Test Twiddle',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'tap_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.tapped).toBe(false);
  });

  it('routes tap-target-creature triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_tap_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Twiddle',
      'Tap target creature.',
      {
        id: 'trigger-legacy-tap',
        source: 'twiddle-1',
        targets: ['c1'],
      },
    );

    const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.tapped).toBe(true);
  });

  it('add-counters-target categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Put a +1/+1 counter on target creature.';
    const spellSpec = categorizeSpell('Test Incubate', oracleText);
    expect(spellSpec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_add_counters_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    (g.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        counters: {},
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(
      spellSpec as any,
      [{ kind: 'permanent', id: 'c1' }],
      g.state as any,
      p1,
    )).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'counter_legacy',
      name: 'Test Incubate',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{G}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'counter_legacy',
      targets: ['c1'],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.counters?.['+1/+1']).toBeUndefined();
  });

  it('add-counters-each categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Put a +1/+1 counter on each creature you control.';
    const spellSpec = categorizeSpell('Test Collective Growth', oracleText);
    expect(spellSpec?.op).toBe('ADD_COUNTERS_EACH');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_add_counters_each';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'each_counter_legacy',
      name: 'Test Collective Growth',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{G}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      game.createToken!(p1, 'P1 Token A', 1, 1, 1);
      game.createToken!(p1, 'P1 Token B', 1, 1, 1);
      game.createToken!(p2, 'P2 Token', 1, 1, 1);
    });

    const p1Creatures = (g.state as any).battlefield.filter((entry: any) => entry?.controller === p1);
    const p2Creature = (g.state as any).battlefield.find((entry: any) => entry?.controller === p2);
    expect(p1Creatures.length).toBe(2);
    expect(p1Creatures.every((entry: any) => !entry?.counters?.['+1/+1'])).toBe(true);
    expect(p2Creature?.counters?.['+1/+1']).toBeUndefined();
  });

  it('draw-target-player categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Target player draws two cards.';
    const spellSpec = categorizeSpell('Test Target Draw', oracleText);
    expect(spellSpec?.op).toBe('DRAW_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_draw_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'draw_target_legacy',
      name: 'Test Target Draw',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    setupPlayerLibrary(g, p2, ['draw-1', 'draw-2', 'draw-3']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'draw_target_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(0);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(3);
  });

  it('each-opponent draw categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each opponent draws two cards.';
    expect(categorizeSpell('Test Opp Draw', oracleText)?.op).toBe('DRAW_CARDS_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DRAW_CARDS_EACH_OPPONENT')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_draw_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'draw_each_opp_legacy',
      name: 'Test Opp Draw',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{3}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['lib-1']);
      setupPlayerLibrary(game, p2, ['opp-draw-1', 'opp-draw-2', 'opp-draw-3']);
    });

    expect((g.state as any).zones?.[p2]?.hand?.length ?? 0).toBe(0);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(3);
  });

  it('each-player draw categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each player draws a card.';
    expect(categorizeSpell('Test All Draw', oracleText)?.op).toBe('DRAW_CARDS_EACH_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DRAW_CARDS_EACH_PLAYER')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_draw_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    castAndResolve(g, p1, {
      id: 'draw_each_player_legacy',
      name: 'Test All Draw',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);
    });

    for (const playerId of [p1, p2]) {
      const handCount = (g.state as any).zones?.[playerId]?.hand?.length ?? 0;
      const libraryCount = (g.state as any).zones?.[playerId]?.libraryCount ?? 0;
      expect(handCount).toBe(0);
      expect(libraryCount).toBe(2);
    }
  });

  it('mill-self categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Mill two cards.';
    const spellSpec = categorizeSpell('Test Mill Self', oracleText);
    expect(spellSpec?.op).toBe('MILL_SELF');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_mill_self';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'mill_self_legacy',
      name: 'Test Mill Self',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'mill_self_legacy',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const gy = (g.state as any).zones?.[p1]?.graveyard || [];
    expect(gy.length).toBe(1);
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(4);
  });

  it('routes add-counters-each triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_add_counters_each';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'P1 Token A', 1, 1, 1);
    game.createToken!(p1, 'P1 Token B', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Collective Growth',
      'Put a +1/+1 counter on each creature you control.',
      { id: 'trigger-legacy-add-counters-each', source: 'growth-1' },
    );

    const p1Creatures = (game.state as any).battlefield.filter((entry: any) => entry?.controller === p1);
    const p2Creature = (game.state as any).battlefield.find((entry: any) => entry?.controller === p2);
    expect(p1Creatures.length).toBe(2);
    expect(p1Creatures.every((entry: any) => entry?.counters?.['+1/+1'] === 1)).toBe(true);
    expect(p2Creature?.counters?.['+1/+1']).toBeUndefined();
  });

  it('routes add-counters-target triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_add_counters_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        counters: {},
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Incubate',
      'Put a +1/+1 counter on target creature.',
      {
        id: 'trigger-legacy-counter',
        source: 'incubate-1',
        targets: ['c1'],
      },
    );

    const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.counters?.['+1/+1']).toBe(1);
  });

  it('each-player scry categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each player scries 1.';
    const spellSpec = categorizeSpell('Test Each Player Scry', oracleText);
    expect(spellSpec?.op).toBe('SCRY_EACH_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_scry_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'scry_each_player_legacy',
      name: 'Test Each Player Scry',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);
    });

    expect((g.state as any).pendingScry).toBeUndefined();

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .concat(ResolutionQueueManager.getStepsForPlayer(gameId, p2))
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(0);
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(2);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(2);
  });

  it('each-opponent scry categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each opponent scries 2.';
    const spellSpec = categorizeSpell('Test Each Opp Scry', oracleText);
    expect(spellSpec?.op).toBe('SCRY_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_scry_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'scry_each_opponent_legacy',
      name: 'Test Each Opp Scry',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2', 'p1-lib-3']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2', 'p2-lib-3']);
    });

    expect((g.state as any).pendingScry).toBeUndefined();

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(0);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SCRY)).toHaveLength(0);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(3);
  });

  it('each-player surveil categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each player surveils 1.';
    const spellSpec = categorizeSpell('Test Each Player Surveil', oracleText);
    expect(spellSpec?.op).toBe('SURVEIL_EACH_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_surveil_each_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'surveil_each_player_legacy',
      name: 'Test Each Player Surveil',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);
    });

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .concat(ResolutionQueueManager.getStepsForPlayer(gameId, p2))
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(0);
    expect((g.state as any).pendingSurveil).toBeUndefined();
    expect((g.state as any).zones?.[p1]?.libraryCount ?? 0).toBe(2);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(2);
  });

  it('each-opponent surveil categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each opponent surveils 2.';
    const spellSpec = categorizeSpell('Test Each Opp Surveil', oracleText);
    expect(spellSpec?.op).toBe('SURVEIL_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_surveil_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'surveil_each_opponent_legacy',
      name: 'Test Each Opp Surveil',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }, [], (game) => {
      setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2', 'p1-lib-3']);
      setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2', 'p2-lib-3']);
    });

    expect((g.state as any).pendingSurveil).toBeUndefined();

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(0);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(3);
  });

  it('investigate categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Investigate.';
    const spellSpec = categorizeSpell('Test Investigate', oracleText);
    expect(spellSpec?.op).toBe('INVESTIGATE');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_investigate';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    ensureZonesForPlayer(g, p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    const battlefieldBefore = (g.state as any).battlefield?.length ?? 0;

    castAndResolve(g, p1, {
      id: 'investigate_legacy',
      name: 'Test Investigate',
      type_line: 'Instant',
      oracle_text: oracleText,
      mana_cost: '{2}',
    }, ['lib-1']);

    const battlefield = (g.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Clue')).toBe(false);
  });

  it('applies each-player scry triggers through IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_scry_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
    setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Test Scry Each',
      'Each player scries 1.',
      { id: 'trigger-legacy-scry-each-player', source: 'scry-1' },
    );

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .concat(ResolutionQueueManager.getStepsForPlayer(gameId, p2))
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(2);
    expect((game.state as any).pendingScry).toBeUndefined();
  });

  it('creates a Clue token via IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_investigate';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const battlefieldBefore = (game.state as any).battlefield?.length ?? 0;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Investigate',
      'Investigate.',
      { id: 'trigger-legacy-investigate', source: 'clue-1' },
    );

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Clue')).toBe(true);
  });

  it('surveil-target-player categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Target player surveils two.';
    const spellSpec = categorizeSpell('Test Surveil Target', oracleText);
    expect(spellSpec?.op).toBe('SURVEIL_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_surveil_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [{ kind: 'player', id: p2 }], g.state as any, p1)).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'surveil_target_legacy',
      name: 'Test Surveil Target',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    setupPlayerLibrary(g, p2, ['surv-1', 'surv-2', 'surv-3']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'surveil_target_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(0);
    expect((g.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(3);
  });

  it('goad categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Goad target creature.';
    const spellSpec = categorizeSpell('Test Goad', oracleText);
    expect(spellSpec?.op).toBe('GOAD_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_goad_target';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.createToken!(p2, 'P2 Creature', 1, 2, 2);
    const creatureId = (g.state as any).battlefield.find((entry: any) => entry?.controller === p2)?.id;

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(
      spellSpec as any,
      [{ kind: 'permanent', id: creatureId }],
      g.state as any,
      p1,
    )).toEqual([]);

    g.importDeckResolved(p1, [{
      id: 'goad_legacy',
      name: 'Test Goad',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{R}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'goad_legacy',
      targets: [creatureId],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const perm = (g.state as any).battlefield.find((entry: any) => entry?.id === creatureId);
    expect(Array.isArray(perm?.goadedBy) ? perm.goadedBy.includes(p1) : false).toBe(false);
  });

  it('tap-all categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Tap all creatures.';
    const spellSpec = categorizeSpell('Test Sleep', oracleText);
    expect(spellSpec?.op).toBe('TAP_ALL');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_tap_all';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    g.createToken!(p1, 'P1 Creature', 1, 2, 2);
    g.createToken!(p2, 'P2 Creature', 1, 2, 2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'tap_all_legacy',
      name: 'Test Sleep',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{U}',
    }, ['lib-1']);

    const creatures = (g.state as any).battlefield.filter((entry: any) => entry?.card?.type_line?.includes('Creature'));
    expect(creatures.every((entry: any) => entry?.tapped === false)).toBe(true);
  });

  it('goads target creature via IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_goad';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    game.createToken!(p2, 'P2 Creature', 1, 2, 2);
    const creatureId = (game.state as any).battlefield.find((entry: any) => entry?.controller === p2)?.id;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Disrupt Decorum',
      'Goad target creature.',
      { id: 'trigger-legacy-goad', source: 'decor-1', targets: [creatureId] },
    );

    const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === creatureId);
    expect(Array.isArray(perm?.goadedBy) ? perm.goadedBy.includes(p1) : false).toBe(true);
  });

  it('destroy-all-target-player categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Destroy all creatures target player controls.';
    expect(categorizeSpell('Test Target Wrath', oracleText)?.op).toBe('DESTROY_ALL_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('DESTROY_ALL_TARGET_PLAYER')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_destroy_all_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'target_wrath_legacy',
      name: 'Test Target Wrath',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{2}{B}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    g.createToken!(p1, 'P1 Creature', 1, 2, 2);
    g.createToken!(p2, 'P2 Creature', 1, 2, 2);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'target_wrath_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(true);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
  });

  it('exile-all-target-player categorize ops no-op at resolve when spell legacy is forced (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Exile all creatures target player controls.';
    expect(categorizeSpell('Test Target Terminus', oracleText)?.op).toBe('EXILE_ALL_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell('EXILE_ALL_TARGET_PLAYER')).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_exile_all_target_player';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.importDeckResolved(p1, [{
      id: 'target_terminus_legacy',
      name: 'Test Target Terminus',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{3}{W}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1']);
    ensureZonesForPlayer(g, p1);

    g.createToken!(p1, 'P1 Creature', 1, 2, 2);
    g.createToken!(p2, 'P2 Creature', 1, 2, 2);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'target_terminus_legacy',
      targets: [p2],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(true);
    expect((g.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
  });

  it('destroys all creatures target player controls via IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_destroy_all_target_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    game.createToken!(p1, 'P1 Creature', 1, 2, 2);
    game.createToken!(p2, 'P2 Creature', 1, 2, 2);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Target Wrath',
      'Destroy all creatures target player controls.',
      { id: 'trigger-legacy-destroy-all-target', source: 'wrath-1', targets: [p2] },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(false);
    expect((game.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
  });

  it('blight categorize ops no-op at resolve when spell legacy is forced (P1a deleted resolve)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const oracleText = 'Each opponent blights 1.';
    const spellSpec = categorizeSpell('Test Each Opp Blight', oracleText);
    expect(spellSpec?.op).toBe('BLIGHT_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);

    const gameId = 'oracle_ir_legacy_forced_spell_blight_each_opponent';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    expect(resolveSpell(spellSpec as any, [], g.state as any, p1)).toEqual([]);

    castAndResolve(g, p1, {
      id: 'blight_each_opponent_legacy',
      name: 'Test Each Opp Blight',
      type_line: 'Sorcery',
      oracle_text: oracleText,
      mana_cost: '{1}{B}',
    }, [], (game) => {
      game.createToken!(p2, 'Opp Creature', 1, 2, 2);
    });

    const blightSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.TARGET_SELECTION && (step as any)?.keywordBlight === true);
    expect(blightSteps).toHaveLength(0);
  });

  it('queues each-opponent blight via IR uncategorized fallback when trigger legacy is forced', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'oracle_ir_legacy_forced_trigger_blight_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p2, 'Opp Creature', 1, 2, 2);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Test Each Opp Blight',
      'Each opponent blights 1.',
      { id: 'trigger-legacy-blight-each-opponent', source: 'blight-1' },
    );

    const blightSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.TARGET_SELECTION && (step as any)?.keywordBlight === true);
    expect(blightSteps).toHaveLength(1);
    expect((blightSteps[0] as any)?.keywordBlightN).toBe(1);
  });
});
