import { describe, expect, it } from 'vitest';
import { parseTriggeredAbilitiesFromText } from '../src/triggeredAbilitiesParsing';
import { TriggerEvent } from '../src/triggeredAbilitiesTypes';

describe('compound OR trigger parsing', () => {
  it('splits cast-or-enters triggers into separate abilities', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      'Whenever you cast a green spell or a Forest you control enters, you gain 1 life.',
      'SRC',
      'P1',
      'Staff of the Wild Magus',
    );

    expect(abilities).toHaveLength(2);
    expect(abilities.some((ability) => ability.event === TriggerEvent.SPELL_CAST)).toBe(true);
    expect(abilities.some((ability) => ability.event === TriggerEvent.LANDFALL)).toBe(true);
  });
});
