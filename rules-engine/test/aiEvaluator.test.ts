/**
 * P1-1 board evaluator: monotonicity, permanentValue parity, timing, public-only.
 */

import { describe, expect, it } from 'vitest';
import { evaluatePermanentValue } from '../src/aiEngineValueSupport.js';
import { hasPermanentType } from '../src/permanentTypeUtils.js';
import { DEFAULT_WEIGHTS, getEvalWeights, seatValues } from '../src/ai/evaluator.js';
import { permanentValue, seatFeatures } from '../src/ai/evaluatorFeatures.js';
import {
  emptyFourPlayerState,
  lateGameFourPlayerState,
  observationFromState,
  parityPermanentFixtures,
} from './fixtures/aiFixtures.js';

describe('P1-1 evaluator', () => {
  it('getEvalWeights returns DEFAULT_WEIGHTS while fit is null', () => {
    expect(getEvalWeights()).toEqual(DEFAULT_WEIGHTS);
  });

  it('adding a creature raises that seat value; losing life lowers it', () => {
    const base = emptyFourPlayerState();
    const withCreature = emptyFourPlayerState({
      battlefield: [
        {
          id: 'bf_bear',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSickness: false,
          counters: {},
          effectivePower: 2,
          effectiveToughness: 2,
          card: {
            id: 'c_bear',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ],
    });
    const lowLife = emptyFourPlayerState({
      life: { p1: 20, p2: 40, p3: 28, p4: 40 },
      players: [
        { id: 'p1', name: 'A', life: 20 },
        { id: 'p2', name: 'B', life: 40 },
        { id: 'p3', name: 'C', life: 28 },
        { id: 'p4', name: 'D', life: 40 },
      ],
    });

    const vBase = seatValues(seatFeatures(observationFromState(base, 'p1')), DEFAULT_WEIGHTS);
    const vCreat = seatValues(seatFeatures(observationFromState(withCreature, 'p1')), DEFAULT_WEIGHTS);
    const vLife = seatValues(seatFeatures(observationFromState(lowLife, 'p1')), DEFAULT_WEIGHTS);

    expect(vCreat.p1).toBeGreaterThan(vBase.p1);
    expect(vLife.p1).toBeLessThan(vBase.p1);
  });

  it('20 commander damage lowers value more than 5', () => {
    const dmg5 = emptyFourPlayerState({
      commanderDamage: { p1: { cmdr_x: 5 }, p2: {}, p3: {}, p4: {} },
    });
    const dmg20 = emptyFourPlayerState({
      commanderDamage: { p1: { cmdr_x: 20 }, p2: {}, p3: {}, p4: {} },
    });
    const v5 = seatValues(seatFeatures(observationFromState(dmg5, 'p1')), DEFAULT_WEIGHTS);
    const v20 = seatValues(seatFeatures(observationFromState(dmg20, 'p1')), DEFAULT_WEIGHTS);
    expect(v20.p1).toBeLessThan(v5.p1);
  });

  it('one more mana source raises value', () => {
    const none = emptyFourPlayerState();
    const rock = emptyFourPlayerState({
      battlefield: [
        {
          id: 'bf_rock',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'c_rock',
            name: 'Sol Ring',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}{C}.',
          },
        },
      ],
    });
    const vNone = seatValues(seatFeatures(observationFromState(none, 'p1')), DEFAULT_WEIGHTS);
    const vRock = seatValues(seatFeatures(observationFromState(rock, 'p1')), DEFAULT_WEIGHTS);
    expect(vRock.p1).toBeGreaterThan(vNone.p1);
  });

  it('permanentValue matches evaluatePermanentValue on parity fixtures', () => {
    const fixtures = parityPermanentFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(10);

    for (const fx of fixtures) {
      const state = emptyFourPlayerState({ battlefield: [fx.perm] });
      const obs = observationFromState(state, 'p1');
      const view = obs.self.battlefield.find((p) => p.id === fx.perm.id);
      expect(view, fx.label).toBeTruthy();
      const fromView = permanentValue(view!);
      const fromEngine = evaluatePermanentValue(fx.perm, { hasPermanentType });
      expect(fromView, fx.label).toBe(fromEngine);
    }
  });

  it('seatFeatures is identical from every live seat view (public-only)', () => {
    const state = lateGameFourPlayerState();
    const fromP1 = seatFeatures(observationFromState(state, 'p1'));
    const fromP2 = seatFeatures(observationFromState(state, 'p2'));
    const fromP3 = seatFeatures(observationFromState(state, 'p3'));
    expect(fromP2).toEqual(fromP1);
    expect(fromP3).toEqual(fromP1);
  });

  it('seatFeatures on a late-game four-player board is under 5ms mean', () => {
    const state = lateGameFourPlayerState();
    const obs = observationFromState(state, 'p1');
    // Warmup
    for (let i = 0; i < 50; i++) seatFeatures(obs);
    const N = 1000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) seatFeatures(obs);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    // Soft CI ceiling; plan target is <1ms. Log measured mean for the PR.
    // eslint-disable-next-line no-console
    console.log(`[P1-1] seatFeatures mean ${ms.toFixed(4)} ms/call over ${N}`);
    expect(ms).toBeLessThan(5);
  });
});
