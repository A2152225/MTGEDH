import { describe, expect, it } from 'vitest';

import {
  getSelfRatherThanPayAlternateManaCost,
  opponentCastThreeOrMoreSpellsThisTurn,
  parseRatherThanPayThisSpellManaCost,
} from '../src/state/modules/alternate-costs.js';

const MINDBREAK_TRAP_ORACLE =
  "If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell's mana cost.\nExile any number of target spells.";

describe('Mindbreak Trap trap alternate cost', () => {
  it('parses the {0} rather-than-pay cost', () => {
    expect(parseRatherThanPayThisSpellManaCost(MINDBREAK_TRAP_ORACLE)).toBe('{0}');
  });

  it('requires a single opponent to have cast three or more spells this turn', () => {
    expect(opponentCastThreeOrMoreSpellsThisTurn({
      spellsCastThisTurn: [
        { casterId: 'p2' },
        { casterId: 'p3' },
        { casterId: 'p4' },
      ],
    }, 'p1')).toBe(false);

    expect(opponentCastThreeOrMoreSpellsThisTurn({
      spellsCastThisTurn: [
        { casterId: 'p2' },
        { casterId: 'p2' },
        { casterId: 'p2' },
      ],
    }, 'p1')).toBe(true);
  });

  it('is payable only when the trap condition is met', () => {
    const card = { name: 'Mindbreak Trap', oracle_text: MINDBREAK_TRAP_ORACLE, mana_cost: '{2}{U}{U}' };
    const unavailable = getSelfRatherThanPayAlternateManaCost(
      { state: { spellsCastThisTurn: [{ casterId: 'p2' }] } } as any,
      'p1',
      card,
    );
    expect(unavailable).toBeUndefined();

    const available = getSelfRatherThanPayAlternateManaCost(
      { state: { spellsCastThisTurn: [{ casterId: 'p2' }, { casterId: 'p2' }, { casterId: 'p2' }] } } as any,
      'p1',
      card,
    );
    expect(available).toBe('{0}');
  });
});
