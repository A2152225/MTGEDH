import { describe, expect, it } from 'vitest';
import {
  grantedAbilityIsOwnKeyword,
  oracleTextGrantsKeywordOnlyToOthers,
  oracleTextHasOwnKeyword,
} from '../src/oracleOwnKeywordText.js';

describe('oracleTextHasOwnKeyword', () => {
  it('detects a printed haste keyword line', () => {
    expect(oracleTextHasOwnKeyword('Haste\nWhen this creature dies, draw a card.', 'haste')).toBe(true);
    expect(oracleTextHasOwnKeyword('Flying, haste', 'haste')).toBe(true);
  });

  it('does not treat Other [type] you control have haste as self haste', () => {
    const alpha =
      'Other Dinosaurs you control have haste.\nWhen this creature enters, create a 3/3 green Dinosaur creature token with trample.';
    expect(oracleTextHasOwnKeyword(alpha, 'haste')).toBe(false);
  });

  it('still detects haste when the card also grants it to others', () => {
    expect(oracleTextHasOwnKeyword(
      'Haste\nOther Goblin creatures you control have haste.',
      'haste',
    )).toBe(true);
  });

  it('flags Other [type] have haste as a grant to others only', () => {
    const alpha =
      'Other Dinosaurs you control have haste.\nWhen this creature enters, create a 3/3 green Dinosaur creature token with trample.';
    expect(oracleTextGrantsKeywordOnlyToOthers(alpha, 'haste')).toBe(true);
    expect(oracleTextGrantsKeywordOnlyToOthers('Flying, haste', 'haste')).toBe(false);
    expect(grantedAbilityIsOwnKeyword('haste', 'haste')).toBe(true);
    expect(grantedAbilityIsOwnKeyword('Other Dinosaurs you control have haste.', 'haste')).toBe(false);
  });
});
