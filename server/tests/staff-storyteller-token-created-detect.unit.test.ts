import { describe, expect, it } from 'vitest';
import { detectTokenCreatedTriggers } from '../src/state/modules/triggers/tokens.js';

describe('Staff of the Storyteller token-created detect', () => {
  it('matches "whenever you create one or more creature tokens"', () => {
    const staff = {
      name: 'Staff of the Storyteller',
      oracle_text:
        'When this artifact enters, create a 1/1 white Spirit creature token with flying.\n' +
        'Whenever you create one or more creature tokens, put a story counter on this artifact.\n' +
        '{W}, {T}, Remove a story counter from this artifact: Draw a card.',
    };
    const triggers = detectTokenCreatedTriggers(staff, { id: 'staff1', controller: 'p1' });
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.some((t: any) => /story counter/i.test(String(t.effect || t.oracleClause || '')))).toBe(true);
  });
});
