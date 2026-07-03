import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KnownCardRef, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { lookupLocalCardByNameSync, ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { isSpellEffectFullyIrWired } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import {
  isTriggerEffectFullyIrWired,
} from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { requiresTriggerEffectProgramOrchestration } from '../src/state/modules/oracleIrEffectProgramServer.js';
import { tryResolveTriggerViaOracleIR } from '../src/state/modules/oracleIrTriggerExecution.js';
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

function setupKindredSummonsFixtures(g: any, p1: PlayerID) {
  const library = [
    { id: 'lib-1', name: 'Merfolk Spy', type_line: 'Creature — Merfolk Rogue', zone: 'library' },
    { id: 'lib-2', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
    { id: 'lib-3', name: 'Lord of Atlantis', type_line: 'Creature — Merfolk', zone: 'library' },
  ];
  (g as any).libraries = (g as any).libraries || new Map();
  (g as any).libraries.set(p1, library.map((entry) => ({ ...entry })));
  const player = (g.state as any).players.find((entry: any) => entry.id === p1);
  player.library = library.map((entry) => ({ ...entry }));
  ensureZonesForPlayer(g, p1);
  (g.state as any).zones[p1].library = library.map((entry) => ({ ...entry }));
  (g.state as any).zones[p1].libraryCount = library.length;
  (g.state as any).battlefield = [{
    id: 'bf-1',
    controller: p1,
    owner: p1,
    card: { id: 'c-looter', name: 'Merfolk Looter', type_line: 'Creature — Merfolk', zone: 'battlefield' },
  }];
}

describe('oracle IR Kindred Summons reveal-until-chosen-type', () => {
  it('puts revealed matching creatures onto the battlefield after creature type choice', () => {
    ensureLocalCardLookupIndexSync();
    const card = lookupLocalCardByNameSync('Kindred Summons');
    expect(card?.oracle_text).toBeTruthy();

    const gameId = 'oracle_ir_kindred_summons';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupKindredSummonsFixtures(game, p1);
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(String(card!.oracle_text), 'Kindred Summons').abilities?.[0]?.steps || [];
    expect(steps[0]?.kind).toBe('choose_creature_type');
    expect(steps.some((step) => step.kind === 'reveal_top')).toBe(true);
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(true);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'kindred-1',
      sourceName: 'Kindred Summons',
      selectorContext: { chosenCreatureType: 'Merfolk' },
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    const typeStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.CREATURE_TYPE_CHOICE);
    expect(typeStep).toBeFalsy();

    const battlefieldNames = ((game.state as any).battlefield || [])
      .map((perm: any) => perm?.card?.name)
      .filter(Boolean);
    expect(battlefieldNames).toContain('Merfolk Looter');
    expect(battlefieldNames).toContain('Merfolk Spy');
    expect(battlefieldNames).not.toContain('Lord of Atlantis');

    const updatedLibrary = ((game.state as any).zones?.[p1]?.library || player.library || [])
      .map((entry: any) => entry.id);
    expect(updatedLibrary).toHaveLength(2);
    expect(updatedLibrary).toContain('lib-2');
    expect(updatedLibrary).toContain('lib-3');
  });
});

describe('oracle IR Kindred Summons live stack path', () => {
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

  it('reports Kindred Summons as fully IR-wired including reveal_top', () => {
    const card = lookupLocalCardByNameSync('Kindred Summons');
    expect(isSpellEffectFullyIrWired(String(card!.oracle_text), 'Kindred Summons')).toBe(true);
  });

  it('queues Effect Program creature type choice when resolveTopOfStack has no preset type', () => {
    const card = lookupLocalCardByNameSync('Kindred Summons');
    const gameId = 'oracle_ir_kindred_summons_stack_choice';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const deckCard: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'kindred-summons-stack',
      name: card!.name,
      type_line: card!.type_line,
      oracle_text: card!.oracle_text,
      mana_cost: card!.mana_cost,
    };

    g.importDeckResolved(p1, [deckCard] as any);
    g.drawCards(p1, 1);
    setupKindredSummonsFixtures(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: deckCard.id,
      targets: [],
    });

    g.resolveTopOfStack();

    const typeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.CREATURE_TYPE_CHOICE);
    expect(typeStep).toBeTruthy();
    expect((typeStep as any)?.effectProgramPrompt).toBe(true);
    // CR 608.2m: the spell stays on the stack (deferred finalize) until its
    // queued resolution choices complete.
    const stack = (g.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect((stack[0] as any)?.oracleIrDeferredFinalize).toBe(true);
  });

  it('completes Merfolk reveal-until via resumeEffectProgramResolution under production default', () => {
    const card = lookupLocalCardByNameSync('Kindred Summons');
    const gameId = 'oracle_ir_kindred_summons_stack_resume';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const deckCard: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'mana_cost'> = {
      id: 'kindred-summons-resume',
      name: card!.name,
      type_line: card!.type_line,
      oracle_text: card!.oracle_text,
      mana_cost: card!.mana_cost,
    };

    g.importDeckResolved(p1, [deckCard] as any);
    g.drawCards(p1, 1);
    setupKindredSummonsFixtures(g, p1);
    const player = (g.state as any).players.find((entry: any) => entry.id === p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: deckCard.id,
      targets: [],
    });

    g.resolveTopOfStack();

    const typeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.CREATURE_TYPE_CHOICE);
    expect(typeStep).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(typeStep!.id), {
      stepId: String(typeStep!.id),
      playerId: p1,
      selections: ['Merfolk'],
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

    const battlefieldNames = ((g.state as any).battlefield || [])
      .map((perm: any) => perm?.card?.name)
      .filter(Boolean);
    expect(battlefieldNames).toContain('Merfolk Looter');
    expect(battlefieldNames).toContain('Merfolk Spy');
    expect(battlefieldNames).not.toContain('Lord of Atlantis');

    const updatedLibrary = ((g.state as any).zones?.[p1]?.library || player.library || [])
      .map((entry: any) => entry.id);
    expect(updatedLibrary).toHaveLength(2);
    expect(updatedLibrary).toContain('lib-2');
    expect(updatedLibrary).toContain('lib-3');
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});

