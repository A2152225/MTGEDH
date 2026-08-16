import { describe, expect, it } from 'vitest';

import { computeContinuousEffects } from '../src/rules-engine/staticEffects.js';
import {
  applyStatefulPaperKeywordSBAs,
  harnessPermanent,
  maybeIncreaseSpeedFromOpponentLifeLoss,
  resetSpeedIncreasedThisTurn,
} from '../src/state/modules/statefulPaperKeywords.js';

function permanent(id: string, controller: string, type_line: string, oracle_text: string) {
  return { id, controller, owner: controller, card: { id: `${id}-card`, name: id, type_line, oracle_text } };
}

describe('stateful paper keywords', () => {
  it('gives initial speed and an enduring story through state-based actions', () => {
    const state: any = {
      players: [{ id: 'p1' }],
      battlefield: [
        permanent('engine', 'p1', 'Artifact', 'Start your engines!'),
        permanent('legend', 'p1', 'Legendary Creature — Dwarf', 'Storied'),
        permanent('artifact', 'p1', 'Artifact', ''),
      ],
    };

    expect(applyStatefulPaperKeywordSBAs(state)).toBe(true);
    expect(state.speed).toEqual({ p1: 1 });
    expect(state.enduringStory).toEqual({ p1: true });

    state.battlefield.splice(0);
    expect(applyStatefulPaperKeywordSBAs(state)).toBe(false);
    expect(state.enduringStory.p1).toBe(true);
  });

  it('counts a legendary artifact Saga once for Storied', () => {
    const state: any = {
      players: [{ id: 'p1' }],
      battlefield: [
        permanent('storied', 'p1', 'Legendary Creature — Dwarf', 'Storied'),
        permanent('one', 'p1', 'Legendary Artifact — Saga', ''),
      ],
    };
    applyStatefulPaperKeywordSBAs(state);
    expect(state.enduringStory?.p1).toBeUndefined();
  });

  it('activates Max Speed and Infinity ability text only at their conditions', () => {
    const maxSpeed = permanent('racer', 'p1', 'Creature — Human', 'Max speed — Haste');
    const infinity = permanent('stone', 'p1', 'Artifact — Infinity', '∞ — At the beginning of your upkeep, draw a card.');
    const state: any = { battlefield: [maxSpeed, infinity], speed: { p1: 4 } };

    expect(computeContinuousEffects(state).permanentAbilities.get('racer')).toContain('haste');
    expect(computeContinuousEffects(state).permanentAbilities.get('stone')).toEqual(new Set());
    expect(harnessPermanent(state, 'stone')).toBe(true);
    expect(harnessPermanent(state, 'stone')).toBe(false);
    expect(computeContinuousEffects(state).permanentAbilities.get('stone'))
      .toContain('at the beginning of your upkeep, draw a card.');
  });

  it('increases speed once per turn when an opponent loses life', () => {
    const state: any = {
      turnPlayer: 'p1',
      players: [{ id: 'p1' }, { id: 'p2' }],
      speed: { p1: 1 },
      battlefield: [permanent('engine', 'p1', 'Artifact', 'Start your engines!')],
    };
    expect(maybeIncreaseSpeedFromOpponentLifeLoss(state, 'p2')).toBe(2);
    expect(state.speed.p1).toBe(2);
    expect(state.speedIncreasedThisTurn.p1).toBe(true);
    expect(maybeIncreaseSpeedFromOpponentLifeLoss(state, 'p2')).toBeNull();
    expect(state.speed.p1).toBe(2);

    resetSpeedIncreasedThisTurn(state);
    state.speed.p1 = 4;
    expect(maybeIncreaseSpeedFromOpponentLifeLoss(state, 'p2')).toBeNull();
    expect(maybeIncreaseSpeedFromOpponentLifeLoss(state, 'p1')).toBeNull();
  });

  it('applies enduring-story static effects from Oracle text', () => {
    const source = permanent(
      'thorin',
      'p1',
      'Legendary Creature — Dwarf',
      'Storied\nAs long as you have an enduring story, artifacts and creatures you control have ward {1}.',
    );
    const artifact = permanent('relic', 'p1', 'Artifact', '');
    const state: any = { battlefield: [source, artifact], enduringStory: { p1: true } };
    const effects = computeContinuousEffects(state);
    expect(effects.permanentAbilities.get('relic')).toContain('ward');
  });
});
