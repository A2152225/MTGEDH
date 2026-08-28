import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { tryResolveTriggerViaOracleIR } from '../src/state/modules/oracleIrTriggerExecution.js';
import { collectTriggerExecutionSteps } from '../src/state/modules/oracleIrTriggerExecutionHelpers.js';
import { resolveTriggerStackItemEffectText } from '../src/state/modules/triggerStackItemEffectText.js';
import { processOpponentSpellCastTriggersForCast } from '../src/socket/game-actions-handlers/gameActionsSpellCastTriggerProcessing.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';

const POSSIBILITY_STORM_ORACLE =
  'Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put all cards exiled with Possibility Storm on the bottom of their library in a random order.';

function setP2Library(game: any, p2: PlayerID, library: any[]) {
  (game as any).libraries = (game as any).libraries || new Map();
  (game as any).libraries.set(p2, library.map((entry) => ({ ...entry })));
  const player = (game.state as any).players.find((entry: any) => entry.id === p2);
  if (player) player.library = library.map((entry) => ({ ...entry }));
  (game.state as any).zones = (game.state as any).zones || {};
  (game.state as any).zones[p2] = (game.state as any).zones[p2] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
  (game.state as any).zones[p2].library = library.map((entry) => ({ ...entry }));
  (game.state as any).zones[p2].libraryCount = library.length;
}

function setupStormGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);

  const library = [
    { id: 'p2c1', name: 'Forest', type_line: 'Basic Land — Forest' },
    { id: 'p2c2', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
    { id: 'p2c3', name: 'Shock', type_line: 'Instant' },
    { id: 'p2c4', name: 'Opt', type_line: 'Instant' },
  ];
  setP2Library(game, p2, library);

  (game.state as any).battlefield = [
    {
      id: 'perm_storm',
      controller: p1,
      owner: p1,
      card: {
        id: 'storm_card',
        name: 'Possibility Storm',
        type_line: 'Enchantment',
        oracle_text: POSSIBILITY_STORM_ORACLE,
      },
    },
  ];
  (game.state as any).stack = [
    {
      id: 'stack_bolt',
      type: 'spell',
      controller: p2,
      owner: p2,
      card: {
        id: 'bolt_1',
        name: 'Lightning Bolt',
        type_line: 'Instant',
      },
    },
  ];

  (game as any).gameId = gameId;
  (game as any).io = { to: () => ({ emit: vi.fn() }) };
  (game as any).bumpSeq = vi.fn();
  ResolutionQueueManager.removeQueue(gameId);

  return { game, p1, p2 };
}

function persistOnCastTriggerItem(game: any, p1: PlayerID, p2: PlayerID) {
  const detected = detectOpponentSpellCastTriggers(
    (game.state as any).battlefield[0].card,
    (game.state as any).battlefield[0],
  );
  const trigger = detected.find((entry) => entry.casterScope === 'any_player') || detected[0];
  expect(trigger).toBeTruthy();

  return {
    id: 'trigger_storm_1',
    type: 'triggered_ability',
    controller: p1,
    source: 'perm_storm',
    permanentId: 'perm_storm',
    sourceName: 'Possibility Storm',
    description: trigger.description,
    triggerType: trigger.triggerType,
    mandatory: trigger.mandatory,
    targetPlayer: String(p2),
    triggeringPlayer: String(p2),
    triggeringStackItemId: 'stack_bolt',
    triggeringSpellCastSourceZone: 'hand',
    effectData: {
      casterId: p2,
      castSourceZone: 'hand',
      sourceCastZone: 'hand',
      triggeringStackItemId: 'stack_bolt',
      triggeringSpell: {
        id: 'bolt_1',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        castSourceZone: 'hand',
      },
      paymentCost: trigger.paymentCost,
      paymentAmount: trigger.paymentAmount,
      benefitIfNotPaid: trigger.benefitIfNotPaid,
    },
  };
}

