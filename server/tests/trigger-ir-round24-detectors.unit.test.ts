import { describe, expect, it } from 'vitest';
import { detectTransformTriggers } from '../src/state/modules/triggers/status-keyword-detection.js';
import { detectDiscardTriggers, getDiscardTriggers } from '../src/state/modules/triggers/discard.js';

const SPIRITUAL_FOCUS = 'Whenever a spell or ability an opponent controls causes you to discard a card, you gain 2 life and you may draw a card.';

describe('round 24 detectors', () => {
  it('"when you have N or less life" is not a transform trigger unless it transforms or flips', () => {
    const opal = { name: 'Opal Avenger', oracle_text: 'When you have 10 or less life, if Opal Avenger is an enchantment, it becomes a 3/5 Soldier creature.' };
    expect(detectTransformTriggers(opal, { id: 'o', controller: 'p1' }).map((t) => String(t.triggerType))).toEqual(['life_threshold']);
    const flip = { name: 'Test', oracle_text: 'When you have 5 or less life, transform Test.' };
    expect(detectTransformTriggers(flip, { id: 't', controller: 'p1' }).map((t) => t.effect)).toEqual(['transform Test']);
  });

  it('Spiritual Focus fires only for opponent-caused discards', () => {
    const perm = { id: 'sf', controller: 'p1', card: { name: 'Spiritual Focus', type_line: 'Enchantment', oracle_text: SPIRITUAL_FOCUS } };
    expect(detectDiscardTriggers(perm.card, perm).map((t) => t.triggerType)).toEqual(['forced_discard']);
    const ctx: any = { state: { players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [perm] } };
    expect(getDiscardTriggers(ctx, 'p1', { causeControllerId: 'p2' })).toHaveLength(1);
    expect(getDiscardTriggers(ctx, 'p1', { causeControllerId: 'p1' })).toHaveLength(0);
    expect(getDiscardTriggers(ctx, 'p1')).toHaveLength(0);
    expect(getDiscardTriggers(ctx, 'p2', { causeControllerId: 'p1' })).toHaveLength(0);
  });
});
