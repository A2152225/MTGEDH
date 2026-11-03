import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyTurnFaceUpCounters } from '../src/state/modules/turnFaceUpCounterPlacement.js';

// B51: turn-face-up / megamorph counters go through counter-placement replacements.
const HARDENED_SCALES = { id: 'hs', controller: 'p1', owner: 'p1', card: { id: 'hs_c', name: 'Hardened Scales', type_line: 'Enchantment', oracle_text: 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.' } };
const DOUBLING_SEASON = { id: 'ds', controller: 'p1', owner: 'p1', card: { id: 'ds_c', name: 'Doubling Season', type_line: 'Enchantment', oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.' } };
const MEGAMORPH = { id: 'mm_c', name: 'Den Protector', type_line: 'Creature - Human Warrior', oracle_text: 'Megamorph {1}{G}', power: '2', toughness: '1' };
const HOODED_HYDRA = { id: 'hh_c', name: 'Hooded Hydra', type_line: 'Creature - Snake Hydra', oracle_text: 'Morph {3}{G}{G}\nAs Hooded Hydra is turned face up, put five +1/+1 counters on it.', power: '0', toughness: '0' };

function setup(extra: any[], card: any) {
  const game: any = createInitialGameState('b51_faceup_' + Math.random());
  const perm: any = { id: 'face_up_1', controller: 'p1', owner: 'p1', card: { ...card, type_line: card.type_line }, counters: {} };
  game.state.battlefield = [...extra.map(x => JSON.parse(JSON.stringify(x))), perm];
  return { state: game.state, perm };
}

describe('B51 turn-face-up counters with counter modifiers', () => {
  it('megamorph without modifiers puts one +1/+1 counter', () => {
    const { state, perm } = setup([], MEGAMORPH);
    applyTurnFaceUpCounters(perm, MEGAMORPH, state);
    expect(perm.counters['+1/+1']).toBe(1);
  });
  it('megamorph with Hardened Scales puts two', () => {
    const { state, perm } = setup([HARDENED_SCALES], MEGAMORPH);
    applyTurnFaceUpCounters(perm, MEGAMORPH, state);
    expect(perm.counters['+1/+1']).toBe(2);
  });
  it('megamorph with Doubling Season puts two', () => {
    const { state, perm } = setup([DOUBLING_SEASON], MEGAMORPH);
    applyTurnFaceUpCounters(perm, MEGAMORPH, state);
    expect(perm.counters['+1/+1']).toBe(2);
  });
  it('Hooded Hydra with Hardened Scales and Doubling Season gets the modified amount', () => {
    const { state, perm } = setup([HARDENED_SCALES, DOUBLING_SEASON], HOODED_HYDRA);
    applyTurnFaceUpCounters(perm, HOODED_HYDRA, state);
    // Controller orders replacements; either order is legal: (5+1)*2=12 or 5*2+1=11.
    expect([11, 12]).toContain(perm.counters['+1/+1']);
  });
  it('without game state falls back to the printed amount', () => {
    const perm: any = { id: 'x', controller: 'p1', counters: {} };
    applyTurnFaceUpCounters(perm, HOODED_HYDRA);
    expect(perm.counters['+1/+1']).toBe(5);
  });
});
