import { describe, expect, it } from 'vitest';

import {
  collectOpponentOwnedExileCardTargets,
  parseReflexiveExileToOwnersGraveyardWhenYouDo,
  parseReflexiveFixedPaymentWhenYouDo,
} from '../src/state/modules/reflexive-triggers.js';

describe('parseReflexiveFixedPaymentWhenYouDo accepts If you do', () => {
  it('matches Bearer of Silence wording', () => {
    const parsed = parseReflexiveFixedPaymentWhenYouDo(
      'you may pay {1}{C}. If you do, target opponent sacrifices a creature.',
    );
    expect(parsed?.manaCost).toBe('{1}{C}');
    expect(parsed?.paymentText).toBe('{1}{C}');
    expect(parsed?.followupText).toMatch(/target opponent sacrifices a creature/i);
  });

  it('still matches legacy When you do wording', () => {
    const parsed = parseReflexiveFixedPaymentWhenYouDo(
      'You may pay {2}. When you do, draw a card.',
    );
    expect(parsed?.manaCost).toBe('{2}');
    expect(parsed?.followupText).toMatch(/draw a card/i);
  });
});

describe('parseReflexiveExileToOwnersGraveyardWhenYouDo', () => {
  it('parses single-card processor', () => {
    const parsed = parseReflexiveExileToOwnersGraveyardWhenYouDo(
      "you may put a card an opponent owns from exile into that player's graveyard. If you do, you gain 5 life.",
    );
    expect(parsed).toMatchObject({ putCount: 1, ownerScope: 'opponent' });
    expect(parsed?.followupText).toMatch(/gain 5 life/i);
  });

  it('parses multi-card processor', () => {
    const parsed = parseReflexiveExileToOwnersGraveyardWhenYouDo(
      "You may put two cards your opponents own from exile into their owners' graveyards. If you do, create three 1/1 colorless Eldrazi Scion creature tokens.",
    );
    expect(parsed).toMatchObject({ putCount: 2, ownerScope: 'opponents' });
  });
});

describe('collectOpponentOwnedExileCardTargets', () => {
  it('collects opponent-owned exile cards across zones', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: { exile: [{ id: 'own1', name: 'Mine', owner: 'p1' }] },
        p2: {
          exile: [
            { id: 'opp1', name: 'Theirs', owner: 'p2' },
            { id: 'opp2', name: 'Also Theirs', owner: 'p2' },
          ],
        },
      },
    };
    const targets = collectOpponentOwnedExileCardTargets(state, 'p1');
    expect(targets.map((t) => t.id).sort()).toEqual(['opp1', 'opp2']);
  });
});
