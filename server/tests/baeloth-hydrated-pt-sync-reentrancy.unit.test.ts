import { describe, expect, it } from 'vitest';
import { createContext } from '../src/state/context.js';
import { getCombatCreatureStats } from '../src/state/modules/turn-handlers/turnCombatDamageStatsPrevention.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { getEffectivePower } from '../src/state/modules/goad-effects.js';
// Registers both the full current-P/T hook and the no-resync static-condition power reader.
import '../src/state/modules/currentPowerToughness.js';

/**
 * Regression for the hang in combat-blocked-excess-damage (multi-blocker / Baeloth on BF):
 * hydrateBattlefieldOracleText fills Baeloth's goad oracle during syncDerivedContinuousEffects;
 * evaluating that power-compared condition must not re-enter sync via getCurrentPowerToughness.
 */
describe('hydrated power-compared static conditions during derived sync', () => {
  it('finishes getCombatCreatureStats when Baeloth is on the battlefield with empty stub oracle', () => {
    const baeloth = {
      id: 'baeloth',
      controller: 'p2',
      owner: 'p2',
      markedDamage: 0,
      effectivePower: 2,
      effectiveToughness: 5,
      basePower: 2,
      baseToughness: 5,
      // Empty oracle: sync hydrates printed text (goad vs lower-power creatures).
      card: { name: 'Baeloth Barrityl, Entertainer', type_line: 'Legendary Creature — Devil Noble', oracle_text: '', power: '2', toughness: '5' },
    };
    const human = {
      id: 'human',
      controller: 'p1',
      owner: 'p1',
      markedDamage: 0,
      effectivePower: 1,
      effectiveToughness: 1,
      basePower: 1,
      baseToughness: 1,
      attacking: 'p2',
      blockedBy: ['baeloth'],
      card: { name: 'Human', type_line: 'Creature — Human', oracle_text: '', power: '1', toughness: '1' },
    };
    const ctx: any = createContext('baeloth_pt_sync_reentrancy');
    ctx.state = {
      ...ctx.state,
      players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
      life: { p1: 40, p2: 40 },
      battlefield: [human, baeloth],
    };
    const stats = getCombatCreatureStats(ctx, human);
    expect(stats.power).toBe(1);
    expect(stats.toughness).toBe(1);
    // Sync + condition eval must also complete when invoked directly.
    expect(() => syncDerivedContinuousEffects(ctx.state)).not.toThrow();
    expect(getEffectivePower(human as any, ctx.state)).toBe(1);
    expect(getEffectivePower(baeloth as any, ctx.state)).toBe(2);
  });
});