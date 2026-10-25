import { describe, it, expect } from 'vitest';
import { upkeepUntapCostSummary, decorateBatch24OptionChoice, describeAmplifyRevealed, describeFirstTurnsRefusal } from './batch24ChoicePresentation';
import { buildGenericOptionChoiceRequestFromStep } from './resolutionChoicePrimitives';
import { describeGameRuleError } from './gameRuleErrorToast';
import { collectStateEventToasts, createStateEventTracker } from './stateEventToasts';

describe('batch24 choice presentation', () => {
  it('paid untap running total', () => {
    expect(upkeepUntapCostSummary(2, 0)).toBe('Pay {2} per creature \u2014 total {0} for 0 creatures');
    expect(upkeepUntapCostSummary(2, 3)).toContain('total {6} for 3 creatures');
  });
  it('amplify options show counters per card', () => {
    const req = buildGenericOptionChoiceRequestFromStep({ id: 's', amplifyRevealChoice: true, amplifyValue: 2, description: 'Amplify 2: reveal',
      options: [{ id: 'c1', label: 'Goblin A' }], minSelections: 0, maxSelections: 1 }, 'g', false);
    expect(req.options[0].description).toBe('Reveal: +2 +1/+1 counters');
    expect(req.description).toContain('+2 +1/+1 counters');
    expect(req.minSelections).toBe(0);
  });
  it('fasting yes/no reads as skip draw to gain 2 life', () => {
    const r = decorateBatch24OptionChoice({ optionalDrawStepSkipChoice: true, sourceName: 'Fasting' }, 'x', [{ id: 'skip', label: 'Skip draw step' }, { id: 'draw', label: 'd' }]);
    expect(r.description).toBe('Fasting: skip your draw step to gain 2 life?');
    expect(r.options.map((o) => o.label)).toEqual(['Skip draw (gain 2 life)', 'Draw normally']);
  });
  it('other steps unchanged', () => {
    const o = [{ id: 'a', label: 'A' }];
    expect(decorateBatch24OptionChoice({}, 'd', o)).toEqual({ description: 'd', options: o });
  });
  it('amplify reveal toast once, not on join', () => {
    const tr = createStateEventTracker();
    expect(collectStateEventToasts(tr, { id: 'g', battlefield: [] })).toEqual([]);
    const v = { id: 'g', battlefield: [{ id: 'p', card: { name: 'Kilnmouth Dragon' }, amplifyRevealed: ['Shivan Dragon'] }] };
    expect(collectStateEventToasts(tr, v)).toEqual(['Kilnmouth Dragon amplified: revealed Shivan Dragon']);
    expect(collectStateEventToasts(tr, v)).toEqual([]);
    expect(describeAmplifyRevealed({ amplifyRevealed: [] })).toBeNull();
  });
  it('first-turns refusal readable', () => {
    const msg = "This spell can't be cast during your first, second, or third turns of the game (turn 2).";
    expect(describeFirstTurnsRefusal(msg)).toContain('this is your turn 2');
    expect(describeGameRuleError({ code: 'CANNOT_CAST_STATIC_RESTRICTION', message: msg })).toMatch(/^Can't cast that spell: Not during your first three turns/);
    expect(describeFirstTurnsRefusal('other')).toBeNull();
  });
});
