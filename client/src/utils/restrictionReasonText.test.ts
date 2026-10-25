import { describe, it, expect } from 'vitest';
import { readableCastRestriction, readableCombatError } from './restrictionReasonText';
import { describeGameRuleError } from './gameRuleErrorToast';

describe('restrictionReasonText', () => {
  it('rewrites cast-another restriction', () => {
    expect(readableCastRestriction("Cast this spell only if you've cast another red spell this turn.")).toBe("you haven't cast another red spell this turn yet.");
    expect(readableCastRestriction("Cast this spell only if you've cast another spell this turn.")).toBe("you haven't cast another spell this turn yet.");
    expect(readableCastRestriction('other')).toBeNull();
    expect(describeGameRuleError({ code: 'CANNOT_CAST_STATIC_RESTRICTION', message: "Cast this spell only if you've cast another blue spell this turn." }))
      .toBe("Can't cast that spell: you haven't cast another blue spell this turn yet.");
  });
  it('rewrites batch25 block reasons', () => {
    expect(readableCombatError("Bears can't block Drake (Attacker can't be blocked except by creatures with flying or reach)"))
      .toBe("Bears can't block Drake \u2014 Drake can only be blocked by creatures with flying or reach.");
    expect(readableCombatError("Bears can't block Loner (Attacker can't be blocked while attacking alone)"))
      .toBe("Bears can't block Loner \u2014 Loner can't be blocked while it's attacking alone.");
    expect(readableCombatError("Bears can't block X (has flying)")).toBe("Bears can't block X (has flying)");
  });
});
