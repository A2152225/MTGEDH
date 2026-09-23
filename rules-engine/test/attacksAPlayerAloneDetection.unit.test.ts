import { describe, expect, it } from 'vitest';
import { TriggerEvent } from '../src/triggeredAbilitiesTypes';
import { detectTriggeredAbilityEvent } from '../src/triggeredAbilitiesEventDetection';

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
