import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { categorizeSpell } from '../src/rules-engine/targeting.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { wasSpellCastFromGraveyard } from '../src/state/modules/stackResolveSpellCopyChoiceUtils.js';
import {
  applyInstantSorceryFracturedIdentityAndFallbackRiders,
  applyInstantSorceryGraveyardConditionalTokenRider,
} from '../src/state/modules/stackResolveSpellPostCategorizeRidersUtils.js';
import { applyRetiredTriggerLegacyCreateCreatureToken } from '../src/state/modules/oracleIrTriggerLegacyTokenHandlers.js';
import { applyOracleIRUncategorizedSpellFallback } from '../src/state/modules/oracleIrUncategorizedSpellFallback.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import * as uncategorizedUtils from '../src/state/modules/stackResolveSpellUncategorizedUtils.js';
import * as triggerUtils from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('graveyard conditional token rider', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await resetGame('devotion_probe');
  });

  it('categorizeSpell does not match Increasing Devotion multi-clause oracle', () => {
    const oracleText =
      'Create five 1/1 white Human creature tokens. If this spell was cast from a graveyard, create ten of those tokens instead.\nFlashback {7}{W}{W}';
    const spec = categorizeSpell('Increasing Devotion', oracleText);
    expect(spec).toBeNull();
  });

  it('adds supplemental tokens when IR already created the base count', () => {
    const playerId = 'p1';
    const oracleText =
      'Create five 1/1 white Human creature tokens. If this spell was cast from a graveyard, create ten of those tokens instead.\nFlashback {7}{W}{W}';
    const ctx: any = {
      state: {
        battlefield: Array.from({ length: 5 }, (_, index) => ({
          id: `human_${index}`,
          isToken: true,
          controller: playerId,
          card: { type_line: 'Token Creature - Human', name: 'Human' },
          basePower: 1,
          baseToughness: 1,
        })),
      },
      bumpSeq: () => {},
    };
    const item = {
      castFromGraveyard: true,
      card: { castWithAbility: 'flashback', name: 'Increasing Devotion' },
    };

    applyInstantSorceryGraveyardConditionalTokenRider(ctx, {
      controller: playerId,
      card: item.card,
      effectiveCard: { name: 'Increasing Devotion' },
      item,
      oracleText,
      oracleTextLower: oracleText.toLowerCase(),
      targets: [],
      spellXValue: undefined,
      uncategorizedSpellFallbackApplied: 0,
    });

    expect(ctx.state.battlefield).toHaveLength(10);
  });

  it('FracturedIdentity fallback creates ten tokens on graveyard flashback cast', () => {
    const playerId = 'p1';
    const oracleText =
      'Create five 1/1 white Human creature tokens. If this spell was cast from a graveyard, create ten of those tokens instead.\nFlashback {7}{W}{W}';
    const item = { castFromGraveyard: true, card: { castWithAbility: 'flashback', name: 'Increasing Devotion' } };
    const ctx: any = { state: { battlefield: [] }, bumpSeq: () => {} };

    applyInstantSorceryFracturedIdentityAndFallbackRiders(ctx, {
      controller: playerId,
      card: item.card,
      effectiveCard: { name: 'Increasing Devotion' },
      item,
      oracleText,
      oracleTextLower: oracleText.toLowerCase(),
      targets: [],
      spellXValue: undefined,
      uncategorizedSpellFallbackApplied: 0,
    });

    expect(ctx.state.battlefield).toHaveLength(10);
  });

  it('FracturedIdentity supplements tokens after uncategorized IR fallback', () => {
    const playerId = 'p1';
    const oracleText =
      'Create five 1/1 white Human creature tokens. If this spell was cast from a graveyard, create ten of those tokens instead.\nFlashback {7}{W}{W}';
    const item = { castFromGraveyard: true, card: { castWithAbility: 'flashback', name: 'Increasing Devotion', castFromGraveyard: true } };
    const ctx: any = {
      state: {
        battlefield: Array.from({ length: 5 }, (_, index) => ({
          id: `human_${index}`,
          isToken: true,
          controller: playerId,
          card: { type_line: 'Token Creature — Human', name: 'Human' },
          basePower: 1,
          baseToughness: 1,
        })),
      },
      bumpSeq: () => {},
    };

    applyInstantSorceryFracturedIdentityAndFallbackRiders(ctx, {
      controller: playerId,
      card: item.card,
      effectiveCard: { name: 'Increasing Devotion' },
      item,
      oracleText,
      oracleTextLower: oracleText.toLowerCase(),
      targets: [],
      spellXValue: undefined,
      uncategorizedSpellFallbackApplied: 1,
    });

    expect(ctx.state.battlefield).toHaveLength(10);
  });

  it('integration-style flashback resolution invokes graveyard rider and creates ten tokens', async () => {
    const gameId = 'devotion_probe';
    const playerId = 'p1';
    const oracleText =
      'Create five 1/1 white Human creature tokens. If this spell was cast from a graveyard, create ten of those tokens instead.\nFlashback {7}{W}{W}';

    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('missing game');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [{
          id: 'devotion_1',
          name: 'Increasing Devotion',
          type_line: 'Sorcery',
          oracle_text: oracleText,
          zone: 'graveyard',
        }],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 7 },
    };

    const uncategorizedSpy = vi.spyOn(uncategorizedUtils, 'tryApplyInstantSorceryUncategorizedSpellFallback');

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'devotion_1',
      abilityId: 'flashback',
      stackId: 'stack_devotion_1',
      manaCost: '{7}{W}{W}',
    } as any);

    const stackItem = (game.state as any).stack?.[0];
    expect(wasSpellCastFromGraveyard(stackItem)).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const humanTokens = ((game.state as any).battlefield || []).filter(
      (perm: any) => perm?.isToken === true && String(perm?.card?.type_line || '').includes('Human'),
    );

    expect(uncategorizedSpy).toHaveBeenCalled();
    expect(humanTokens).toHaveLength(10);

    uncategorizedSpy.mockRestore();
  });

  it('IR uncategorized fallback creates Goat token from ETB trigger text', () => {
    const playerId = 'p1';
    const description = 'create a 0/1 white Goat creature token';
    const steps = collectOracleEffectSteps(description, 'Woe Strider');
    expect(steps.some((step) => step.kind === 'create_token')).toBe(true);

    const ctx: any = {
      gameId: 'goat_probe',
      state: {
        players: [{ id: playerId, name: 'P1' }],
        battlefield: [],
        zones: { [playerId]: { library: [], libraryCount: 0, graveyard: [], hand: [] } },
      },
      bumpSeq: () => {},
    };

    const applied = applyOracleIRUncategorizedSpellFallback(
      ctx,
      description,
      playerId,
      'Woe Strider',
      undefined,
      'woe_1',
      undefined,
      false,
      { controllerId: playerId, sourceName: 'Woe Strider', sourceId: 'woe_1' },
      'ability',
    );
    expect(applied).toBeGreaterThan(0);
    const goatToken = (ctx.state.battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '').toLowerCase() === 'goat',
    );
    expect(goatToken).toBeDefined();
    expect(goatToken?.basePower).toBe(0);
    expect(goatToken?.baseToughness).toBe(1);
  });

  it('executeTriggerEffect creates Goat token for Woe Strider ETB clause', () => {
    const playerId = 'p1';
    const oracleText =
      'When this creature enters, create a 0/1 white Goat creature token.\nSacrifice another creature: Scry 1.\nEscape—{3}{B}{B}, Exile four other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)\nThis creature escapes with two +1/+1 counters on it.';
    const ctx: any = {
      gameId: 'goat_execute_probe',
      state: {
        players: [{ id: playerId, name: 'P1' }],
        battlefield: [{
          id: 'woe_1',
          controller: playerId,
          card: {
            name: 'Woe Strider',
            type_line: 'Creature — Horror',
            oracle_text: oracleText,
          },
        }],
        zones: { [playerId]: { library: [], libraryCount: 0, graveyard: [], hand: [] } },
      },
      bumpSeq: () => {},
    };

    triggerUtils.executeTriggerEffect(
      ctx,
      playerId,
      'Woe Strider',
      'create a 0/1 white Goat creature token',
      {
        type: 'triggered_ability',
        controller: playerId,
        source: 'woe_1',
        permanentId: 'woe_1',
        sourceName: 'Woe Strider',
        description: 'create a 0/1 white Goat creature token',
        effect: 'create a 0/1 white Goat creature token',
        triggerType: 'etb',
        card: ctx.state.battlefield[0].card,
      },
    );

    const goatToken = (ctx.state.battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '').toLowerCase() === 'goat',
    );
    expect(goatToken).toBeDefined();
  });

  it('retired trigger create handler defers to IR uncategorized fallback', () => {
    const playerId = 'p1';
    const description = 'create a 0/1 white Goat creature token';
    const ctx: any = { state: { battlefield: [] }, bumpSeq: () => {} };

    const handled = applyRetiredTriggerLegacyCreateCreatureToken({
      ctx,
      controller: playerId,
      sourceName: 'Woe Strider',
      desc: description.toLowerCase(),
      description,
      triggerItem: { source: 'woe_1' },
      state: ctx.state,
    });

    expect(handled).toBe(false);
    expect(ctx.state.battlefield).toHaveLength(0);
  });

  it('integration-style escape Woe Strider queues ETB and creates a Goat token', async () => {
    const gameId = 'woe_probe';
    const playerId = 'p1';
    const oracleText =
      'When this creature enters, create a 0/1 white Goat creature token.\nSacrifice another creature: Scry 1.\nEscape—{3}{B}{B}, Exile four other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)\nThis creature escapes with two +1/+1 counters on it.';

    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('missing game');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [], handCount: 0, library: [], libraryCount: 0,
        graveyard: [{
          id: 'woe_strider_1',
          name: 'Woe Strider',
          type_line: 'Creature — Horror',
          mana_cost: '{2}{B}',
          oracle_text: oracleText,
          power: '3', toughness: '2', zone: 'graveyard',
        },
          { id: 'woe_escape_cost_1', name: 'Cost One', type_line: 'Instant', oracle_text: '', zone: 'graveyard' },
          { id: 'woe_escape_cost_2', name: 'Cost Two', type_line: 'Sorcery', oracle_text: '', zone: 'graveyard' },
          { id: 'woe_escape_cost_3', name: 'Cost Three', type_line: 'Creature - Human', oracle_text: '', zone: 'graveyard' },
          { id: 'woe_escape_cost_4', name: 'Cost Four', type_line: 'Enchantment', oracle_text: '', zone: 'graveyard' },
        ],
        graveyardCount: 5, exile: [], exileCount: 0,
      },
    };
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = { [playerId]: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 3 } };

    const emitted: any[] = [];
    const io = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
    const handlers: Record<string, Function> = {};
    const socket = {
      data: { playerId, spectator: false, gameId },
      rooms: new Set([gameId]),
      on: (e: string, h: Function) => { handlers[e] = h; },
      emit: () => {},
    };
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({ gameId, cardId: 'woe_strider_1', abilityId: 'escape' });
    const exileCostStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(exileCostStep.id),
      selections: ['woe_escape_cost_1', 'woe_escape_cost_2', 'woe_escape_cost_3', 'woe_escape_cost_4'],
    });

    game.resolveTopOfStack();
    const stackAfterCreature = [...((game.state as any).stack || [])];
    expect(stackAfterCreature.length).toBeGreaterThan(0);

    game.resolveTopOfStack();

    const goatToken = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.name || '').toLowerCase() === 'goat',
    );
    expect(goatToken).toBeDefined();
  });
});
