import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KnownCardRef, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { lookupLocalCardByNameSync, ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import {
  requiresEffectProgramOrchestration,
  requiresSpellEffectProgramOrchestration,
  requiresTriggerEffectProgramOrchestration,
} from '../src/state/modules/oracleIrEffectProgramServer.js';
import { tryResolveTriggerViaOracleIR } from '../src/state/modules/oracleIrTriggerExecution.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const GREEN_SUNS_TWILIGHT_TEXT =
  "Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.";

function setupTwilightLibrary(game: ReturnType<typeof createInitialGameState>, p1: PlayerID) {
  const library = [
    { id: 'lib-1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
    { id: 'lib-2', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'library' },
    { id: 'lib-3', name: 'Lightning Bolt', type_line: 'Instant', zone: 'library' },
  ];

  (game as any).libraries.set(p1, library.map((card) => ({ ...card })));
  const player = (game.state as any).players.find((entry: any) => entry.id === p1);
  player.library = library.map((card) => ({ ...card }));
  (game.state as any).zones[p1].library = library.map((card) => ({ ...card }));
  (game.state as any).zones[p1].libraryCount = library.length;
  return library;
}

describe('oracle IR reveal → player_choice among-them queue adapter', () => {
  it("queues among-them LIBRARY_SEARCH for Green Sun's Twilight and resumes move to hand", () => {
    const gameId = 'oracle_ir_reveal_player_choice_twilight';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    setupTwilightLibrary(game, p1);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(GREEN_SUNS_TWILIGHT_TEXT, "Green Sun's Twilight").abilities?.[0]?.steps || [];
    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'twilight-1',
      sourceName: "Green Sun's Twilight",
      xValue: 1,
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    const choiceStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);

    expect(choiceStep).toBeTruthy();
    expect((choiceStep as any)?.availableCards).toHaveLength(2);
    expect((choiceStep as any)?.maxSelections).toBe(2);
    expect((choiceStep as any)?.remainderDestination).toBe('bottom');
    expect((choiceStep as any)?.remainderRandomOrder).toBe(true);
    expect(String((choiceStep as any)?.oracleIrChoiceStepJson || '')).toContain('player_choice');
    expect(String((choiceStep as any)?.oracleIrResumeStepsJson || '')).toContain('move_zone');
    expect(String((choiceStep as any)?.oracleIrResumeStepsJson || '')).not.toContain('grant_static_ability');

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(choiceStep!.id), {
      stepId: String(choiceStep!.id),
      playerId: p1,
      selections: ['lib-2'],
      cancelled: false,
      timestamp: Date.now(),
    });

    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    const updatedPlayer = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect((updatedPlayer.hand || []).map((card: any) => card.id)).toEqual(['lib-2']);
    expect((updatedPlayer.library || []).map((card: any) => card.id)).toEqual(['lib-3', 'lib-1']);
  });

  it("queues destination choice when X is 5 and resumes move to battlefield", () => {
    const gameId = 'oracle_ir_reveal_player_choice_twilight_x5';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupTwilightLibrary(game, p1);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(GREEN_SUNS_TWILIGHT_TEXT, "Green Sun's Twilight").abilities?.[0]?.steps || [];
    const moveStep = steps.find((step) => step.kind === 'move_zone');
    expect((moveStep as any)?.xAtLeastAlternate?.threshold).toBe(5);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'twilight-1',
      sourceName: "Green Sun's Twilight",
      xValue: 5,
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect(Number((searchStep as any)?.oracleIrXValue)).toBe(5);

    const completedSearch = ResolutionQueueManager.completeStep(gameId, String(searchStep!.id), {
      stepId: String(searchStep!.id),
      playerId: p1,
      selections: ['lib-2'],
      cancelled: false,
      timestamp: Date.now(),
    });

    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedSearch, completedSearch!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedSearch);

    const destinationStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any).oracleIrMoveZoneDestinationChoice);
    expect(destinationStep).toBeTruthy();

    const completedDestination = ResolutionQueueManager.completeStep(gameId, String(destinationStep!.id), {
      stepId: String(destinationStep!.id),
      playerId: p1,
      selections: ['battlefield'],
      cancelled: false,
      timestamp: Date.now(),
    });

    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedDestination, completedDestination!.response!);

    const elvesOnBattlefield = ((game.state as any).battlefield || []).some(
      (perm: any) => String(perm?.card?.name || perm?.name || '') === 'Llanowar Elves',
    );
    expect(elvesOnBattlefield).toBe(true);
    expect((game.state as any).zones[p1].library.map((card: any) => card.id)).toEqual(['lib-1', 'lib-3']);
  });
});

