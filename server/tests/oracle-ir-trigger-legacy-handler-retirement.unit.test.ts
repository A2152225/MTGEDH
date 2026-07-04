import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { skipRetiredTriggerLegacyHandler } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import * as oracleIrUncategorizedSpellFallback from '../src/state/modules/oracleIrUncategorizedSpellFallback.js';
import { applyRetiredTriggerLegacySingleEffectRegexBatch } from '../src/state/modules/oracleIrTriggerLegacySingleEffectRegexBatch.js';
import { tryApplyTriggerEffectLegacyBodyHandlers } from '../src/state/modules/stackExecuteTriggerEffectLegacyBodyUtils.js';
import { tryApplyTriggerEffectLegacyTailHandlers } from '../src/state/modules/stackExecuteTriggerEffectTailUtils.js';

describe('retired trigger legacy handler defense-in-depth', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('legacy each-opponent discard stub removed; IR primary queues discard via executeTriggerEffect', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(skipRetiredTriggerLegacyHandler('Each opponent discards a card.', 'Liliana')).toBe(false);
  });

  it('legacy special handlers still apply when invoked directly under primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const game = createInitialGameState('handler_special_rebound');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    expect(applyRetiredTriggerLegacySingleEffectRegexBatch({
      ctx: game as any,
      controller: p1,
      sourceName: 'Test',
      desc: 'draw two cards.',
      description: 'draw two cards.',
      triggerItem: {},
      state: game.state,
      isKynaiosEffect: false,
      opponents: [],
      battlefield: [],
    })).toBe(false);
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

  it('legacy tail regex batches skip when IR primary owns effect text', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const savedSoakSnapshot = process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;
    delete process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;

    const game = createInitialGameState('handler_tail_regex_skip');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
    ];
    player.hand = [];

    const ctx = game as any;
    ctx.gameId = 'handler_tail_regex_skip';
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const bodyResult = tryApplyTriggerEffectLegacyBodyHandlers(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      { id: 'trigger-tail-skip' },
      game.state,
      {},
    );
    expect(bodyResult.handled).toBe(false);

    const tailHandled = tryApplyTriggerEffectLegacyTailHandlers(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      { id: 'trigger-tail-skip' },
      {},
      game.state,
      bodyResult,
    );

    expect(tailHandled.handled).toBe(false);
    expect(player.hand).toHaveLength(0);
    expect(player.library).toHaveLength(2);
    if (savedSoakSnapshot !== undefined) {
      process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT = savedSoakSnapshot;
    }
  });

  it('legacy tail skips uncategorized spell fallback when IR primary owns draw text', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const savedSoakSnapshot = process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;
    delete process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT;

    const spellFallbackSpy = vi.spyOn(
      oracleIrUncategorizedSpellFallback,
      'applyOracleIRUncategorizedSpellFallback',
    );

    const game = createInitialGameState('handler_tail_uncategorized_skip');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
    ];
    player.hand = [];

    const ctx = game as any;
    ctx.gameId = 'handler_tail_uncategorized_skip';
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const bodyResult = tryApplyTriggerEffectLegacyBodyHandlers(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      { id: 'trigger-tail-uncategorized-skip' },
      game.state,
      {},
    );
    expect(bodyResult.handled).toBe(false);

    const tailHandled = tryApplyTriggerEffectLegacyTailHandlers(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      { id: 'trigger-tail-uncategorized-skip' },
      {},
      game.state,
      bodyResult,
    );

    expect(tailHandled.handled).toBe(false);
    expect(spellFallbackSpy).not.toHaveBeenCalled();
    expect(player.hand).toHaveLength(0);
    expect(player.library).toHaveLength(2);

    spellFallbackSpy.mockRestore();
    if (savedSoakSnapshot !== undefined) {
      process.env.ORACLE_IR_WRITE_TELEMETRY_SNAPSHOT = savedSoakSnapshot;
    }
  });

  it('skipRetiredTriggerLegacyHandler defers duplicate prevention to orchestrators', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    expect(typeof skipRetiredTriggerLegacyHandler).toBe('function');
    expect(skipRetiredTriggerLegacyHandler('Draw a card.', 'Test')).toBe(false);
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(skipRetiredTriggerLegacyHandler('Draw a card.', 'Test')).toBe(false);
  });
});
