import { describe, expect, it } from 'vitest';

import { getManaAbilitiesForPermanent } from '../src/state/modules/mana-abilities-handlers/manaAbilitiesForPermanent.js';
import { paymentActivationCostHasUnsupportedAdditionalCosts } from '../src/socket/util-handlers/paymentActivationCostHasUnsupportedAdditionalCosts.js';

const SPIRE_ORACLE =
  '{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color. Activate only if you control an artifact.';

describe('Spire of Industry mana payment', () => {
  it('treats pay-1-life activation costs as supported for spell payment', () => {
    expect(paymentActivationCostHasUnsupportedAdditionalCosts('{T}, Pay 1 life', 'Spire of Industry')).toBe(false);
    expect(paymentActivationCostHasUnsupportedAdditionalCosts('{T}, Discard a card', 'Lotus Petal')).toBe(true);
  });

  it('exposes colorless always and pay-life any-color only with an artifact', () => {
    const spire = {
      id: 'spire_1',
      controller: 'p1',
      tapped: false,
      card: {
        name: 'Spire of Industry',
        type_line: 'Land',
        oracle_text: SPIRE_ORACLE,
      },
    };

    const withoutArtifact = getManaAbilitiesForPermanent({ battlefield: [spire] }, spire, 'p1');
    expect(withoutArtifact.some((ability) => ability.id === 'native_c')).toBe(true);
    expect(withoutArtifact.some((ability) => ability.id === 'native_pay_life_any')).toBe(false);
    expect(withoutArtifact.some((ability) => ability.id === 'native_any')).toBe(false);

    const withArtifact = getManaAbilitiesForPermanent(
      {
        battlefield: [
          spire,
          {
            id: 'sol_1',
            controller: 'p1',
            card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
          },
        ],
      },
      spire,
      'p1',
    );
    const payLife = withArtifact.find((ability) => ability.id === 'native_pay_life_any');
    expect(payLife?.cost).toBe('{T}, Pay 1 life');
    expect([...(payLife?.produces || [])].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(payLife?.additionalCosts).toEqual([{ type: 'pay_life', amount: 1 }]);
    expect(withArtifact.some((ability) => ability.id === 'native_any')).toBe(false);
  });
});
