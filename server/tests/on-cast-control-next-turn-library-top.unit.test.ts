import { describe, expect, it } from 'vitest';

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
