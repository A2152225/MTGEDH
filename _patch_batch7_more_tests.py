from pathlib import Path

Path(r'server/tests/on-cast-control-next-turn-library-top.unit.test.ts').write_text(r'''import { describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyGainControlStep } from '../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import { isControlOfTargetOpponentNextTurnEffect } from '../src/state/modules/triggerControlNextTurnUtils.js';

const PROMISED_END_ON_CAST =
  "you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn";

const WORLD_ANEW_ON_CAST = 'gain control of all creatures target player controls';

const LASHWEED_ON_CAST =
  "you may put target nonland permanent on top of its owner's library";

describe('on-cast control-next-turn + library_top metadata', () => {
  it('parses Promised-End-style control-next-turn + after-that-turn extra turn as IR steps', () => {
    const ir = parseOracleTextToIR(
      `When you cast this spell, ${PROMISED_END_ON_CAST}.`,
      'Emrakul, the Promised End',
    );
    const steps = ir.abilities.flatMap((a: any) => a.steps || []);
    const gain = steps.find((s: any) => s.kind === 'gain_control');
    const extra = steps.find((s: any) => s.kind === 'take_extra_turn');
    expect(gain).toBeTruthy();
    expect(String((gain as any).what?.text || (gain as any).what?.kind || '')).toMatch(/target opponent/i);
    expect((gain as any).duration).toBe('during_that_players_next_turn');
    expect(extra).toBeTruthy();
    expect((extra as any).who?.kind).toBe('target_player');
    expect(isControlOfTargetOpponentNextTurnEffect(PROMISED_END_ON_CAST)).toBe(true);
  });

  it('applyGainControlStep registers controlledPlayerNextTurn for control-next-turn duration', () => {
    const result = applyGainControlStep(
      { battlefield: [], controlledPlayerNextTurn: {} } as any,
      {
        kind: 'gain_control',
        what: { kind: 'raw', text: 'target opponent' },
        newController: { kind: 'you' },
        duration: 'during_that_players_next_turn',
        raw: PROMISED_END_ON_CAST,
      } as any,
      { controllerId: 'p1', targetPlayerId: 'p2', sourceName: 'Test' } as any,
    );
    expect(result.applied).toBe(true);
    expect((result.state as any).controlledPlayerNextTurn.p2).toBe('p1');
  });

  it('applyGainControlStep steals all creatures controlled by target player (World Anew-style)', () => {
    const result = applyGainControlStep(
      {
        battlefield: [
          { id: 'c1', controller: 'p2', type_line: 'Creature — Eldrazi' },
          { id: 'c2', controller: 'p3', type_line: 'Creature — Human' },
          { id: 'l1', controller: 'p2', type_line: 'Land' },
        ],
      } as any,
      {
        kind: 'gain_control',
        what: { kind: 'raw', text: 'all creatures target player controls' },
        newController: { kind: 'you' },
        duration: 'indefinite',
        raw: WORLD_ANEW_ON_CAST,
      } as any,
      { controllerId: 'p1', targetPlayerId: 'p2', sourceName: 'World Anew' } as any,
    );
    expect(result.applied).toBe(true);
    const bf = (result.state as any).battlefield;
    expect(bf.find((p: any) => p.id === 'c1').controller).toBe('p1');
    expect(bf.find((p: any) => p.id === 'c2').controller).toBe('p3');
    expect(bf.find((p: any) => p.id === 'l1').controller).toBe('p2');
  });

  it('infers library_top destination metadata for Lashweed-style put-on-library', () => {
    const meta = inferTriggeredAbilityTargetMetadata(LASHWEED_ON_CAST);
    expect(meta.requiresTarget).toBe(true);
    expect(meta.targetType).toBe('nonland permanent');
    expect(meta.targetDestination).toBe('library_top');
    expect(meta.destinationUsesSelectedCardOwner).toBe(true);
  });
});
''', encoding='utf-8')
print('wrote focused on-cast unit test')

# Update guardrail expectations to prefer generic names while shim still exists
p = Path(r'server/tests/oracle-ir-trigger-legacy-guardrail.test.ts')
t = p.read_text(encoding='utf-8')
# Add import of new source file near emrakulGainControlSource
if 'controlNextTurnSource' not in t:
    old = """const emrakulGainControlSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerEmrakulGainControlUtils.ts'),
"""
    # find full block
    idx = t.find("const emrakulGainControlSource = readFileSync(")
    if idx < 0:
        raise SystemExit('emrakulGainControlSource missing')
    # insert after the emrakul block ends at ');'
    end = t.find("');", idx)
    end = t.find('\n', end)
    insert = """
const controlNextTurnSource = readFileSync(
  join(serverRoot, 'src/state/modules/triggerControlNextTurnUtils.ts'),
  'utf8',
);
"""
    t = t[:end+1] + insert + t[end+1:]

t = t.replace(
    "expect(emrakulGainControlSource.includes('applyEmrakulGainControlOfTargetOpponentFromTrigger')).toBe(true);",
    "expect(controlNextTurnSource.includes('applyControlOfTargetOpponentNextTurnFromTrigger')).toBe(true);\n    expect(emrakulGainControlSource.includes('applyEmrakulGainControlOfTargetOpponentFromTrigger')).toBe(true);",
)
t = t.replace(
    "expect(stackExecuteTriggerEffectPrefaceUtilsSource.includes('applyEmrakulGainControlOfTargetOpponentFromTrigger')).toBe(true);",
    "expect(stackExecuteTriggerEffectPrefaceUtilsSource.includes('applyControlOfTargetOpponentNextTurnFromTrigger')).toBe(true);",
)
p.write_text(t, encoding='utf-8')
print('guardrail updated')
