import { describe, expect, it } from 'vitest';
import {
  isCommanderLegalCard,
  isIgnorableCardForIrGap,
} from '../scripts/trigger-coverage-audit.ts';

describe('trigger coverage legality filters', () => {
  it('audits commander-legal Unfinity eternal cards', () => {
    const eternalUnf = {
      name: 'Ambassador Blorpityblorpboop',
      set: 'unf',
      set_type: 'funny',
      border_color: 'black',
      legalities: { commander: 'legal' },
    };
    expect(isCommanderLegalCard(eternalUnf)).toBe(true);
    expect(isIgnorableCardForIrGap(eternalUnf)).toBe(false);
  });

  it('ignores non-eternal Unfinity cards', () => {
    const acornUnf = {
      name: 'Surprise Party',
      set: 'unf',
      set_type: 'funny',
      border_color: 'black',
      legalities: { commander: 'not_legal' },
    };
    expect(isCommanderLegalCard(acornUnf)).toBe(false);
    expect(isIgnorableCardForIrGap(acornUnf)).toBe(true);
  });

  it('ignores silver-border cards even when funny set', () => {
    const silver = {
      name: 'Some Silver Card',
      set: 'ust',
      set_type: 'funny',
      border_color: 'silver',
      legalities: { commander: 'not_legal' },
    };
    expect(isIgnorableCardForIrGap(silver)).toBe(true);
  });
});
