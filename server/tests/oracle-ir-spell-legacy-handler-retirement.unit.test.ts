import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  isCategorizeOpcodeDeletedFromResolveSpell,
  skipRetiredSpellLegacyHandler,
} from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { applyInstantSorceryLibraryTopCardPromptHandlers } from '../src/state/modules/stackResolveSpellLibraryTopPromptUtils.js';
import { applyInstantSorceryLibrarySearchSpellHandlers } from '../src/state/modules/stackResolveSpellLibraryHandlersUtils.js';
import { applyInstantSorcerySpecialAndRemovalRiders } from '../src/state/modules/stackResolveSpellLateRidersUtils.js';
import { executeInstantSorceryLegacyCategorizedSpell } from '../src/state/modules/stackResolveSpellLegacySpecUtils.js';
import { categorizeSpellWithoutPrimaryRetirement, resolveSpell } from '../src/rules-engine/targeting.js';
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

  it('library search handlers no-op when IR primary owns tutor text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'spell_tutor_library_retirement';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const oracleText =
      'Search your library for a card, put that card into your hand, then shuffle.';
    applyInstantSorceryLibrarySearchSpellHandlers(ctx, {
      controller: p1,
      card: { id: 'spell-1', name: 'Test Tutor' },
      effectiveCard: { name: 'Test Tutor' },
      item: { id: 'stack-1' },
      oracleText,
      oracleTextLower: oracleText.toLowerCase(),
    });

    const searchSteps = (ResolutionQueueManager.getQueue(gameId).steps || []).filter(
      (step) => step.type === ResolutionStepType.LIBRARY_SEARCH,
    );
    expect(searchSteps).toHaveLength(0);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('library top prompt handlers no-op when IR primary owns Ponder text', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'spell_ponder_library_retirement';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Forest', zone: 'library' },
      { id: 'lib-3', name: 'Mountain', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    applyInstantSorceryLibraryTopCardPromptHandlers(ctx, {
      controller: p1,
      effectiveCard: { name: 'Ponder' },
      item: { id: 'stack-1' },
      oracleTextLower:
        'look at the top three cards of your library, then put them back in any order. you may shuffle. draw a card.',
      spellXValue: undefined,
      targets: [],
    });

    expect((game.state as any).pendingPonder?.[p1]).toBeUndefined();
    expect((game.state as any).pendingLibraryReorder?.[p1]).toBeUndefined();
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

  it('legacy categorized gain-life / draw / lose-life spell execution no-ops when resolve ops are deleted (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    process.env.ORACLE_IR_SPELL_LEGACY = '1';

    const game = createInitialGameState('spell_life_draw_categorize_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    const opponent = (game.state as any).players.find((entry: any) => entry.id === p2);
    const lifeBefore = player.life ?? 40;
    const opponentLifeBefore = opponent.life ?? 40;
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
    ];
    player.hand = [];

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const gainSpec = categorizeSpellWithoutPrimaryRetirement('Healing Salve', 'You gain 3 life.');
    expect(gainSpec?.op).toBe('GAIN_LIFE');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(gainSpec?.op)).toBe(true);
    expect(resolveSpell(gainSpec as any, [], game.state as any, p1)).toEqual([]);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'heal_card', name: 'Healing Salve' },
      effectiveCard: { name: 'Healing Salve' },
      item: { id: 'heal_stack' },
      oracleText: 'You gain 3 life.',
      targets: [],
      spellSpec: gainSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });
    expect(player.life ?? 40).toBe(lifeBefore);

    const drawSpec = categorizeSpellWithoutPrimaryRetirement('Divination', 'Draw two cards.');
    expect(drawSpec?.op).toBe('DRAW_CARDS');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(drawSpec?.op)).toBe(true);
    expect(resolveSpell(drawSpec as any, [], game.state as any, p1)).toEqual([]);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'draw_card', name: 'Divination' },
      effectiveCard: { name: 'Divination' },
      item: { id: 'draw_stack' },
      oracleText: 'Draw two cards.',
      targets: [],
      spellSpec: drawSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });
    expect(player.hand.length).toBe(0);

    const loseSpec = categorizeSpellWithoutPrimaryRetirement(
      'Drain Life',
      'Target player loses 2 life.',
    );
    expect(String(loseSpec?.op || '')).toMatch(/^LOSE_LIFE/);
    expect(isCategorizeOpcodeDeletedFromResolveSpell(loseSpec?.op)).toBe(true);
    expect(resolveSpell(loseSpec as any, [{ kind: 'player', id: p2 }], game.state as any, p1)).toEqual([]);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'drain_card', name: 'Drain Life' },
      effectiveCard: { name: 'Drain Life' },
      item: { id: 'drain_stack' },
      oracleText: 'Target player loses 2 life.',
      targets: [p2],
      spellSpec: loseSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });
    expect(opponent.life ?? 40).toBe(opponentLifeBefore);

    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  it('legacy categorized destroy/exile/damage spell execution no-ops when resolve ops are deleted (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    process.env.ORACLE_IR_SPELL_LEGACY = '1';

    const game = createInitialGameState('spell_destroy_exile_damage_categorize_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      {
        id: 'victim',
        controller: p2,
        card: { id: 'victim_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ];
    const lifeBefore = (game.state as any).players.find((entry: any) => entry.id === p2)?.life ?? 40;

    const ctx = game as any;

    const destroySpec = categorizeSpellWithoutPrimaryRetirement('Murder', 'Destroy target creature.');
    expect(destroySpec?.op).toBe('DESTROY_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(destroySpec?.op)).toBe(true);
    expect(resolveSpell(destroySpec as any, [{ kind: 'permanent', id: 'victim' }], game.state as any, p1)).toEqual([]);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'murder_card', name: 'Murder' },
      effectiveCard: { name: 'Murder' },
      item: { id: 'murder_stack' },
      oracleText: 'Destroy target creature.',
      targets: ['victim'],
      spellSpec: destroySpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });
    expect((game.state as any).battlefield.some((entry: any) => entry.id === 'victim')).toBe(true);

    const exileSpec = categorizeSpellWithoutPrimaryRetirement('Swords to Plowshares', 'Exile target creature.');
    expect(exileSpec?.op).toBe('EXILE_TARGET');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(exileSpec?.op)).toBe(true);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'swords_card', name: 'Swords to Plowshares' },
      effectiveCard: { name: 'Swords to Plowshares' },
      item: { id: 'swords_stack' },
      oracleText: 'Exile target creature.',
      targets: ['victim'],
      spellSpec: exileSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });
    expect((game.state as any).battlefield.some((entry: any) => entry.id === 'victim')).toBe(true);

    const damageSpec = categorizeSpellWithoutPrimaryRetirement('Shock', 'Shock deals 2 damage to any target.');
    expect(String(damageSpec?.op || '')).toMatch(/DAMAGE|ANY_TARGET/);
    expect(isCategorizeOpcodeDeletedFromResolveSpell(damageSpec?.op)).toBe(true);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'shock_card', name: 'Shock' },
      effectiveCard: { name: 'Shock' },
      item: { id: 'shock_stack' },
      oracleText: 'Shock deals 2 damage to any target.',
      targets: [p2],
      spellSpec: damageSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });
    expect((game.state as any).players.find((entry: any) => entry.id === p2)?.life ?? 40).toBe(lifeBefore);

    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  it('legacy categorized blight spell execution no-ops when resolve ops are deleted (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    process.env.ORACLE_IR_SPELL_LEGACY = '1';

    const game = createInitialGameState('spell_blight_categorize_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    const ctx = game as any;

    const blightSpec = categorizeSpellWithoutPrimaryRetirement(
      'Test Each Opp Blight',
      'Each opponent blights 1.',
    );
    expect(blightSpec?.op).toBe('BLIGHT_EACH_OPPONENT');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(blightSpec?.op)).toBe(true);
    expect(resolveSpell(blightSpec as any, [], game.state as any, p1)).toEqual([]);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'blight_card', name: 'Test Each Opp Blight' },
      effectiveCard: { name: 'Test Each Opp Blight' },
      item: { id: 'blight_stack' },
      oracleText: 'Each opponent blights 1.',
      targets: [],
      spellSpec: blightSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });

    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  it('legacy categorized scry/surveil/mill/discard spell execution no-ops when resolve ops are deleted (P1a)', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    process.env.ORACLE_IR_SPELL_LEGACY = '1';

    const game = createInitialGameState('spell_scry_surveil_mill_discard_categorize_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    const ctx = game as any;

    const scrySpec = categorizeSpellWithoutPrimaryRetirement('Opt', 'Scry 1.');
    expect(scrySpec?.op).toBe('SCRY');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(scrySpec?.op)).toBe(true);
    expect(resolveSpell(scrySpec as any, [], game.state as any, p1)).toEqual([]);
    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'opt_card', name: 'Opt' },
      effectiveCard: { name: 'Opt' },
      item: { id: 'opt_stack' },
      oracleText: 'Scry 1.',
      targets: [],
      spellSpec: scrySpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });
    expect((game.state as any).pendingScry?.[p1]).toBeUndefined();

    const millSpec = categorizeSpellWithoutPrimaryRetirement('Millstone', 'Target player mills two cards.');
    expect(millSpec?.op).toBe('MILL_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(millSpec?.op)).toBe(true);
    expect(resolveSpell(
      millSpec as any,
      [{ kind: 'player', id: p2 }],
      game.state as any,
      p1,
    )).toEqual([]);

    const discardSpec = categorizeSpellWithoutPrimaryRetirement('Mind Rot', 'Target player discards two cards.');
    expect(discardSpec?.op).toBe('DISCARD_TARGET_PLAYER');
    expect(isCategorizeOpcodeDeletedFromResolveSpell(discardSpec?.op)).toBe(true);
    expect(resolveSpell(
      discardSpec as any,
      [{ kind: 'player', id: p2 }],
      game.state as any,
      p1,
    )).toEqual([]);

    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  it('legacy categorized damage spell execution no-ops under retired opcode gate', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const game = createInitialGameState('spell_damage_categorize_retirement');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const opponent = (game.state as any).players.find((entry: any) => entry.id === p2);
    const lifeBefore = opponent.life ?? 40;

    const ctx = game as any;
    const spellSpec = categorizeSpellWithoutPrimaryRetirement(
      'Lightning Bolt',
      'Lightning Bolt deals 3 damage to any target.',
    );
    expect(String(spellSpec?.op || '')).toMatch(/DAMAGE|ANY_TARGET/);

    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller: p1,
      card: { id: 'bolt_card', name: 'Lightning Bolt' },
      effectiveCard: { name: 'Lightning Bolt' },
      item: { id: 'bolt_stack' },
      oracleText: 'Lightning Bolt deals 3 damage to any target.',
      targets: [p2],
      spellSpec: spellSpec!,
      spellXValue: undefined,
      targetSpellControllerForSupplemental: null,
      targetSpellNameForSupplemental: '',
      targetControllerForTokenCreation: null,
    });

    expect(opponent.life ?? 40).toBe(lifeBefore);
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
    expect(isCategorizeOpcodeDeletedFromResolveSpell(spellSpec?.op)).toBe(true);
    expect(resolveSpell(
      spellSpec as any,
      [{ kind: 'stack', id: 'cultivate_stack' }],
      game.state as any,
      p1,
    )).toEqual([]);

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
