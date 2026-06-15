import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from '../../server/scripts/executor-coverage-audit.ts';
import { collectUnknownIrGapsFromSteps } from '../../server/scripts/trigger-coverage-audit.ts';

function runAuditAbility(name: string, oracleText: string, typeLine?: string) {
  const parsed = parseOracleTextToIR(oracleText, name);
  const gaps: Array<{ reasonCode?: string; message?: string }> = [];
  const irGaps: string[] = [];
  for (const ability of parsed.abilities || []) {
    const steps = ability.steps || [];
    if (steps.length === 0) continue;
    irGaps.push(...collectUnknownIrGapsFromSteps(steps));
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
  return { gaps, irGaps };
}

describe('oracle IR gap batch395 closures', () => {
  it('closes haunt/provoke keyword-only static abilities without ir_gap', () => {
    const haunt = runAuditAbility('Orzhov Pontiff', 'Haunt', 'Creature — Human Cleric');
    expect(haunt.irGaps).toEqual([]);
    const provoke = runAuditAbility('Goblin Grappler', 'Provoke', 'Creature — Goblin Berserker');
    expect(provoke.irGaps).toEqual([]);
  });

  it('closes prepared entry without unknown prepared fragment', () => {
    const oracleText =
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)";
    const { irGaps } = runAuditAbility('Adventurous Eater // Have a Bite', oracleText, 'Creature — Human Wizard');
    expect(irGaps.some((gap) => /^prepared$/i.test(gap))).toBe(false);
  });

  it('closes transform keyword costs without ir_gap', () => {
    const mtme = runAuditAbility(
      'Jetfire, Ingenious Scientist // Jetfire, Air Guardian',
      'More Than Meets the Eye {3}{U}',
      'Legendary Artifact Creature — Robot'
    );
    expect(mtme.irGaps).toEqual([]);
    const recover = runAuditAbility('Grim Harvest', 'Recover {2}{B}', 'Instant');
    expect(recover.irGaps).toEqual([]);
  });

  it('closes standalone prevent that damage replacement fragment', () => {
    const { irGaps } = runAuditAbility('Phantom Nantuko', 'prevent that damage.', 'Creature — Spirit');
    expect(irGaps).toEqual([]);
  });
});