describe("oracle IR Green Sun's Twilight live stack path", () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_SPELL_LEGACY;

  beforeEach(() => {
    ensureLocalCardLookupIndexSync();
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

  it('uses direct IR for reveal/player_choice compounds instead of Effect Program', () => {
    const steps = parseOracleTextToIR(GREEN_SUNS_TWILIGHT_TEXT, "Green Sun's Twilight").abilities?.[0]?.steps || [];
    expect(requiresEffectProgramOrchestration(steps as any)).toBe(true);
    expect(requiresSpellEffectProgramOrchestration(steps as any)).toBe(false);
  });

  it('queues LIBRARY_SEARCH when resolveTopOfStack resolves with X=1', () => {
    const card = lookupLocalCardByNameSync("Green Sun's Twilight");
    const gameId = 'oracle_ir_greensun_stack_choice';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const deckCard: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'greensun-stack',
      name: card!.name,
      type_line: card!.type_line,
      oracle_text: card!.oracle_text,
      mana_cost: card!.mana_cost,
    };

    g.importDeckResolved(p1, [deckCard] as any);
    g.drawCards(p1, 1);
    setupTwilightLibrary(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: deckCard.id,
      targets: [],
      xValue: 1,
    } as any);

    g.resolveTopOfStack();

    const choiceStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(choiceStep).toBeTruthy();
    expect((choiceStep as any)?.effectProgramPrompt).toBeFalsy();
    expect((choiceStep as any)?.availableCards).toHaveLength(2);
    expect(((g.state as any).stack || [])).toHaveLength(0);
  });

  it('completes hand path via stack resolve and LIBRARY_SEARCH resume', () => {
    const card = lookupLocalCardByNameSync("Green Sun's Twilight");
    const gameId = 'oracle_ir_greensun_stack_resume';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const deckCard: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'greensun-stack-resume',
      name: card!.name,
      type_line: card!.type_line,
      oracle_text: card!.oracle_text,
      mana_cost: card!.mana_cost,
    };

    g.importDeckResolved(p1, [deckCard] as any);
    g.drawCards(p1, 1);
    setupTwilightLibrary(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: deckCard.id,
      targets: [],
      xValue: 1,
    } as any);

    g.resolveTopOfStack();

    const choiceStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(choiceStep).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(choiceStep!.id), {
      stepId: String(choiceStep!.id),
      playerId: p1,
      selections: ['lib-2'],
      cancelled: false,
      timestamp: Date.now(),
    });

    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    const updatedPlayer = (g.state as any).players.find((entry: any) => entry.id === p1);
    expect((updatedPlayer.hand || []).map((card: any) => card.id)).toEqual(['lib-2']);
    expect((updatedPlayer.library || []).map((card: any) => card.id)).toEqual(['lib-3', 'lib-1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});

describe('oracle IR trigger reveal → player_choice direct IR gate', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  it('uses direct IR for trigger reveal/player_choice compounds instead of Effect Program', () => {
    const steps = parseOracleTextToIR(GREEN_SUNS_TWILIGHT_TEXT, "Green Sun's Twilight").abilities?.[0]?.steps || [];
    expect(requiresEffectProgramOrchestration(steps as any)).toBe(true);
    expect(requiresTriggerEffectProgramOrchestration(steps as any)).toBe(false);
    expect(requiresSpellEffectProgramOrchestration(steps as any)).toBe(false);
  });

  it('queues LIBRARY_SEARCH when tryResolveTriggerViaOracleIR runs Green Sun effect text', () => {
    const gameId = 'oracle_ir_trigger_greensun_direct_ir';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupTwilightLibrary(game, p1);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: "Green Sun's Twilight",
      effectText: GREEN_SUNS_TWILIGHT_TEXT,
      triggerItem: { id: 'trigger-greensun-1', controller: p1, xValue: 1 },
    });

    expect(outcome.handled).toBe(true);

    const choiceStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(choiceStep).toBeTruthy();
    expect((choiceStep as any)?.effectProgramPrompt).toBeFalsy();
    expect((choiceStep as any)?.availableCards).toHaveLength(2);
  });

  it('completes hand path via tryResolveTriggerViaOracleIR and LIBRARY_SEARCH resume', () => {
    const gameId = 'oracle_ir_trigger_greensun_resume';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupTwilightLibrary(game, p1);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: "Green Sun's Twilight",
      effectText: GREEN_SUNS_TWILIGHT_TEXT,
      triggerItem: { id: 'trigger-greensun-resume', controller: p1, xValue: 1 },
    });

    expect(outcome.handled).toBe(true);

    const choiceStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(choiceStep).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(choiceStep!.id), {
      stepId: String(choiceStep!.id),
      playerId: p1,
      selections: ['lib-2'],
      cancelled: false,
      timestamp: Date.now(),
    });

    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    const updatedPlayer = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect((updatedPlayer.hand || []).map((card: any) => card.id)).toEqual(['lib-2']);
    expect((updatedPlayer.library || []).map((card: any) => card.id)).toEqual(['lib-3', 'lib-1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
