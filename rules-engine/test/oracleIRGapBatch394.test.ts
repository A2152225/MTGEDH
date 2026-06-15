import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from '../../server/scripts/executor-coverage-audit.ts';

function runAuditCard(name: string, oracleText: string, typeLine?: string) {
  const parsed = parseOracleTextToIR(oracleText, name);
  const gaps: Array<{ reasonCode?: string; message?: string }> = [];
  for (const ability of parsed.abilities || []) {
    const steps = ability.steps || [];
    if (steps.length === 0) continue;
    let state = buildAuditFixtureState(name, typeLine);
    let ctx = buildAuditExecutionContext(name);
    const enriched = enrichAuditStateAndContextForCopySteps(
      { name, type_line: typeLine, oracle_text: oracleText },
      steps,
      state,
      ctx
    );
    const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
      oracleText,
    });
    const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, {
      allowOptional: true,
    });
    gaps.push(...(result.automationGaps || []).filter((gap) => gap.reasonCode !== 'player_choice_required'));
  }
  return gaps;
}

describe('oracle IR gap batch394 closures', () => {
  it('closes Manic Scribe delirium mill without unsupported player selector', () => {
    const oracleText =
      'When this creature enters, each opponent mills three cards.\n' +
      'Delirium — At the beginning of each opponent\'s upkeep, if there are four or more card types among cards in your graveyard, that player mills three cards.';
    const gaps = runAuditCard('Manic Scribe', oracleText, 'Creature — Human Wizard');
    expect(gaps.some((gap) => gap.reasonCode === 'unsupported_player_selector')).toBe(false);
  });

  it('closes Sierra quest-counter buff without target_not_on_battlefield', () => {
    const oracleText =
      '{T}: Put a quest counter on this permanent.\n' +
      'Whenever you put one or more quest counters on this permanent, create a Food token.\n' +
      '{1}, {T}: Target creature you control gets +X/+X until end of turn, where X is the number of quest counters on this permanent.';
    const gaps = runAuditCard('Sierra, Nuka\'s Biggest Fan', oracleText, 'Artifact');
    expect(gaps.some((gap) => gap.reasonCode === 'target_not_on_battlefield')).toBe(false);
  });

  it('closes Dino DNA exiled-with copy token without impossible_action', () => {
    const oracleText =
      '{T}: Create a token that\'s a copy of target creature card exiled with this artifact, except it\'s a 6/6 green Dinosaur creature with trample.';
    const gaps = runAuditCard('Dino DNA', oracleText, 'Artifact');
    expect(gaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
  });
});
