import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { collectSpellResolutionEffectStepsWithOverlay } from '../src/oracleIRCompilerEnvelope.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import type { GameState } from '../../shared/src/index.js';

const RITE_TEXT =
  'Whenever a creature or enchantment you control enters this turn, draw a card.\nFlashback {2}{G}{W} (You may cast this card from your graveyard for its flashback cost. Then exile it.)';

function collectSpellSteps(text: string, name: string) {
  return collectSpellResolutionEffectStepsWithOverlay(text, name, null).filter((step) => {
    const raw = String((step as { raw?: string }).raw || '').toLowerCase();
    return !/flashback/.test(raw) && !/^then exile it$/.test(raw.trim());
  });
}

describe('temporary ETB window oracle IR (Rite of Harmony family)', () => {
  it('parses a this-turn creature/enchantment ETB window as grant_temporary_etb_trigger', () => {
    const ir = parseOracleTextToIR(RITE_TEXT, 'Rite of Harmony');
    const spellAbilities = (ir.abilities || []).filter((ability) => String(ability.type) === 'spell');
    const windowSteps = spellAbilities.flatMap((ability) => ability.steps || [])
      .filter((step) => step.kind === 'grant_temporary_etb_trigger');
    expect(windowSteps).toHaveLength(1);
    expect(windowSteps[0]).toMatchObject({
      kind: 'grant_temporary_etb_trigger',
      watchTypes: ['creature', 'enchantment'],
      effect: 'draw a card',
      duration: 'until_end_of_turn',
    });
  });

  it('collects the window as a spell-resolution step', () => {
    const steps = collectSpellSteps(RITE_TEXT, 'Rite of Harmony');
    expect(steps.map((step) => step.kind)).toContain('grant_temporary_etb_trigger');
    expect(steps.some((step) => step.kind === 'draw')).toBe(false);
  });

  it('applies the window onto state.temporaryEtbTriggers without drawing', () => {
    const steps = collectSpellSteps(RITE_TEXT, 'Rite of Harmony')
      .filter((step) => step.kind === 'grant_temporary_etb_trigger');
    const state = {
      players: [{ id: 'p1', library: [{ id: 'd1', name: 'Plains' }], hand: [] }],
      battlefield: [],
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'rite-1',
        sourceName: 'Rite of Harmony',
        sourceObjectType: 'spell',
      }),
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['grant_temporary_etb_trigger']);
    expect((result.state as any).temporaryEtbTriggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        controller: 'p1',
        sourceName: 'Rite of Harmony',
        description: 'draw a card',
        watchTypes: ['creature', 'enchantment'],
        expiresAt: 'end_of_turn',
      }),
    ]));
    expect((result.state as any).players[0].hand).toEqual([]);
  });
});
