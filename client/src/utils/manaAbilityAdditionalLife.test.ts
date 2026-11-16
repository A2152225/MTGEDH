import { describe, expect, it } from 'vitest';
import {
  additionalManaAbilityLifeCostFromCard,
  calculateSuggestedPaymentAccountingForLife,
  formatManaAbilityPaymentLabel,
  parseAdditionalLifeToActivateManaAbilities,
  paymentMapLifeCost,
} from './manaAbilityAdditionalLife';
import { parseActivatedAbilities } from './activatedAbilityParser';

const thranOracle = [
  'This land enters tapped unless you control two or fewer other lands.',
  'As this land enters, choose a basic land type.',
  'Thran Portal is the chosen type in addition to its other types.',
  '{T}: Add one mana of any color.',
  'Mana abilities of this land cost an additional 1 life to activate.',
].join('\n');

describe('Thran Portal additional life on mana abilities', () => {
  it('parses the additional life static and labels the payment UI "plus 1 life"', () => {
    expect(parseAdditionalLifeToActivateManaAbilities(thranOracle)).toBe(1);
    expect(additionalManaAbilityLifeCostFromCard({ oracle_text: thranOracle })).toBe(1);
    expect(formatManaAbilityPaymentLabel('{T}: Add one mana of any color', 1)).toBe('{T}: Add one mana of any color (plus 1 life)');
  });

  it('stamps lifeCost on the land\'s parsed mana abilities', () => {
    const card: any = { id: 't1', name: 'Thran Portal', type_line: 'Land — Mountain', oracle_text: thranOracle };
    const abilities = parseActivatedAbilities(card);
    const mana = abilities.filter((ability: any) => ability.isManaAbility);
    expect(mana.length).toBeGreaterThan(0);
    expect(mana.every((ability: any) => ability.lifeCost === 1)).toBe(true);
  });

  it('auto-pay prefers a free source and will not spend more life than the payer has', () => {
    const cost = { colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } as any, generic: 1, hybrids: [] };
    const island: any = { id: 'island', options: ['U'], lifeCost: 0 };
    const portal: any = { id: 'portal', options: ['U', 'R', 'G', 'W', 'B'], lifeCost: 1 };
    const preferFree = calculateSuggestedPaymentAccountingForLife(cost, [portal, island], new Set());
    expect([...preferFree.keys()].some((id) => id === 'island' || id.startsWith('island'))).toBe(true);
    expect(paymentMapLifeCost(preferFree, [portal, island])).toBe(0);

    const onlyPortal = calculateSuggestedPaymentAccountingForLife(cost, [portal], new Set(), undefined, undefined, 0);
    expect(paymentMapLifeCost(onlyPortal, [portal])).toBe(0);
    const withLife = calculateSuggestedPaymentAccountingForLife(cost, [portal], new Set(), undefined, undefined, 5);
    expect(paymentMapLifeCost(withLife, [portal])).toBe(1);
  });
});
