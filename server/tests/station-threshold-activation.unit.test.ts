import { describe, expect, it } from 'vitest';

import { hasActivatableAbility } from '../src/state/modules/can-respond-handlers/canRespondActivatableAbilities.js';

const TRANSWARP_ORACLE =
  "When this Spacecraft enters, mill five cards. You may put up to two artifact cards from among them into your hand.\n" +
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)\n" +
  "3+ | {T}: Target creature can't be blocked this turn.";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      turnPlayer: 'p1',
      activePlayer: 'p1',
      phase: 'precombatMain',
      step: 'MAIN1',
      stack: [],
      battlefield: [],
      life: { p1: 40 },
      zones: { p1: { hand: [], library: [], graveyard: [] } },
      players: [{ id: 'p1', name: 'P1' }],
      ...overrides,
    },
  } as any;
}

describe('station threshold gated activated abilities', () => {
  it('does not treat Transwarp Hub 3+ tap ability as activatable with 0 charge counters', () => {
    const hub = {
      id: 'hub1',
      controller: 'p1',
      tapped: false,
      counters: {},
      card: {
        id: 'hub1-card',
        name: 'Transwarp Hub',
        type_line: 'Artifact — Spacecraft',
        oracle_text: TRANSWARP_ORACLE,
        keywords: ['Station'],
      },
    };
    const creature = {
      id: 'c1',
      controller: 'p1',
      tapped: false,
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const ctx = makeCtx({ battlefield: [hub, creature] });
    // Station itself is legal in main (sorcery window), but the gated {T} must not alone
    // make canRespond think an instant-speed action exists when charges are 0.
    // hasActivatableAbility returns true for Station window in main — isolate by emptying stack
    // and checking with no untapped station crew: only the gated tap remains.
    const ctxNoCrew = makeCtx({ battlefield: [hub] });
    expect(hasActivatableAbility(ctxNoCrew, 'p1', hub)).toBe(false);
  });

  it('treats Transwarp Hub 3+ tap ability as activatable at 3 charge counters', () => {
    const hub = {
      id: 'hub1',
      controller: 'p1',
      tapped: false,
      counters: { charge: 3 },
      card: {
        id: 'hub1-card',
        name: 'Transwarp Hub',
        type_line: 'Artifact — Spacecraft',
        oracle_text: TRANSWARP_ORACLE,
        keywords: ['Station'],
      },
    };
    const ctx = makeCtx({ battlefield: [hub] });
    expect(hasActivatableAbility(ctx, 'p1', hub)).toBe(true);
  });
});
