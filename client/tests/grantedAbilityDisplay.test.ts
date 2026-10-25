import { describe, it, expect } from 'vitest';
import { appendGrantedActivatedAbilities } from '../src/utils/activatedAbilityParser-handlers/appendGrantedActivatedAbilities';
import { canonicalizeGrantedAbilityText, listGrantedActivatedAbilityLines } from '../../shared/src/grantedActivatedAbilityList';

function build(granted: string[]) { const a: any[] = []; appendGrantedActivatedAbilities(a, granted, 'land1'); return a; }

describe('granted ability display', () => {
  it('multi-mana grant keeps full amount', () => {
    const [ab] = build(['{T}: Add {C}{C}.']);
    expect(ab.id).toBe('land1-granted-0');
    expect(ab.isManaAbility).toBe(true);
    expect(ab.label + ' ' + ab.description).toMatch(/\{C\}\{C\}/);
  });
  it('single symbol still maps to native', () => {
    expect(build(['{T}: Add {G}.'])[0].id).toBe('native_g');
  });
  it('capitalises later sentences (lowercased spec grants)', () => {
    expect(canonicalizeGrantedAbilityText('{t}: add two mana of any one color. spend this mana only to cast instant spells.'))
      .toBe('{T}: Add two mana of any one color. Spend this mana only to cast instant spells.');
  });
  it('index parity unchanged by casing', () => {
    const a = listGrantedActivatedAbilityLines(['"{t}: add {c}. spend this mana only on x."', '{T}: Draw a card.']);
    const b = listGrantedActivatedAbilityLines(['"{T}: Add {C}. Spend this mana only on x."', '{T}: Draw a card.']);
    expect(a).toEqual(b);
  });
  it("Bootleggers' Stash grant is an activatable button on a land", () => {
    for (const g of [`Lands you control have "{T}: Create a Treasure token."`, '{T}: Create a Treasure token.', '{t}: create a treasure token.']) {
      const ab = build([g]).find((x) => x.id === 'land1-granted-0');
      expect(ab, g).toBeTruthy();
      expect(ab.requiresTap).toBe(true);
      expect(ab.isManaAbility).toBe(false);
      expect(ab.label).toMatch(/^Create a treasure token/i);
    }
  });
});
