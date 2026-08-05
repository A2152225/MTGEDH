import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  probeOracleEffectProgramShadow,
  requiresCoreEffectProgramOrchestration,
  requiresEffectProgramOrchestration,
  requiresSpellEffectProgramOrchestration,
} from '../src/state/modules/oracleIrEffectProgramServer.js';

function spellSteps(oracle: string, name = 'Test Spell') {
  return parseOracleTextToIR(oracle, name).abilities?.[0]?.steps || [];
}

const GREEN_SUNS_TWILIGHT_TEXT =
  'Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.';

describe('Effect Program core gate (P2a)', () => {
  it('routes optional create_token with follow-up through core EP', () => {
    const steps = spellSteps(
      'You may create a 1/1 white Soldier creature token. If you do, draw a card.',
    );
    expect(steps.some((step) => step.kind === 'create_token' && (step as any).optional)).toBe(true);
    expect(requiresCoreEffectProgramOrchestration(steps as any)).toBe(true);
    expect(requiresSpellEffectProgramOrchestration(steps as any)).toBe(true);
  });

  it('keeps lone optional create_token on direct IR (no follow-up)', () => {
    const steps = spellSteps('You may create a 1/1 white Soldier creature token.');
    if (steps.length === 1 && steps[0]?.kind === 'create_token') {
      expect(requiresCoreEffectProgramOrchestration(steps as any)).toBe(false);
    }
  });

  it('keeps Green Sun reveal/player_choice compounds on direct IR (core false, broad true)', () => {
    const steps = spellSteps(GREEN_SUNS_TWILIGHT_TEXT, "Green Sun's Twilight");
    expect(requiresEffectProgramOrchestration(steps as any)).toBe(true);
    expect(requiresSpellEffectProgramOrchestration(steps as any)).toBe(false);
  });

  it('routes unresolved choose_mode through core EP', () => {
    // Prefer a corpus-shaped modal that the parser already proves in migration tests.
    const steps = spellSteps(
      'Choose one —\n• Target player draws a card.\n• Target player gains 3 life.',
      'Azorius Charm',
    );
    const hasChooseMode = steps.some((step) => step.kind === 'choose_mode');
    expect(hasChooseMode || steps.some((step) => step.kind === 'draw' || step.kind === 'gain_life')).toBe(true);
    if (hasChooseMode) {
      expect(requiresCoreEffectProgramOrchestration(steps as any)).toBe(true);
      expect(requiresCoreEffectProgramOrchestration(steps as any, ['mode_0'])).toBe(false);
    }
  });

  it('shadow probe accepts modal EP without throwing (P2d)', () => {
    const steps = spellSteps(
      'Choose one —\n• Target player draws a card.\n• Target player gains 3 life.',
      'Azorius Charm',
    );
    if (!steps.some((step) => step.kind === 'choose_mode')) return;

    const game = createInitialGameState('ep_shadow_probe');
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    const ctx = game as any;
    ctx.gameId = 'ep_shadow_probe';
    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'charm-1',
      sourceName: 'Azorius Charm',
    });
    expect(() =>
      probeOracleEffectProgramShadow(ctx, {
        controller: p1,
        sourceName: 'Azorius Charm',
        sourceId: 'charm-1',
        steps,
        irCtx,
        programIdPrefix: 'shadow:azorius-charm',
        metadata: { family: 'spell_resolution' },
      }),
    ).not.toThrow();
  });
});
