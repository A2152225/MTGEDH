import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { skipRetiredSpellLegacyHandler } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import {
  applyLegacySpellRegexDrawHandlers,
} from '../src/state/modules/stackResolveSpellLegacyRegexDrawUtils.js';
import { applyInstantSorceryLibraryTopCardPromptHandlers } from '../src/state/modules/stackResolveSpellLibraryTopPromptUtils.js';
import { applyInstantSorcerySpecialAndRemovalRiders } from '../src/state/modules/stackResolveSpellLateRidersUtils.js';
import { executeInstantSorceryLegacyCategorizedSpell } from '../src/state/modules/stackResolveSpellLegacySpecUtils.js';
import { categorizeSpellWithoutPrimaryRetirement } from '../src/rules-engine/targeting.js';
import { tryApplyInstantSorceryLegacyBodyHandlers } from '../src/state/modules/stackResolveInstantSorceryLegacyBodyUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('retired spell legacy handler defense-in-depth', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    ResolutionQueueManager.removeQueue('spell_scry_categorize_retirement');
    ResolutionQueueManager.removeQueue('spell_surveil_categorize_retirement');
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('legacy compound draw regex handlers no-op when IR primary owns simple draw text', { timeout: 15000 }, () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_handler_retirement');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }, { id: 'lib-2', name: 'Forest', zone: 'library' }];
    player.hand = [];

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const effectiveCard = { name: 'Test Divination' };

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: p1,
      effectiveCard,
      oracleTextLower: 'draw two cards.',
    });
    expect(player.hand.length).toBe(0);
  });

  it('skipRetiredSpellLegacyHandler defers duplicate prevention to orchestrators', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(skipRetiredSpellLegacyHandler('Draw two cards.', 'Divination')).toBe(false);
    expect(skipRetiredSpellLegacyHandler('Each player discards two cards.', 'Wheel')).toBe(false);
    expect(skipRetiredSpellLegacyHandler('Each player mills two cards.', 'Glimpse')).toBe(false);
    expect(skipRetiredSpellLegacyHandler('Do something utterly non-oracular.', 'Spell')).toBe(false);
  });

  it('legacy categorized spell execution no-ops when IR primary owns draw text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_categorize_retirement');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
    ];
    player.hand = [];

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const spellSpec = categorizeSpellWithoutPrimaryRetirement('Divination', 'Draw two cards.');
    expect(spellSpec?.op).toBe('DRAW_CARDS');

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'card-1', name: 'Divination' },
      effectiveCard: { name: 'Divination' },
      item: { id: 'stack-1' },
      oracleText: 'Draw two cards.',
      targets: [],
      spellSpec: spellSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });

    expect(player.hand.length).toBe(0);
  });

  it('library top prompt handlers no-op when IR primary owns scry text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_scry_retirement');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = 'spell_scry_retirement';

    applyInstantSorceryLibraryTopCardPromptHandlers(ctx, {
      controller: p1,
      effectiveCard: { name: 'Test Scry' },
      item: { id: 'stack-1' },
      oracleTextLower: 'scry 2.',
      spellXValue: undefined,
      targets: [],
    });

    expect((game.state as any).pendingScry?.[p1]).toBeUndefined();
  });

  it('removal rider wrapper no-ops when IR primary owns destroy spell text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_removal_retirement');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    const effectiveCard = { name: 'Murder' };

    const result = applyInstantSorcerySpecialAndRemovalRiders(ctx, {
      controller: p1,
      effectiveCard,
      item: { id: 'stack-1' },
      oracleTextLower: 'destroy target creature.',
      targets: ['perm-1'],
      targetControllerForRemovalEffects: undefined,
      targetPowerBeforeRemoval: undefined,
    });

    expect(result.shouldEarlyReturn).toBe(false);
  });

  it('legacy body handlers short-circuit when IR primary owns spell text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_body_retirement');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }];
    player.hand = [];
    const lifeBefore = player.life ?? 40;

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const effectiveCard = { name: 'Test Divination' };
    const oracleText = 'Draw two cards.';

    const result = tryApplyInstantSorceryLegacyBodyHandlers(
      ctx,
      {
        controller: p1,
        card: { id: 'spell-1', name: effectiveCard.name },
        effectiveCard,
        item: { id: 'stack-1' },
        targets: [],
        spellXValue: undefined,
        oracleText,
        oracleTextLower: oracleText.toLowerCase(),
        uncategorizedSpellFallbackApplied: 0,
      },
      {
        oracleIrSpellHandled: true,
        targetControllerForRemovalEffects: null,
        targetPowerBeforeRemoval: null,
      } as any,
    );

    expect(result.shouldEarlyReturn).toBe(false);
    expect(player.hand.length).toBe(0);
    expect(player.life ?? 40).toBe(lifeBefore);
  });

  it('legacy compound draw regex handler still applies when primary mode is off', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const game = createInitialGameState('spell_handler_legacy_draw');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Forest', zone: 'library' },
    ];
    player.hand = [];
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: player.library.map((card: any) => ({ ...card })),
        libraryCount: player.library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: p1,
      effectiveCard: { name: 'Chart a Course' },
      oracleTextLower: 'draw two cards, then discard a card.',
    });

    const handCount = (game.state as any).zones?.[p1]?.hand?.length ?? player.hand.length;
    const libraryCount = ctx.libraries.get(p1)?.length ?? player.library.length;
    expect(handCount).toBe(2);
    expect(libraryCount).toBe(0);
    expect((game.state as any).pendingDiscard?.[p1]?.count).toBe(1);
  });

  it('legacy draw-then-discard regex handler no-ops when IR primary owns Chart a Course text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_handler_chart_retirement');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Forest', zone: 'library' },
    ];
    player.hand = [];
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: player.library.map((card: any) => ({ ...card })),
        libraryCount: player.library.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: p1,
      effectiveCard: { name: 'Chart a Course' },
      oracleTextLower: 'draw two cards, then discard a card.',
    });

    const handCount = (game.state as any).zones?.[p1]?.hand?.length ?? player.hand.length;
    const libraryCount = ctx.libraries.get(p1)?.length ?? player.library.length;
    expect(handCount).toBe(0);
    expect(libraryCount).toBe(2);
    expect((game.state as any).pendingDiscard?.[p1]).toBeUndefined();
  });

  it('legacy wheel draw regex handlers no-op when IR primary owns Windfall text', { timeout: 15000 }, () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_wheel_windfall_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).zones = {
      [p1]: { hand: [{ id: 'h1', name: 'A' }], handCount: 1, graveyard: [], graveyardCount: 0 },
      [p2]: { hand: [{ id: 'h2', name: 'B' }, { id: 'h3', name: 'C' }], handCount: 2, graveyard: [], graveyardCount: 0 },
    };

    const ctx = game as any;
    ctx.libraries = new Map([
      [p1, Array.from({ length: 10 }, (_, index) => ({ id: `p1l${index}`, name: `L${index}`, zone: 'library' }))],
      [p2, Array.from({ length: 10 }, (_, index) => ({ id: `p2l${index}`, name: `L${index}`, zone: 'library' }))],
    ]);

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: p1,
      effectiveCard: { name: 'Windfall' },
      oracleTextLower: 'each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',
    });

    expect((game.state as any).zones[p1].hand).toHaveLength(1);
    expect((game.state as any).zones[p2].hand).toHaveLength(2);
  });

  it('legacy wheel draw regex handlers no-op when IR primary owns Reforge text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_wheel_reforge_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).zones = {
      [p1]: { hand: [{ id: 'h1', name: 'A' }], handCount: 1, graveyard: [], graveyardCount: 0 },
      [p2]: { hand: [{ id: 'h2', name: 'B' }, { id: 'h3', name: 'C' }], handCount: 2, graveyard: [], graveyardCount: 0 },
    };

    const ctx = game as any;
    ctx.libraries = new Map([
      [p1, Array.from({ length: 10 }, (_, index) => ({ id: `p1l${index}`, name: `L${index}`, zone: 'library' }))],
      [p2, Array.from({ length: 10 }, (_, index) => ({ id: `p2l${index}`, name: `L${index}`, zone: 'library' }))],
    ]);

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: p1,
      effectiveCard: { name: 'Reforge the Soul' },
      oracleTextLower: 'each player discards their hand, then draws seven cards.',
    });

    expect((game.state as any).zones[p1].hand).toHaveLength(1);
    expect((game.state as any).zones[p2].hand).toHaveLength(2);
  });

  it('legacy categorized scry spell execution no-ops when IR primary owns scry text', { timeout: 15000 }, () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'spell_scry_categorize_retirement';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Forest', zone: 'library' },
    ];
    player.hand = [];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const spellSpec = categorizeSpellWithoutPrimaryRetirement('Opt', 'Scry 1.');
    expect(spellSpec?.op).toBe('SCRY');

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'opt_card', name: 'Opt' },
      effectiveCard: { name: 'Opt' },
      item: { id: 'opt_stack' },
      oracleText: 'Scry 1.',
      targets: [],
      spellSpec: spellSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const scrySteps = (queue?.steps || []).filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(0);
  });

  it('legacy categorized surveil spell execution no-ops when IR primary owns surveil text', { timeout: 15000 }, () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'spell_surveil_categorize_retirement';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Forest', zone: 'library' },
      { id: 'lib-3', name: 'Mountain', zone: 'library' },
    ];
    player.hand = [];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const spellSpec = categorizeSpellWithoutPrimaryRetirement('Test Surveil', 'Surveil 2.');
    expect(spellSpec?.op).toBe('SURVEIL');

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'surveil_card', name: 'Test Surveil' },
      effectiveCard: { name: 'Test Surveil' },
      item: { id: 'surveil_stack' },
      oracleText: 'Surveil 2.',
      targets: [],
      spellSpec: spellSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const surveilSteps = (queue?.steps || []).filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(0);
    expect(player.hand).toHaveLength(0);
  });

  it('legacy categorized counter spell execution no-ops when IR primary owns unless-pay text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_counter_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).stack = [
      {
        id: 'cultivate_stack',
        type: 'spell',
        controller: p2,
        card: { id: 'cultivate_card', name: 'Cultivate', type_line: 'Sorcery' },
        targets: [],
      },
    ];

    const ctx = game as any;
    const spellSpec = categorizeSpellWithoutPrimaryRetirement(
      'Force Spike',
      'Counter target spell unless its controller pays {1}.',
    );
    expect(spellSpec?.op).toBe('COUNTER_TARGET_SPELL');

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'force_spike_card', name: 'Force Spike' },
      effectiveCard: { name: 'Force Spike' },
      item: { id: 'force_spike_stack', targets: [{ id: 'cultivate_stack', kind: 'stack' }] },
      oracleText: 'Counter target spell unless its controller pays {1}.',
      targets: [{ id: 'cultivate_stack', kind: 'stack' }],
      spellSpec: spellSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: p2,
      targetSpellNameForSupplemental: 'Cultivate',
      targetControllerForTokenCreation: null,
    });

    expect((game.state as any).stack).toHaveLength(1);
    expect(String((game.state as any).stack[0]?.card?.name || '')).toBe('Cultivate');
  });
});
