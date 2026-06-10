import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyRetiredTriggerLegacyCreatureControllerLosesLife,
  applyRetiredTriggerLegacyDealEachOpponentAndGainLife,
  applyRetiredTriggerLegacyDrawAndLifeCombinedEffects,
  applyRetiredTriggerLegacyEachOpponentDiscards,
  applyRetiredTriggerLegacyEachOpponentDraws,
  applyRetiredTriggerLegacyEachOpponentLosesLife,
  applyRetiredTriggerLegacyEachPlayerDraws,
  applyRetiredTriggerLegacyEnergyEffects,
  applyRetiredTriggerLegacyMayGainLife,
  applyRetiredTriggerLegacyPlusOneCounterEachCreatureYouControl,
  applyRetiredTriggerLegacyPlusOneCounterOnSelf,
  applyRetiredTriggerLegacyPutThatManyCountersOnSelf,
  applyRetiredTriggerLegacySingleDraw,
  applyRetiredTriggerLegacyTargetPlayerDraws,
  applyRetiredTriggerLegacyTargetPlayerLoseYouGainLife,
  applyRetiredTriggerLegacyTokenCounters,
  applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget,
  applyRetiredTriggerLegacyUntapTapLands,
} from '../src/state/modules/oracleIrTriggerLegacyRegexHandlers.js';
import * as triggerLifeDamageUtils from '../src/state/modules/triggerLifeDamageUtils.js';

function setupPlayerLibrary(g: any, pid: PlayerID, libraryIds: string[]) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };

  const player = (g.state as any).players.find((entry: any) => entry.id === pid);
  player.library = libraryIds.map((id) => ({ id, name: id, zone: 'library' }));
  player.hand = [];
  (g.state as any).zones[pid].library = player.library.map((card: any) => ({ ...card }));
  (g.state as any).zones[pid].libraryCount = player.library.length;
  g.libraries = g.libraries || new Map();
  g.libraries.set(pid, player.library.map((card: any) => ({ ...card })));
}

