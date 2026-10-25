import { describe, it, expect } from 'vitest';
import { describeGameRuleError } from '../src/utils/gameRuleErrorToast';
import { parseExileAbilities } from '../src/components/ExileViewModal';

describe('batch 20 UI', () => {
  it('names the lock source for CANNOT_ACTIVATE_LOCKED', () => {
    const t = describeGameRuleError({ code: 'CANNOT_ACTIVATE_LOCKED', message: "Sol Ring's activated abilities can't be activated (Null Rod).", sourceName: 'Null Rod' });
    expect(t).toBe("Ability can't be activated \u2014 locked by Null Rod: Sol Ring's activated abilities can't be activated.");
    expect(describeGameRuleError({ code: 'CANNOT_ACTIVATE_LOCKED', message: 'X locked.' })).toBe("Ability can't be activated: X locked.");
  });
  it('Uba Mask badge follows the server playable list', () => {
    const card: any = { id: 'c1', name: 'Bear', exiledWithSourceId: 'mask', ubaMaskExiledTurn: 3 };
    expect(parseExileAbilities(card, 3, ['c1'])[0].label).toBe('Playable this turn');
    expect(parseExileAbilities(card, 3, [])[0].label).toBe('Exiled instead of drawn');
    expect(parseExileAbilities(card, 3)[0].label).toBe('Playable this turn');
  });
});
