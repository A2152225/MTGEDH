import { describe, it, expect } from 'vitest';
import { parseAlternateCosts } from '../src/components/CastSpellModal-handlers/castSpellModalParseAlternateCosts';
import { withPitchColorRequirement, buildGenericOptionChoiceRequestFromStep } from '../src/utils/resolutionChoicePrimitives';
import { getPermanentRulesStatusChips } from '../src/components/PermanentRulesStatusBadges';

const SOLITUDE = 'Flash\nLifelink\nWhen Solitude enters, exile up to one other target creature.\nEvoke\u2014Exile a white card from your hand.';

describe('evoke by exiling a card', () => {
  it('offers evoke_exile with no mana cost', () => {
    const costs = parseAlternateCosts(SOLITUDE, '{3}{W}{W}', 'Solitude');
    const c = costs.find((x) => x.id === 'evoke_exile');
    expect(c).toBeTruthy();
    expect(c!.hideManaCost).toBe(true);
    expect(c!.additionalCost).toMatch(/white card/);
    expect(costs.some((x) => x.id === 'evoke')).toBe(false);
  });
  it('accepts hyphen/en dash and keeps mana evoke separate', () => {
    expect(parseAlternateCosts('Evoke - exile a red card from your hand.', '{3}{R}{R}', 'Fury').some((x) => x.id === 'evoke_exile')).toBe(true);
    const mana = parseAlternateCosts('Evoke {2}{U}', '{4}{U}', 'Mulldrifter');
    expect(mana.some((x) => x.id === 'evoke')).toBe(true);
    expect(mana.some((x) => x.id === 'evoke_exile')).toBe(false);
  });
  it('picker description shows the colour requirement', () => {
    const step = { id: 's', type: 'option_choice', forceOfWillExileChoice: true, forcePitchColor: 'R', forcePitchColorWord: 'red', description: 'Choose a card to exile.' };
    expect(withPitchColorRequirement(step)).toBe('Choose a card to exile. Requirement: exile a red card from your hand.');
    expect(buildGenericOptionChoiceRequestFromStep({ ...step, description: 'To evoke Fury, exile a red card from your hand.' }, 'g', true).description)
      .toBe('To evoke Fury, exile a red card from your hand.');
    expect(withPitchColorRequirement({ description: 'x' })).toBe('x');
  });
  it('shows an Evoked chip', () => {
    expect(getPermanentRulesStatusChips({ evoked: true }).some((c) => c.key === 'evoked')).toBe(true);
    expect(getPermanentRulesStatusChips({}).some((c) => c.key === 'evoked')).toBe(false);
  });
});
