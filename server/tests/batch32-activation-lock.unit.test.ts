import { describe, it, expect } from 'vitest';
import { parseOpponentActivationLock, opponentActivationProhibitionReason } from '../src/state/modules/opponentActivationLocks.js';

const ABOLISHER = "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.";
const mk = (id: string, controller: string, name: string, type_line: string, oracle_text = '') => ({ id, controller, card: { name, type_line, oracle_text } });

describe('B32 opponent activation lock', () => {
  it('parses Grand Abolisher', () => {
    expect(parseOpponentActivationLock(ABOLISHER)).toEqual({ duringYourTurnOnly: true, types: ['artifact', 'creature', 'enchantment'], allowsMana: false });
  });
  it('parses unconditional curly-quote variant and rejects non-type lists', () => {
    expect(parseOpponentActivationLock('Your opponents can\u2019t activate abilities of planeswalkers.')?.types).toEqual(['planeswalker']);
    expect(parseOpponentActivationLock("Your opponents can't activate abilities of sources with the chosen name.")).toBeNull();
  });
  const state = (turnPlayer: string) => ({ turnPlayer, battlefield: [mk('a', 'p1', 'Grand Abolisher', 'Creature', ABOLISHER), mk('t', 'p2', 'Sol Ring', 'Artifact'), mk('l', 'p2', 'Forest', 'Basic Land')] });
  it('blocks opponent artifact (incl. mana) abilities during the holder turn', () => {
    const s = state('p1');
    expect(opponentActivationProhibitionReason(s, 'p2', s.battlefield[1], true)).toMatch(/Grand Abolisher/);
  });
  it('does not block lands, the holder, or on other turns', () => {
    const s = state('p1');
    expect(opponentActivationProhibitionReason(s, 'p2', s.battlefield[2])).toBeNull();
    expect(opponentActivationProhibitionReason(s, 'p1', s.battlefield[0])).toBeNull();
    const s2 = state('p2');
    expect(opponentActivationProhibitionReason(s2, 'p2', s2.battlefield[1])).toBeNull();
  });
});
