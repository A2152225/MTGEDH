import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR grant keywords to that spell', () => {
  it('stamps deathtouch and lifelink on the triggering stack spell', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectOracleEffectSteps(
      'That spell gains deathtouch and lifelink.',
      'Judith, Carnage Connoisseur',
    );
    expect(steps.some((step) => step.kind === 'grant_static_ability')).toBe(true);

    const state = {
      startingLife: 40,
      life: { p1: 40, p2: 40 },
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [],
      stack: [{
        id: 'stack_reckless',
        type: 'spell',
        controller: p1,
        card: {
          id: 'reckless_blaze_1',
          name: 'Reckless Blaze',
          type_line: 'Sorcery — Lesson',
          oracle_text: 'Reckless Blaze deals 5 damage to each creature.',
        },
      }],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'judith_1',
      sourceName: 'Judith, Carnage Connoisseur',
      sourceObjectType: 'ability',
      targetSpellId: 'stack_reckless',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const spell = ((result.state as GameState).stack || []).find((entry: any) => entry?.id === 'stack_reckless');
    const granted = ((spell as any)?.grantedAbilities || []).map((value: unknown) => String(value).toLowerCase());

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(
      expect.arrayContaining(['grant_static_ability']),
    );
    expect(granted).toEqual(expect.arrayContaining(['deathtouch', 'lifelink']));
  });

  it('gives lifelink when that spell later deals damage', () => {
    const p1 = 'p1' as PlayerID;
    const grantSteps = collectOracleEffectSteps(
      'That spell gains deathtouch and lifelink.',
      'Judith, Carnage Connoisseur',
    );
    const damageSteps = collectOracleEffectSteps(
      'This spell deals 5 damage to each creature.',
      'Reckless Blaze',
    );

    const state = {
      startingLife: 40,
      life: { p1: 20, p2: 40 },
      players: [{ id: p1, life: 20 }, { id: 'p2', life: 40 }],
      battlefield: [{
        id: 'creature_1',
        controller: 'p2',
        damage: 0,
        card: { name: 'Wall', type_line: 'Creature — Wall', power: 0, toughness: 4 },
      }],
      stack: [{
        id: 'stack_reckless',
        type: 'spell',
        controller: p1,
        card: {
          id: 'reckless_blaze_1',
          name: 'Reckless Blaze',
          type_line: 'Sorcery — Lesson',
        },
      }],
    } as GameState;

    const grantCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'judith_1',
      sourceName: 'Judith, Carnage Connoisseur',
      sourceObjectType: 'ability',
      targetSpellId: 'stack_reckless',
    });
    const grantedState = applyOracleIRStepsToGameState(state, grantSteps, grantCtx, { allowOptional: true }).state as GameState;

    const damageCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'stack_reckless',
      sourceName: 'Reckless Blaze',
      sourceObjectType: 'spell',
    });
    const damaged = applyOracleIRStepsToGameState(grantedState, damageSteps, damageCtx, { allowOptional: true });

    expect((damaged.state as GameState).life?.[p1]).toBe(25);
    const wall = (damaged.state as GameState).battlefield?.find((entry) => entry.id === 'creature_1');
    expect(Number((wall as any)?.damage || 0)).toBeGreaterThanOrEqual(5);
    expect(Boolean((wall as any)?.deathtouchDamageMarked)).toBe(true);
  });

  it('keeps deathtouch and lifelink after the granted spell leaves the stack', () => {
    const p1 = 'p1' as PlayerID;
    const grantSteps = collectOracleEffectSteps(
      'That spell gains deathtouch and lifelink.',
      'Judith, Carnage Connoisseur',
    );
    const damageSteps = collectOracleEffectSteps(
      'This spell deals 5 damage to each creature.',
      'Reckless Blaze',
    );

    const state = {
      startingLife: 40,
      life: { p1: 20, p2: 40 },
      players: [{ id: p1, life: 20 }, { id: 'p2', life: 40 }],
      battlefield: [{
        id: 'creature_1',
        controller: 'p2',
        damage: 0,
        card: { name: 'Wall', type_line: 'Creature — Wall', power: 0, toughness: 6 },
      }],
      stack: [{
        id: 'stack_reckless',
        type: 'spell',
        controller: p1,
        card: {
          id: 'reckless_blaze_1',
          name: 'Reckless Blaze',
          type_line: 'Sorcery — Lesson',
        },
      }],
    } as GameState;

    const grantCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'judith_1',
      sourceName: 'Judith, Carnage Connoisseur',
      sourceObjectType: 'ability',
      targetSpellId: 'stack_reckless',
    });
    const grantedState = applyOracleIRStepsToGameState(state, grantSteps, grantCtx, { allowOptional: true }).state as GameState;
    const grantedSpell = ((grantedState.stack || []) as any[]).find((entry) => entry?.id === 'stack_reckless');
    const grantedAbilities = Array.isArray(grantedSpell?.grantedAbilities) ? grantedSpell.grantedAbilities : [];
    expect(grantedAbilities.map((value: unknown) => String(value).toLowerCase())).toEqual(
      expect.arrayContaining(['deathtouch', 'lifelink']),
    );

    const poppedState = { ...grantedState, stack: [] } as GameState;
    const damageCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'stack_reckless',
      sourceName: 'Reckless Blaze',
      sourceObjectType: 'spell',
      sourceGrantedAbilities: grantedAbilities,
    });
    const damaged = applyOracleIRStepsToGameState(poppedState, damageSteps, damageCtx, { allowOptional: true });

    expect((damaged.state as GameState).life?.[p1]).toBe(25);
    const wall = (damaged.state as GameState).battlefield?.find((entry) => entry.id === 'creature_1');
    expect(Number((wall as any)?.damage || 0)).toBe(5);
    expect(Boolean((wall as any)?.deathtouchDamageMarked)).toBe(true);
  });
});
