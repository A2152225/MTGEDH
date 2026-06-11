import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { skipRetiredTriggerLegacyHandler } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import {
  applyRetiredTriggerLegacyDrawAndLifeCombinedEffects,
  applyRetiredTriggerLegacyEachOpponentDiscards,
  applyRetiredTriggerLegacyScry,
  applyRetiredTriggerLegacySingleDraw,
  applyRetiredTriggerLegacySingleGainLife,
} from '../src/state/modules/oracleIrTriggerLegacyRegexHandlers.js';
import { applyRetiredTriggerLegacyTargetPlayerMills } from '../src/state/modules/oracleIrTriggerLegacyMillHandlers.js';
import { applyRetiredTriggerLegacyGraveyardZoneChangeBatch } from '../src/state/modules/oracleIrTriggerLegacyGraveyardZoneHandlers.js';
import { applyRetiredTriggerLegacyExtraTurnAfterThisOne } from '../src/state/modules/oracleIrTriggerLegacyTurnAndZoneHandlers.js';
import { applyRetiredTriggerLegacySacrificeThisCreature } from '../src/state/modules/oracleIrTriggerLegacySpecialTriggerHandlers.js';
import { applyRetiredTriggerLegacySingleEffectRegexBatch } from '../src/state/modules/oracleIrTriggerLegacySingleEffectRegexBatch.js';
import { tryApplyTriggerEffectLegacyBodyHandlers } from '../src/state/modules/stackExecuteTriggerEffectLegacyBodyUtils.js';
import {
  applyRetiredTriggerLegacyCreateCreatureToken,
  applyRetiredTriggerLegacyPredefinedArtifactTokens,
  applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken,
} from '../src/state/modules/oracleIrTriggerLegacyTokenHandlers.js';

describe('retired trigger legacy handler defense-in-depth', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('legacy draw/gain/scry handlers defer to orchestrator skip under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(skipRetiredTriggerLegacyHandler('Draw 2 cards.', 'Mulldrifter')).toBe(false);
    expect(skipRetiredTriggerLegacyHandler('You gain 1 life.', 'Soul Warden')).toBe(false);
    expect(skipRetiredTriggerLegacyHandler('Scry 1.', 'Opt')).toBe(false);
    expect(skipRetiredTriggerLegacyHandler('You lose 2 life.', 'Shock')).toBe(false);
  });

  it('legacy discard/damage/counter regex handlers no-op when invoked directly under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const game = createInitialGameState('handler_retired_discard_damage');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).pendingDiscard = {};

    expect(applyRetiredTriggerLegacyEachOpponentDiscards({
      desc: 'Each opponent discards a card.',
      state: game.state,
      opponents: [{ id: 'p2' }],
      sourceName: 'Liliana',
    })).toBe(false);
    expect((game.state as any).pendingDiscard.p2).toBeUndefined();
  });

  it('retired predefined artifact token regex handler no-ops when invoked directly under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const game = createInitialGameState('handler_token_search_combat');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'source_1',
      controller: p1,
      card: { name: 'Source', type_line: 'Creature' },
    }];

    const baseParams = {
      ctx: game as any,
      controller: p1,
      sourceName: 'Smothering Tithe',
      desc: 'Create a Treasure token.',
      description: 'Create a Treasure token.',
      triggerItem: { source: 'source_1' },
      state: game.state,
    };

    const battlefieldBefore = (game.state as any).battlefield.length;

    expect(applyRetiredTriggerLegacyPredefinedArtifactTokens(baseParams)).toBe(false);
    expect((game.state as any).battlefield.length).toBe(battlefieldBefore);
  });

  it('legacy special handlers still apply when invoked directly under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const game = createInitialGameState('handler_special_graveyard');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [{
      id: 'source_1',
      controller: p1,
      card: { name: 'Source', type_line: 'Creature' },
    }];

    expect(applyRetiredTriggerLegacySacrificeThisCreature({
      ctx: game as any,
      controller: p1,
      sourceName: 'Fling',
      desc: 'sacrifice this creature',
      triggerItem: { source: 'source_1' },
      state: game.state,
    })).toBe(true);

    expect(applyRetiredTriggerLegacyExtraTurnAfterThisOne({
      ctx: game as any,
      controller: p1,
      sourceName: 'Time Warp',
      description: 'Take an extra turn after this one.',
    })).toBe(true);
  });

  it('legacy regex batch defers to orchestrator skip under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(skipRetiredTriggerLegacyHandler('Draw 2 cards.', 'Mulldrifter')).toBe(false);
  });

  it('legacy body pipeline short-circuits when IR primary owns effect text', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const game = createInitialGameState('handler_body_pipeline');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }];
    player.hand = [];

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const result = tryApplyTriggerEffectLegacyBodyHandlers(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      {},
      game.state,
      {},
    );

    expect(result.handled).toBe(false);
    if (!result.handled) {
      expect(result.desc).toContain('draw');
    }
    expect(player.hand).toHaveLength(0);
  });

  it('skipRetiredTriggerLegacyHandler defers duplicate prevention to orchestrators', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    expect(typeof skipRetiredTriggerLegacyHandler).toBe('function');
    expect(skipRetiredTriggerLegacyHandler('Draw a card.', 'Test')).toBe(false);
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(skipRetiredTriggerLegacyHandler('Draw a card.', 'Test')).toBe(false);
  });

  it('legacy draw/gain/scry/mill regex handlers no-op when invoked directly under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const game = createInitialGameState('handler_retired_draw_gain');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }];
    player.hand = [];

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    expect(applyRetiredTriggerLegacySingleDraw({
      ctx,
      controller: p1,
      desc: 'Draw a card.',
      isKynaiosEffect: false,
      sourceName: 'ETB Creature',
    })).toBe(false);
    expect(applyRetiredTriggerLegacySingleGainLife({
      desc: 'You gain 1 life.',
      controller: p1,
      state: game.state,
      sourceName: 'Soul Warden',
    })).toBe(false);
    expect(applyRetiredTriggerLegacyScry({
      desc: 'Scry 1.',
      controller: p1,
      state: game.state,
      sourceName: 'Opt',
    })).toBe(false);
    expect(applyRetiredTriggerLegacyTargetPlayerMills({
      ctx,
      controller: p1,
      sourceName: 'Glimpse',
      desc: 'Target player mills three cards.',
      opponents: [{ id: 'p2' }],
      state: game.state,
      triggerItem: { targets: ['p2'] },
    })).toBe(false);
    expect(player.hand).toHaveLength(0);
  });

  it('retired trigger draw regex handler no-ops even when primary mode is off', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;

    const game = createInitialGameState('handler_legacy_draw');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }];
    player.hand = [];

    const ctx = game as any;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    expect(applyRetiredTriggerLegacySingleDraw({
      ctx,
      controller: p1,
      desc: 'Draw a card.',
      isKynaiosEffect: false,
      sourceName: 'ETB Creature',
    })).toBe(false);
    expect(player.hand).toHaveLength(0);
  });
});
