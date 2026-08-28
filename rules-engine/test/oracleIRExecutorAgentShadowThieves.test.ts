import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR Agent of the Shadow Thieves attack trigger', () => {
  const effectText =
    'Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn.';

  it('applies counter and temporary abilities when life condition is met', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectOracleEffectSteps(effectText, 'Commander');
    const state = {
      startingLife: 40,
      life: { p1: 30, p2: 25, p3: 20 },
      players: [{ id: p1 }, { id: 'p2' }, { id: 'p3' }],
      battlefield: [{
        id: 'commander',
        controller: p1,
        counters: {},
        card: { name: 'Commander', type_line: 'Creature — Human Rogue' },
      }],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'commander',
      sourceName: 'Commander',
      sourceObjectType: 'ability',
      selectorContext: {
        targetPlayerId: 'p2' as PlayerID,
        targetOpponentId: 'p2' as PlayerID,
      },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const perm = (result.state as GameState).battlefield?.find((entry) => entry.id === 'commander');

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(
      expect.arrayContaining(['add_counter', 'grant_temporary_ability']),
    );
    expect(perm?.counters?.['+1/+1']).toBe(1);
    const tempEffects = (perm as any)?.temporaryEffects ?? [];
    const granted = (perm as any)?.grantedAbilities ?? [];
    expect([...tempEffects, ...granted].join(' ').toLowerCase()).toMatch(/deathtouch/);
    expect([...tempEffects, ...granted].join(' ').toLowerCase()).toMatch(/indestructible/);
  });

  it('stamps deathtouch and indestructible on the source creature when the attack trigger binds the defending player', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectOracleEffectSteps(effectText, 'Baeloth Barrityl, Entertainer');
    const state = {
      startingLife: 40,
      life: { p1: 40, p2: 40, p3: 36 },
      players: [{ id: p1 }, { id: 'p2' }, { id: 'p3' }],
      battlefield: [{
        id: 'baeloth_1',
        controller: p1,
        counters: {},
        card: {
          name: 'Baeloth Barrityl, Entertainer',
          type_line: 'Legendary Creature — Elf Shaman',
        },
      }],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'baeloth_1',
      sourceName: 'Baeloth Barrityl, Entertainer',
      sourceObjectType: 'ability',
      selectorContext: {
        targetPlayerId: 'p2' as PlayerID,
        targetOpponentId: 'p2' as PlayerID,
        chosenObjectIds: ['p2'],
      },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const perm = (result.state as GameState).battlefield?.find((entry) => entry.id === 'baeloth_1');

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(
      expect.arrayContaining(['add_counter', 'grant_temporary_ability']),
    );
    expect(perm?.counters?.['+1/+1']).toBe(1);
    const tempEffects = (perm as any)?.temporaryEffects ?? [];
    const granted = (perm as any)?.grantedAbilities ?? [];
    expect([...tempEffects, ...granted].join(' ').toLowerCase()).toMatch(/deathtouch/);
    expect([...tempEffects, ...granted].join(' ').toLowerCase()).toMatch(/indestructible/);
    expect((result.state as any).staticAbilityGrantEffects || []).toEqual([]);
  });

  it('skips the effect when an opponent has more life than the attacked player', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectOracleEffectSteps(effectText, 'Commander');
    const state = {
      startingLife: 40,
      life: { p1: 30, p2: 25, p3: 30 },
      players: [{ id: p1 }, { id: 'p2' }, { id: 'p3' }],
      battlefield: [{
        id: 'commander',
        controller: p1,
        counters: {},
        card: { name: 'Commander', type_line: 'Creature — Human Rogue' },
      }],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'commander',
      sourceName: 'Commander',
      sourceObjectType: 'ability',
      selectorContext: {
        targetPlayerId: 'p2' as PlayerID,
      },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const perm = (result.state as GameState).battlefield?.find((entry) => entry.id === 'commander');

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['conditional']);
    expect(perm?.counters?.['+1/+1']).toBeUndefined();
  });
});