describe('oracleIrTriggerLegacyRegexHandlers', () => {
  it('applies combined draw and gain-life patterns', () => {
    const game = createInitialGameState('legacy_regex_handlers');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['lib-1']);

    const modifyLife = vi.spyOn(triggerLifeDamageUtils, 'modifyTriggerEffectLife').mockImplementation(() => {});

    const handled = applyRetiredTriggerLegacyDrawAndLifeCombinedEffects({
      ctx: game as any,
      controller: p1,
      sourceName: 'Test Source',
      desc: 'draw a card. you gain 2 life.',
      triggerItem: {},
      state: game.state,
      isKynaiosEffect: false,
    });

    expect(handled).toBe(true);
    expect(modifyLife).toHaveBeenCalledWith(game.state, p1, 2);
    modifyLife.mockRestore();
  });

  it('applies single draw pattern', () => {
    const game = createInitialGameState('legacy_regex_single_draw');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    setupPlayerLibrary(game, p1, ['lib-1']);

    expect(applyRetiredTriggerLegacySingleDraw({
      ctx: game as any,
      controller: p1,
      desc: 'draw a card.',
      isKynaiosEffect: false,
    })).toBe(true);
  });

  it('queues each-opponent discard via legacy regex handler', () => {
    const game = createInitialGameState('legacy_regex_discard');
    const state = game.state as any;
    state.pendingDiscard = {};

    expect(applyRetiredTriggerLegacyEachOpponentDiscards({
      desc: 'each opponent discards a card.',
      state,
      opponents: [{ id: 'p2' }, { id: 'p3' }],
    })).toBe(true);

    expect(state.pendingDiscard.p2).toBe(1);
    expect(state.pendingDiscard.p3).toBe(1);
  });

  it('applies each-opponent life loss via legacy regex handler', () => {
    const state = { life: {} };
    const modifyLife = vi.spyOn(triggerLifeDamageUtils, 'modifyTriggerEffectLife').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyEachOpponentLosesLife({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Test',
      desc: 'each opponent loses 2 life. you gain 1 life.',
      triggerItem: {},
      state,
      opponents: [{ id: 'p2' }],
      battlefield: [],
    })).toBe(true);

    expect(modifyLife).toHaveBeenCalledWith(state, 'p2', -2);
    expect(modifyLife).toHaveBeenCalledWith(state, 'p1', 1);
    modifyLife.mockRestore();
  });

  it('applies target player lose/gain life via legacy regex handler', () => {
    const state = { life: {} };
    const modifyLife = vi.spyOn(triggerLifeDamageUtils, 'modifyTriggerEffectLife').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyTargetPlayerLoseYouGainLife({
      desc: 'target player loses 1 life. you gain 1 life.',
      controller: 'p1' as PlayerID,
      triggerItem: { targets: ['p2'] },
      opponents: [{ id: 'p2' }],
      state,
    })).toBe(true);

    expect(modifyLife).toHaveBeenCalledWith(state, 'p2', -1);
    expect(modifyLife).toHaveBeenCalledWith(state, 'p1', 1);
    modifyLife.mockRestore();
  });

  it('applies deal-each-opponent-damage-and-gain-life via legacy regex handler', () => {
    const state = { life: {}, battlefield: [] };
    const ctx = { state } as any;
    const modifyLife = vi.spyOn(triggerLifeDamageUtils, 'modifyTriggerEffectLife').mockImplementation(() => {});
    const applyOpponentDamage = vi.spyOn(triggerLifeDamageUtils, 'applyTriggerOpponentDamageFromPermanent').mockReturnValue(2);

    expect(applyRetiredTriggerLegacyDealEachOpponentAndGainLife({
      ctx,
      desc: 'It deals 2 damage to each opponent and you gain 2 life.',
      opponents: [{ id: 'p2' }],
      controller: 'p1' as PlayerID,
      state,
      battlefield: [],
      triggerItem: {},
    })).toBe(true);

    expect(applyOpponentDamage).toHaveBeenCalledWith(ctx, 'p1', state, [], 'p2', 2, undefined);
    expect(modifyLife).toHaveBeenCalledWith(state, 'p1', 2);
    modifyLife.mockRestore();
    applyOpponentDamage.mockRestore();
  });

  it('applies may-gain-life via legacy regex handler', () => {
    const state = { life: {} };
    const modifyLife = vi.spyOn(triggerLifeDamageUtils, 'modifyTriggerEffectLife').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyMayGainLife({
      desc: 'You may gain 3 life.',
      controller: 'p1' as PlayerID,
      state,
    })).toBe(true);

    expect(modifyLife).toHaveBeenCalledWith(state, 'p1', 3);
    modifyLife.mockRestore();
  });

  it('applies creature-controller-lose-life via legacy regex handler', () => {
    const state = { life: {} };
    const modifyLife = vi.spyOn(triggerLifeDamageUtils, 'modifyTriggerEffectLife').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyCreatureControllerLosesLife({
      desc: "That creature's controller loses 2 life.",
      controller: 'p1' as PlayerID,
      triggerItem: { triggeringController: 'p2' },
      state,
    })).toBe(true);

    expect(modifyLife).toHaveBeenCalledWith(state, 'p2', -2);
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

  it('applies each-opponent draw via legacy regex handler', () => {
    const game = createInitialGameState('legacy_regex_opp_draw');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p2, ['lib-1']);

    expect(applyRetiredTriggerLegacyEachOpponentDraws({
      ctx: game as any,
      desc: 'Each opponent draws a card.',
      opponents: [{ id: p2 }],
    })).toBe(true);
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

  it('applies target-player draw via legacy regex handler', () => {
    const game = createInitialGameState('legacy_regex_target_draw');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p2, ['lib-1']);

    expect(applyRetiredTriggerLegacyTargetPlayerDraws({
      ctx: game as any,
      controller: p1,
      desc: 'Target player draws a card.',
      triggerItem: { targets: [p2] },
    })).toBe(true);
  });

  it('untaps controlled lands via legacy regex handler', () => {
    const state = {
      battlefield: [
        { id: 'land-1', controller: 'p1', tapped: true, card: { type_line: 'Basic Land — Island' } },
        { id: 'creature-1', controller: 'p1', tapped: true, card: { type_line: 'Creature' } },
      ],
    };

    expect(applyRetiredTriggerLegacyUntapTapLands({
      sourceName: 'Test',
      desc: 'Untap all lands you control.',
      controller: 'p1' as PlayerID,
      triggerItem: {},
      state,
    })).toBe(true);

    expect(state.battlefield[0].tapped).toBe(false);
    expect(state.battlefield[1].tapped).toBe(true);
  });

  it('applies two +1/+1 counters on target via legacy regex handler', () => {
    const state = {
      battlefield: [{
        id: 'target-1',
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        counters: {},
      }],
    };

    expect(applyRetiredTriggerLegacyTwoPlusOneCountersOnTarget({
      desc: 'Put two +1/+1 counters on target creature.',
      triggerItem: { targets: ['target-1'] },
      state,
    })).toBe(true);

    expect(state.battlefield[0].counters['+1/+1']).toBe(2);
  });

  it('applies +1/+1 counter on each creature you control via legacy regex handler', () => {
    const state = {
      battlefield: [
        { id: 'c1', controller: 'p1', card: { name: 'A', type_line: 'Creature' }, counters: {} },
        { id: 'c2', controller: 'p2', card: { name: 'B', type_line: 'Creature' }, counters: {} },
      ],
    };

    expect(applyRetiredTriggerLegacyPlusOneCounterEachCreatureYouControl({
      desc: 'Put a +1/+1 counter on each creature you control.',
      controller: 'p1' as PlayerID,
      state,
    })).toBe(true);

    expect(state.battlefield[0].counters['+1/+1']).toBe(1);
    expect(state.battlefield[1].counters['+1/+1']).toBeUndefined();
  });

  it('applies +1/+1 counter on self via legacy regex handler', () => {
    const state = {
      battlefield: [{ id: 'self-1', card: { name: 'Lieutenant' }, counters: {} }],
    };

    expect(applyRetiredTriggerLegacyPlusOneCounterOnSelf({
      desc: "Put a +1/+1 counter on this creature.",
      triggerItem: { source: 'self-1' },
      state,
    })).toBe(true);

    expect(state.battlefield[0].counters['+1/+1']).toBe(1);
  });
});
