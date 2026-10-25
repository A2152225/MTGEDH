import { describe, expect, it } from 'vitest';
import { getPermanentRulesStatusChips, isActivationFullyLocked } from '../src/components/PermanentRulesStatusBadges';
import { describeGameRuleError } from '../src/utils/gameRuleErrorToast';

const players = [{ id: 'p1', name: 'Robert' }, { id: 'p2', name: 'Alex' }];

describe('PermanentRulesStatusBadges chips', () => {
  it('shows stolen control with duration and names', () => {
    const chips = getPermanentRulesStatusChips({ id: 'c', rulesStatus: { control: { owner: 'p2', controller: 'p1', duration: 'end_of_turn' } } }, players);
    expect(chips).toHaveLength(1);
    expect(chips[0].title).toContain('Controlled by Robert until end of turn');
    expect(chips[0].title).toContain('Owner: Alex');
  });

  it('shows lock, abilities lost, added types, solved, paired and saddled', () => {
    const perm = {
      id: 'a', solved: true, saddled: true, pairedWith: 'b',
      rulesStatus: { abilitiesLost: true, activationLocked: { sourceName: 'Arrest', manaAbilitiesAllowed: false }, addedTypes: ['Creature'] },
    };
    const keys = getPermanentRulesStatusChips(perm, players, [perm, { id: 'b', card: { name: 'Wolfir Silverheart' } }]).map((c) => c.key);
    expect(keys).toEqual(['lost', 'lock', 'types', 'solved', 'paired', 'saddled']);
    expect(isActivationFullyLocked(perm)).toBe(true);
    expect(isActivationFullyLocked({ rulesStatus: { activationLocked: { manaAbilitiesAllowed: true } } })).toBe(false);
  });

  it('returns nothing for a plain permanent', () => {
    expect(getPermanentRulesStatusChips({ id: 'x' })).toEqual([]);
  });
});

describe('describeGameRuleError', () => {
  it('formats rule rejections and ignores other codes', () => {
    expect(describeGameRuleError({ code: 'CANNOT_CAST_STATIC_RESTRICTION', message: 'You can cast only one spell each turn.' }))
      .toBe("Can't cast that spell: You can cast only one spell each turn.");
    expect(describeGameRuleError({ code: 'NO_GENERIC_COST', message: 'Cannot request assist: NO_GENERIC_COST' }))
      .toBe("Can't request assist: This spell has no generic mana for a helper to pay.");
    expect(describeGameRuleError({ code: 'TOO_FEW_BLOCKERS', message: 'x' })).toBeNull();
  });
});