describe('Possibility Storm live trigger resolution', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
    vi.unstubAllEnvs();
  });

  it('uses local Possibility Storm oracle', () => {
    const card = lookupLocalCardByNameSync('Possibility Storm');
    expect(String(card?.oracle_text || '')).toMatch(/shares a card type with it/i);
  });

  it('detects a fully-wired exile-until-shared-type effect, not a truncated from-hand fragment', () => {
    const detected = detectOpponentSpellCastTriggers(
      {
        name: 'Possibility Storm',
        oracle_text: POSSIBILITY_STORM_ORACLE,
      },
      { id: 'perm_storm', controller: 'p1' },
    );
    const trigger = detected.find((entry) => entry.casterScope === 'any_player');
    expect(trigger).toBeTruthy();
    expect(String(trigger!.benefitIfNotPaid || '')).toMatch(/^that player exiles it/i);
    expect(String(trigger!.benefitIfNotPaid || '')).not.toMatch(/^from their hand/i);
    expect(trigger!.sourceZoneRequirement).toBe('hand');

    const steps = collectTriggerExecutionSteps(String(trigger!.benefitIfNotPaid), 'Possibility Storm');
    expect(steps.some((step) => step.kind === 'move_zone')).toBe(true);
    expect(steps.some((step) => step.kind === 'impulse_exile_top')).toBe(true);
  });

  it('exiles the cast spell and impulse-exiles until a shared type via executeTriggerEffect', () => {
    const { game, p1, p2 } = setupStormGame('possibility_storm_execute_trigger');
    const triggerItem = persistOnCastTriggerItem(game, p1, p2);
    const effectText = resolveTriggerStackItemEffectText(triggerItem, { state: game.state });

    const outcome = tryResolveTriggerViaOracleIR(game as any, {
      controller: p1,
      sourceName: 'Possibility Storm',
      effectText,
      triggerItem,
    });
    expect(outcome.handled, JSON.stringify({
      handled: outcome.handled,
      applied: outcome.applied,
      effectText,
    })).toBe(true);

    const stack = (game.state as any).stack || [];
    const p2Player = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(stack.some((entry: any) => String(entry?.id || '') === 'stack_bolt')).toBe(false);
    expect((p2Player.exile || []).some((card: any) => String(card?.id || '') === 'p2c3')).toBe(true);
  });

  it('resolves the stacked trigger through resolveTopOfStack', () => {
    const { game, p2 } = setupStormGame('possibility_storm_resolve_top');
    const io = { to: () => ({ emit: vi.fn() }) } as any;
    processOpponentSpellCastTriggersForCast(
      'possibility_storm_resolve_top',
      game,
      io,
      p2,
      { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' },
      'hand',
      'stack_bolt',
    );

    const trigger = ((game.state as any).stack || []).find((item: any) => item?.type === 'triggered_ability');
    expect(trigger?.sourceName).toBe('Possibility Storm');

    game.resolveTopOfStack();

    const stack = (game.state as any).stack || [];
    const p2Player = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(stack.some((entry: any) => String(entry?.id || '') === 'stack_bolt')).toBe(false);
    expect((p2Player.exile || []).some((card: any) => String(card?.id || '') === 'p2c3')).toBe(true);

    const prompt = ResolutionQueueManager.getQueue('possibility_storm_resolve_top').steps.find(
      (step: any) => String(step?.castFromExileCardId || '') === 'p2c3',
    );
    expect(prompt).toBeTruthy();
    expect((prompt as any).playerId).toBe(p2);
    ResolutionQueueManager.removeQueue('possibility_storm_resolve_top');
  });

  it('exiles the caster spell when the live trigger omitted triggeringStackItemId (G1)', () => {
    const { game, p1, p2 } = setupStormGame('possibility_storm_g1_unbound');
    const triggerItem = {
      id: 'trigger_storm_g1',
      type: 'triggered_ability',
      controller: p1,
      source: 'perm_storm',
      permanentId: 'perm_storm',
      sourceName: 'Possibility Storm',
      description: POSSIBILITY_STORM_ORACLE,
      triggerType: 'any_player_casts_any',
      mandatory: false,
      triggeringPlayer: String(p2),
      targetPlayer: String(p2),
      effectData: {
        casterId: p2,
        triggeringSpell: {
          id: 'bolt_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
        },
      },
    };

    const outcome = tryResolveTriggerViaOracleIR(game as any, {
      controller: p1,
      sourceName: 'Possibility Storm',
      effectText: POSSIBILITY_STORM_ORACLE,
      triggerItem,
    });
    expect(outcome.handled).toBe(true);

    const stack = (game.state as any).stack || [];
    const p2Player = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(stack.some((entry: any) => String(entry?.id || '') === 'stack_bolt')).toBe(false);
    expect((p2Player.exile || []).some((card: any) => String(card?.id || '') === 'p2c3')).toBe(true);
  });

  it('binds the topmost remaining spell after the trigger pops with only triggerType', () => {
    const { game, p1, p2 } = setupStormGame('possibility_storm_g1_top_spell');
    const triggerItem = {
      id: 'trigger_storm_top',
      type: 'triggered_ability',
      controller: p1,
      source: 'perm_storm',
      permanentId: 'perm_storm',
      sourceName: 'Possibility Storm',
      description: POSSIBILITY_STORM_ORACLE,
      triggerType: 'any_player_casts_any',
    };
    (game.state as any).stack.push(triggerItem);
    game.resolveTopOfStack();

    const stack = (game.state as any).stack || [];
    const p2Player = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(stack.some((entry: any) => String(entry?.id || '') === 'stack_bolt')).toBe(false);
    expect((p2Player.exile || []).some((card: any) => String(card?.id || '') === 'p2c3')).toBe(true);
    ResolutionQueueManager.removeQueue('possibility_storm_g1_top_spell');
  });

  it('does not treat Possibility Storm as a controller Yes/No may', () => {
    const { game, p1, p2 } = setupStormGame('possibility_storm_not_optional_may');
    const triggerItem = persistOnCastTriggerItem(game, p1, p2);
    (game.state as any).stack.push(triggerItem);
    game.resolveTopOfStack();

    const stack = (game.state as any).stack || [];
    expect(stack.some((entry: any) => String(entry?.id || '') === 'stack_bolt')).toBe(false);
    ResolutionQueueManager.removeQueue('possibility_storm_not_optional_may');
  });
});
