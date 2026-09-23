from pathlib import Path
# Append a small event-detection smoke into empower test file or write tiny alone detection test in rules-engine
p = Path(r"D:/Git/MTGEDH/rules-engine/test/attacksAPlayerAloneDetection.unit.test.ts")
p.write_text(r'''import { describe, expect, it } from 'vitest';
import { TriggerEvent } from '../src/triggeredAbilitiesTypes';
import { detectTriggerEventFromText } from '../src/triggeredAbilitiesEventDetection';

describe('rules-engine attacks a player alone detection', () => {
  it('maps attacks a player alone to ATTACKS_A_PLAYER_ALONE', () => {
    const result = detectTriggerEventFromText('a creature you control attacks a player alone');
    expect(result?.event).toBe(TriggerEvent.ATTACKS_A_PLAYER_ALONE);
  });

  it('maps attacks alone to ATTACKS_ALONE', () => {
    const result = detectTriggerEventFromText('a creature you control attacks alone');
    expect(result?.event).toBe(TriggerEvent.ATTACKS_ALONE);
  });
});
''', encoding='utf-8', newline='\n')
print('wrote', p)

# find the actual export name for event detection
import re
text = Path(r"D:/Git/MTGEDH/rules-engine/src/triggeredAbilitiesEventDetection.ts").read_text(encoding='utf-8')
for m in re.finditer(r'^export function (\w+)', text, re.M):
  print('export', m.group(1))