describe('oracle IR Kindred Summons trigger Effect Program path', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeEach(() => {
    ensureLocalCardLookupIndexSync();
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  it('requires Effect Program for choose_creature_type compounds on trigger path', () => {
    const card = lookupLocalCardByNameSync('Kindred Summons');
    const steps = parseOracleTextToIR(String(card!.oracle_text), 'Kindred Summons').abilities?.[0]?.steps || [];
    expect(requiresTriggerEffectProgramOrchestration(steps as any)).toBe(true);
    expect(isTriggerEffectFullyIrWired(String(card!.oracle_text), 'Kindred Summons')).toBe(true);
  });

  it('queues Effect Program creature type choice and completes reveal-until via trigger IR', () => {
    const card = lookupLocalCardByNameSync('Kindred Summons');
    const gameId = 'oracle_ir_kindred_trigger_ep';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupKindredSummonsFixtures(g, p1);
    const player = (g.state as any).players.find((entry: any) => entry.id === p1);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Kindred Summons',
      effectText: String(card!.oracle_text),
      triggerItem: { id: 'trigger-kindred-1', controller: p1 },
    });

    expect(outcome.handled).toBe(true);

    const typeStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.CREATURE_TYPE_CHOICE);
    expect(typeStep).toBeTruthy();
    expect((typeStep as any)?.effectProgramPrompt).toBe(true);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(typeStep!.id), {
      stepId: String(typeStep!.id),
      playerId: p1,
      selections: ['Merfolk'],
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

    const battlefieldNames = ((g.state as any).battlefield || [])
      .map((perm: any) => perm?.card?.name)
      .filter(Boolean);
    expect(battlefieldNames).toContain('Merfolk Looter');
    expect(battlefieldNames).toContain('Merfolk Spy');
    expect(battlefieldNames).not.toContain('Lord of Atlantis');

    const updatedLibrary = ((g.state as any).zones?.[p1]?.library || player.library || [])
      .map((entry: any) => entry.id);
    expect(updatedLibrary).toHaveLength(2);
    expect(updatedLibrary).toContain('lib-2');
    expect(updatedLibrary).toContain('lib-3');
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});

describe('oracle IR reveal → player_choice among-them queue adapter', () => {
  it("resume steps omit bogus Green Sun's Twilight pass36 grant_static rider", () => {
    const GREEN_SUNS_TWILIGHT_TEXT =
      "Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.";

    const gameId = 'oracle_ir_reveal_player_choice_twilight_resume';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const library = [
      { id: 'lib-1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
      { id: 'lib-2', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'library' },
      { id: 'lib-3', name: 'Lightning Bolt', type_line: 'Instant', zone: 'library' },
    ];
    (game as any).libraries.set(p1, library.map((entry) => ({ ...entry })));
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = library.map((entry) => ({ ...entry }));
    (game.state as any).zones[p1].library = library.map((entry) => ({ ...entry }));

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(GREEN_SUNS_TWILIGHT_TEXT, "Green Sun's Twilight").abilities?.[0]?.steps || [];
    expect(steps.some((step) => step.kind === 'grant_static_ability')).toBe(false);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: "Green Sun's Twilight",
      xValue: 1,
    });
    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    const choiceStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(String((choiceStep as any)?.oracleIrResumeStepsJson || '')).not.toContain('grant_static_ability');
  });
});
