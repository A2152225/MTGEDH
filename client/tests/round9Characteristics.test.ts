import { describe, it, expect } from 'vitest';
import { getPermanentRulesStatusChips, displayTypeLine } from '../src/components/PermanentRulesStatusBadges';
import { effectivePreviewTypeLine } from '../src/components/CardPreviewLayer';

describe('hover preview effective type line', () => {
  it('only shows when it differs from the printed line', () => {
    const land: any = { card: { type_line: 'Basic Land \u2014 Forest' }, rulesStatus: { effectiveLandTypeLine: 'Basic Land \u2014 Swamp' } };
    expect(effectivePreviewTypeLine(land.card.type_line, displayTypeLine(land))).toBe('Basic Land \u2014 Swamp');
    const moon: any = { card: { type_line: 'Legendary Creature' }, rulesStatus: { typeOverride: { typeLine: 'Land', colorless: true, isCreature: false } } };
    expect(effectivePreviewTypeLine(moon.card.type_line, displayTypeLine(moon))).toBe('Land');
    expect(effectivePreviewTypeLine('Creature', displayTypeLine({ card: { type_line: 'Creature' } }))).toBeUndefined();
  });
});

describe('round 9 characteristic chips', () => {
  it('copy, land types and conditional statics', () => {
    const perm: any = { id: 'm', card: { name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear' }, rulesStatus: {
      copyOf: { name: 'Grizzly Bears', typeLine: 'Artifact Creature \u2014 Bear', power: '2', toughness: '2', originalName: 'Phyrexian Metamorph', additions: ['Artifact'] },
      conditionalStatics: [{ sourceName: 'Thrasta', text: 'Hexproof for it while it entered this turn', active: false }] } };
    const chips = getPermanentRulesStatusChips(perm);
    expect(chips.find((c) => c.key === 'copy')!.title).toBe('Copy of Grizzly Bears (Phyrexian Metamorph): Artifact Creature \u2014 Bear 2/2. Except: Artifact.');
    const cs = chips.find((c) => c.key === 'cstatic0')!;
    expect(cs.label).toBe('\u25CB Hexproof');
    expect(cs.title).toMatch(/OFF$/);
    expect(displayTypeLine(perm)).toBe('Artifact Creature \u2014 Bear');
    const land: any = { card: { type_line: 'Basic Land \u2014 Forest' }, rulesStatus: { effectiveLandTypeLine: 'Basic Land \u2014 Swamp' } };
    expect(getPermanentRulesStatusChips(land).find((c) => c.key === 'landtypes')!.label).toBe('\u26F0 Swamp');
    expect(displayTypeLine(land)).toBe('Basic Land \u2014 Swamp');
  });
});
