import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from '../../server/scripts/executor-coverage-audit';

function runCardEffect(oracleText: string, cardName: string) {
  const parsed = parseOracleTextToIR(oracleText, cardName);
  const ability = parsed.abilities.find((entry) => entry.type === 'spell' || entry.type === 'static');
  const steps = ability?.steps ?? [];
  let state = buildAuditFixtureState(cardName);
  let ctx = buildAuditExecutionContext(cardName);
  const enriched = enrichAuditStateAndContextForCopySteps(
    { name: cardName, oracle_text: oracleText },
    steps,
    state,
    ctx
  );
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
    oracleText,
  });
  return applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
    allowOptional: true,
  });
}

describe('oracle IR gap batch393', () => {
  it('shuffles creature cards from target player graveyard into library (Repopulate)', () => {
    const result = runCardEffect(
      "Shuffle all creature cards from target player's graveyard into that player's library.\nCycling {2}",
      'Repopulate'
    );
    const gaps = (result.automationGaps || []).filter((gap) => gap.reasonCode !== 'player_choice_required');
    expect(gaps).toEqual([]);
  });

  it('returns commanders to the command zone (Leadership Vacuum)', () => {
    const result = runCardEffect(
      'Target player returns each commander they control from the battlefield to the command zone.',
      'Leadership Vacuum'
    );
    const gaps = (result.automationGaps || []).filter((gap) => gap.reasonCode !== 'player_choice_required');
    expect(gaps).toEqual([]);
  });

  it('draws equal to the milled card mana value (Heed the Mists)', () => {
    const result = runCardEffect(
      "Target player mills two cards.\nThen draw cards equal to the milled card's mana value.",
      'Heed the Mists'
    );
    const gaps = (result.automationGaps || []).filter((gap) => gap.reasonCode !== 'player_choice_required');
    expect(gaps).toEqual([]);
  });
});
