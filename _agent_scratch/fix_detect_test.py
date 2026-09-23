from pathlib import Path
p = Path(r"D:/Git/MTGEDH/rules-engine/test/attacksAPlayerAloneDetection.unit.test.ts")
p.write_text('''import { describe, expect, it } from 'vitest';
import { TriggerEvent } from '../src/triggeredAbilitiesTypes';
import { detectTriggeredAbilityEvent } from '../src/triggeredAbilitiesEventDetection';

const EVENT_VALUES = Object.fromEntries(
  Object.values(TriggerEvent).map((value) => [String(value).toUpperCase(), value]),
) as Record<string, TriggerEvent>;

// The detector expects keys like ATTACKS_ALONE matching TriggerEvent enum member names.
const triggerEventValues = TriggerEvent as unknown as Record<string, TriggerEvent>;

describe('rules-engine attacks a player alone detection', () => {
  it('maps attacks a player alone to ATTACKS_A_PLAYER_ALONE', () => {
    const result = detectTriggeredAbilityEvent(
      'a creature you control attacks a player alone',
      triggerEventValues,
    );
    expect(result.event).toBe(TriggerEvent.ATTACKS_A_PLAYER_ALONE);
  });

  it('maps attacks alone to ATTACKS_ALONE', () => {
    const result = detectTriggeredAbilityEvent(
      'a creature you control attacks alone',
      triggerEventValues,
    );
    expect(result.event).toBe(TriggerEvent.ATTACKS_ALONE);
  });
});
''', encoding='utf-8', newline='\n')
print('rewrote detection test')
