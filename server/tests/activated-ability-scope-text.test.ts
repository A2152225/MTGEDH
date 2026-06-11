import { describe, expect, it } from 'vitest';

import { getActivatedAbilityScopeText } from '../src/socket/interaction.js';

const WHIP_INLINE_ORACLE =
  '{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else. Activate only as a sorcery.';

describe('getActivatedAbilityScopeText', () => {
  it('keeps multi-sentence activated effects on single-line oracle text', () => {
    const { abilityText, fullAbilityText } = getActivatedAbilityScopeText(
      WHIP_INLINE_ORACLE,
      'whip-0',
    );

    expect(abilityText).toContain('It gains haste');
    expect(abilityText).toContain('Exile it at the beginning of the next end step');
    expect(abilityText).toContain('If it would leave the battlefield, exile it instead');
    expect(abilityText).not.toMatch(/^Return target creature card from your graveyard to the battlefield\.$/);
    expect(fullAbilityText).toContain('It gains haste');
  });
});
