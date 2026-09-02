import { describe, expect, it } from 'vitest';

import {
  getSelfRatherThanPayAlternateManaCost,
  opponentSearchedTheirLibraryThisTurn,
  parseRatherThanPayThisSpellManaCost,
} from '../src/state/modules/alternate-costs.js';
import {
  queueLibrarySearchTriggers,
  recordOwnLibrarySearchThisTurn,
} from '../src/state/modules/triggers/search.js';

const ARCHIVE_TRAP_ORACLE =
  "If an opponent searched their library this turn, you may pay {0} rather than pay this spell's mana cost.\nTarget opponent mills thirteen cards.";

describe('Archive Trap trap alternate cost', () => {
  it('parses the {0} rather-than-pay cost', () => {
    expect(parseRatherThanPayThisSpellManaCost(ARCHIVE_TRAP_ORACLE)).toBe('{0}');
  });

  it('requires an opponent to have searched their own library this turn', () => {
    expect(opponentSearchedTheirLibraryThisTurn({
      playersWhoSearchedOwnLibraryThisTurn: ['p1'],
    }, 'p1')).toBe(false);

    expect(opponentSearchedTheirLibraryThisTurn({
      playersWhoSearchedOwnLibraryThisTurn: ['p2'],
    }, 'p1')).toBe(true);

    expect(opponentSearchedTheirLibraryThisTurn({
      playersWhoSearchedOwnLibraryThisTurn: [],
    }, 'p1')).toBe(false);
  });

  it('does not count searching someone else\'s library', () => {
    const state: any = { playersWhoSearchedOwnLibraryThisTurn: [] };
    recordOwnLibrarySearchThisTurn(state, 'p2', 'p1');
    expect(state.playersWhoSearchedOwnLibraryThisTurn).toEqual([]);
    expect(opponentSearchedTheirLibraryThisTurn(state, 'p1')).toBe(false);
  });

  it('is payable only after an opponent searches their library', () => {
    const card = { name: 'Archive Trap', oracle_text: ARCHIVE_TRAP_ORACLE, mana_cost: '{3}{U}{U}' };
    const unavailable = getSelfRatherThanPayAlternateManaCost(
      { state: { playersWhoSearchedOwnLibraryThisTurn: [] } } as any,
      'p1',
      card,
    );
    expect(unavailable).toBeUndefined();

    const available = getSelfRatherThanPayAlternateManaCost(
      { state: { playersWhoSearchedOwnLibraryThisTurn: ['p2'] } } as any,
      'p1',
      card,
    );
    expect(available).toBe('{0}');
  });

  it('records own-library search even when no search triggers are on the battlefield', () => {
    const state: any = { battlefield: [], stack: [], playersWhoSearchedOwnLibraryThisTurn: [] };
    const queued = queueLibrarySearchTriggers(
      { state, gameId: 'test_archive_trap_search_ledger' } as any,
      'p2',
      { sourceName: 'Evolving Wilds', searchedLibraryOwnerId: 'p2' },
    );
    expect(queued).toEqual([]);
    expect(state.playersWhoSearchedOwnLibraryThisTurn).toEqual(['p2']);
  });
});
