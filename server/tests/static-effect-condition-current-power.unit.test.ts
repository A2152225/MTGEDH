import { describe, expect, it } from 'vitest';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec.js';
// Importing this module registers the shared current-P/T reader that static-effect conditions use.
import '../src/state/modules/currentPowerToughness.js';
import { CANT_ATTACK } from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingCantAttack.js';

const ENSNARING_BRIDGE_ORACLE =
  "Creatures with power greater than the number of cards in your hand can't attack.";

function bridgeState(handCount: number, creatures: any[]) {
  return {
    battlefield: [
      { id: 'bridge_1', controller: 'p1', card: { name: 'Ensnaring Bridge', type_line: 'Artifact', oracle_text: ENSNARING_BRIDGE_ORACLE } },
      ...creatures,
    ],
    zones: { p1: { hand: Array.from({ length: handCount }, (_, i) => ({ id: `c${i}` })), handCount } },
  };
}

const ogre = (extra: Record<string, unknown> = {}) => ({
  id: 'ogre_1',
  controller: 'p2',
  card: { name: 'Gray Ogre', type_line: 'Creature — Ogre', oracle_text: '', power: 2, toughness: 2 },
  ...extra,
});

describe('static condition target_power_greater_than_source_controller_hand_size reads current power', () => {
  it('still uses printed power when nothing modifies it', () => {
    const state = bridgeState(2, [ogre()]);
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state))
      .not.toEqual(expect.arrayContaining([CANT_ATTACK]));
  });

  it('counts +1/+1 counters on the creature', () => {
    const state = bridgeState(2, [ogre({ counters: { '+1/+1': 1 } })]);
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state))
      .toEqual(expect.arrayContaining([CANT_ATTACK]));
  });

  it('counts until-end-of-turn pumps that are not in any cached effectivePower field', () => {
    const state = bridgeState(2, [ogre({ temporaryPTMods: [{ power: 2, toughness: 0, until: 'end_of_turn' }] })]);
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state))
      .toEqual(expect.arrayContaining([CANT_ATTACK]));
  });

  it('ignores a stale cached effectivePower that no longer matches the real current power', () => {
    const state = bridgeState(2, [ogre({ effectivePower: 9 })]);
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state))
      .not.toEqual(expect.arrayContaining([CANT_ATTACK]));
  });

  it('does not recurse forever when the Bridge itself is a creature whose power depends on static effects', () => {
    const selfBridge = {
      id: 'bridge_2', controller: 'p1',
      card: { name: 'Bridge Golem', type_line: 'Artifact Creature — Golem', oracle_text: ENSNARING_BRIDGE_ORACLE, power: 3, toughness: 3 },
    };
    const state = { battlefield: [selfBridge, ogre()], zones: { p1: { hand: [], handCount: 0 } } };
    expect(() => getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state)).not.toThrow();
    expect(getContinuousGrantedAbilitiesForPermanent(state.battlefield[1] as any, state))
      .toEqual(expect.arrayContaining([CANT_ATTACK]));
  });
});