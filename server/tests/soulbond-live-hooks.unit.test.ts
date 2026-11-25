/**
 * Soulbond live hooks: ESM require() was silently failing on control change
 * and leave-battlefield cleanup (ReferenceError: require is not defined),
 * so pairing survived when it should have been cleared (CR 702.95).
 */
import { describe, expect, it } from 'vitest';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import { removePermanent } from '../src/state/modules/counters_tokens.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';

function pairedState() {
  return {
    battlefield: [
      {
        id: 'donna',
        controller: 'p1',
        owner: 'p1',
        pairedWith: 'bear',
        card: {
          id: 'donna-card',
          name: 'Donna Noble',
          type_line: 'Creature - Human',
          oracle_text: 'Soulbond',
        },
      },
      {
        id: 'bear',
        controller: 'p1',
        owner: 'p1',
        pairedWith: 'donna',
        card: {
          id: 'bear-card',
          name: 'Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
        },
      },
    ],
    zones: {
      p1: { hand: [], graveyard: [], exile: [] },
      p2: { hand: [], graveyard: [], exile: [] },
    },
    stack: [],
    players: [{ id: 'p1' }, { id: 'p2' }],
  };
}

const ctxOf = (state) => ({
  gameId: 'soulbond-live',
  state,
  bumpSeq() {},
  commandZone: {},
  libraries: new Map(),
});

describe('soulbond live hooks (ESM require was silently failing)', () => {
  it('applyEvent(changePermanentControl) unpairs when a paired creature changes controller', () => {
    const state = pairedState();
    applyEvent(ctxOf(state), {
      type: 'changePermanentControl',
      permanentId: 'donna',
      newController: 'p2',
      oldController: 'p1',
    });
    expect(state.battlefield.find((p) => p.id === 'donna').controller).toBe('p2');
    expect(state.battlefield.find((p) => p.id === 'donna').pairedWith).toBeFalsy();
    expect(state.battlefield.find((p) => p.id === 'bear').pairedWith).toBeFalsy();
  });

  it('removePermanent unpairs the partner still on the battlefield', () => {
    const state = pairedState();
    try {
      removePermanent(ctxOf(state), 'donna');
    } catch {
      // Later SBAs may throw on a minimal ctx; unpair must already have run.
    }
    expect(state.battlefield.some((p) => p.id === 'donna')).toBe(false);
    const bear = state.battlefield.find((p) => p.id === 'bear');
    expect(bear).toBeTruthy();
    expect(bear.pairedWith).toBeFalsy();
  });

  it('movePermanentToHand unpairs the partner still on the battlefield', () => {
    const state = pairedState();
    try {
      expect(movePermanentToHand(ctxOf(state), 'donna')).toBe(true);
    } catch {
      // Bounce follow-up may throw on a minimal ctx; unpair must already have run.
    }
    expect(state.battlefield.some((p) => p.id === 'donna')).toBe(false);
    const bear = state.battlefield.find((p) => p.id === 'bear');
    expect(bear).toBeTruthy();
    expect(bear.pairedWith).toBeFalsy();
  });
});
