import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { skipRetiredSpellLegacyHandler } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import {
  applyLegacySpellRegexDrawHandlers,
  applyLegacySpellRegexLifeGainHandler,
} from '../src/state/modules/stackResolveSpellLegacyRegexDrawUtils.js';
import { applyInstantSorceryLibraryTopCardPromptHandlers } from '../src/state/modules/stackResolveSpellLibraryTopPromptUtils.js';
import { applyInstantSorcerySpecialAndRemovalRiders } from '../src/state/modules/stackResolveSpellLateRidersUtils.js';
import { executeInstantSorceryLegacyCategorizedSpell } from '../src/state/modules/stackResolveSpellLegacySpecUtils.js';
import { categorizeSpellWithoutPrimaryRetirement } from '../src/rules-engine/targeting.js';
import { tryApplyInstantSorceryLegacyBodyHandlers } from '../src/state/modules/stackResolveInstantSorceryLegacyBodyUtils.js';

describe('retired spell legacy handler defense-in-depth', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('legacy draw/gain regex handlers no-op when IR primary owns spell text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_handler_retirement');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }, { id: 'lib-2', name: 'Forest', zone: 'library' }];
    player.hand = [];
    const lifeBefore = player.life ?? 40;

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const effectiveCard = { name: 'Test Divination' };

    applyLegacySpellRegexDrawHandlers(ctx, {
      controller: p1,
      effectiveCard,
      oracleTextLower: 'draw two cards.',
    });
    expect(player.hand.length).toBe(0);

    applyLegacySpellRegexLifeGainHandler(ctx, {
      controller: p1,
      effectiveCard: { name: 'Healing Salve' },
      oracleTextLower: 'you gain 5 life.',
      spellXValue: undefined,
    });
    expect(player.life ?? 40).toBe(lifeBefore);
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

  it('legacy draw regex handler still applies when primary mode is off', () => {
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
      effectiveCard: { name: 'Divination' },
      oracleTextLower: 'you draw two cards.',
    });

    const handCount = (game.state as any).zones?.[p1]?.hand?.length ?? player.hand.length;
    const libraryCount = ctx.libraries.get(p1)?.length ?? player.library.length;
    expect(handCount).toBe(2);
    expect(libraryCount).toBe(0);
  });

  it('legacy gain-life regex handler still applies when primary mode is off', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    const game = createInitialGameState('spell_handler_legacy_gain_life');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = player?.life ?? 40;

    const ctx = game as any;

    applyLegacySpellRegexLifeGainHandler(ctx, {
      controller: p1,
      effectiveCard: { name: 'Healing Salve' },
      oracleTextLower: 'you gain 3 life.',
      spellXValue: undefined,
    });

    expect((game.state as any).life?.[p1]).toBe(lifeBefore + 3);
  });
});
