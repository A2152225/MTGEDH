import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyRetiredTriggerLegacyDrawAndLifeCombinedEffects,
  applyRetiredTriggerLegacyEnergyEffects,
  applyRetiredTriggerLegacyPutThatManyCountersOnSelf,
  applyRetiredTriggerLegacyTokenCounters,
} from '../src/state/modules/oracleIrTriggerLegacyRegexHandlers.js';
import * as triggerLifeDamageUtils from '../src/state/modules/triggerLifeDamageUtils.js';

describe('oracleIrTriggerLegacyRegexHandlers', () => {
  it('applies you-gain-that-much-life combined pattern', () => {
    const game = createInitialGameState('legacy_regex_handlers');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const modifyLife = vi.spyOn(triggerLifeDamageUtils, 'modifyTriggerEffectLife').mockImplementation(() => {});

    const handled = applyRetiredTriggerLegacyDrawAndLifeCombinedEffects({
      ctx: game as any,
      controller: p1,
      sourceName: 'Test Source',
      desc: 'Each opponent loses 2 life. You gain that much life.',
      triggerItem: { effectData: { lifeLost: 2 } },
      state: game.state,
      isKynaiosEffect: false,
    });

    expect(handled).toBe(true);
    expect(modifyLife).toHaveBeenCalledWith(game.state, p1, 2);
    modifyLife.mockRestore();
  });

  it('applies energy gain via legacy regex handler', () => {
    const game = createInitialGameState('legacy_regex_energy');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    expect(applyRetiredTriggerLegacyEnergyEffects({
      desc: 'You get two {E}.',
      controller: p1,
      sourceName: 'Guide of Souls',
      state: game.state,
    })).toBe(true);

    expect((game.state as any).energy?.[p1]).toBe(2);
  });

  it('applies put-that-many-counters-on-self via legacy regex handler', () => {
    const state = {
      battlefield: [{
        id: 'perm-1',
        card: { name: 'Test Enchantment' },
        counters: {},
      }],
    };

    expect(applyRetiredTriggerLegacyPutThatManyCountersOnSelf({
      desc: 'Put that many charge counters on this enchantment.',
      triggerItem: { source: 'perm-1', effectData: { countersPlaced: 2 } },
      state,
    })).toBe(true);

    expect(state.battlefield[0].counters.charge).toBe(2);
  });

  it('applies token counters via legacy regex handler', () => {
    const game = createInitialGameState('legacy_regex_token');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    expect(applyRetiredTriggerLegacyTokenCounters({
      desc: 'You get three token counters.',
      controller: p1,
      sourceName: 'The Tokenator',
      state: game.state,
    })).toBe(true);

    expect((game.state as any).tokenCounters?.[p1] ?? (game.state as any).tokens?.[p1]).toBeDefined();
  });
});
