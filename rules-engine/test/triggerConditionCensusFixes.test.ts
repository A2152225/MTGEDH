import { describe, expect, it } from 'vitest';

import { parseTriggerClause } from '../src/triggerCondition/parseFamilies';
import { normalizeSelfNameInTriggerSentence } from '../src/triggerCondition/selfNameNormalize';

describe('trigger IR census fixes', () => {
  it('normalizes the card name (full and short) to this permanent', () => {
    expect(normalizeSelfNameInTriggerSentence('Whenever Omo enters or attacks', 'Omo, Queen of Vesuva'))
      .toBe('Whenever this permanent enters or attacks');
    const parsed: any = parseTriggerClause('Whenever Grim Haruspex attacks, draw a card.', 'Grim Haruspex');
    expect(parsed?.condition).toBeTruthy();
    expect(parsed?.effect).toBeTruthy();
  });

  it('parses "At the beginning of the end step"', () => {
    const parsed: any = parseTriggerClause('At the beginning of the end step, sacrifice this creature.');
    expect(parsed?.condition).toBeTruthy();
  });

  it('parses self paired events with pairedEvent set', () => {
    const parsed: any = parseTriggerClause('Whenever this creature enters or attacks, draw a card.');
    expect(parsed?.condition).toBeTruthy();
    expect(parsed?.condition?.pairedEvent).toBeTruthy();
    expect(parsed?.condition?.pairedEvent).not.toBe(parsed?.condition?.event);
  });
});
