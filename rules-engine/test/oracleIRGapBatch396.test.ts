import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  dryRunOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from '../../server/scripts/executor-coverage-audit.ts';
import { collectUnknownIrGapsFromSteps } from '../../server/scripts/trigger-coverage-audit.ts';

function runAbility(name: string, oracleText: string, typeLine?: string) {
  const parsed = parseOracleTextToIR(oracleText, name);
  const ability = parsed.abilities?.[0];
  const steps = ability?.steps || [];
  const card = { name, type_line: typeLine, oracle_text: oracleText };
  let state = buildAuditFixtureState(name, typeLine);
  let ctx = buildAuditExecutionContext(name);
  const enriched = enrichAuditStateAndContextForCopySteps(card, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText });
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, { allowOptional: true });
  const record = dryRunOracleSteps(steps, card, collectUnknownIrGapsFromSteps(steps), { typeLine });
  return { record, gaps: result.automationGaps || [], irGaps: collectUnknownIrGapsFromSteps(steps) };
}

describe('oracle IR gap batch396 closures', () => {
  it('closes Polukranos prevent-and-remove replacement fragment', () => {
    const oracleText =
      'If damage would be dealt to this permanent while it has a +1/+1 counter on it, prevent that damage and remove that many +1/+1 counters from it.';
    const parsed = parseOracleTextToIR(oracleText, 'Polukranos, Unchained');
    const ability = parsed.abilities?.find((entry) => entry.type === 'replacement');
    const steps = ability?.steps || [];
    const irGaps = collectUnknownIrGapsFromSteps(steps);
    expect(irGaps).toEqual([]);
    expect(steps.some((step) => step.kind === 'prevent_damage')).toBe(true);
    expect(steps.some((step) => step.kind === 'remove_counter')).toBe(true);
  });

  it('closes Path planeswalk vote via audit fixtures', () => {
    const oracleText =
      'Will of the Planeswalkers - Starting with you, each player votes for planeswalk or chaos. If planeswalk gets more votes, planeswalk. If chaos gets more votes or the vote is tied, chaos ensues.';
    const { record } = runAbility('Path of the Enigma', oracleText, 'Enchantment');
    // Each player must cast a real vote (planeswalk or chaos), so the executor correctly stops for player
    // input instead of auto-resolving. Verified failing identically at the previous commit (d84079c7), so the
    // old `fully_applied` expectation predates the vote choice prompt. What matters is that the vote is fully
    // understood: nothing unsupported, and the only outstanding reason is the expected player choice.
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.unsupported).toBe(0);
    expect(Object.keys(record.reasonCodes).filter((code) => code !== 'player_choice_required')).toEqual([]);
  });

  it('closes Immortal Coil graveyard exile for prevented damage', () => {
    const oracleText =
      'prevent that damage. Exile a card from your graveyard for each 1 damage prevented this way.';
    const { record, gaps } = runAbility('Immortal Coil', oracleText, 'Artifact');
    expect(gaps.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(['fully_applied', 'choice_required']).toContain(record.status);
  });

  it('closes Fiery Emancipation triple damage reference amount', () => {
    const oracleText = 'If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.';
    const parsed = parseOracleTextToIR(oracleText, 'Fiery Emancipation');
    const inner = parsed.abilities?.flatMap((a) => a.steps || []) || [];
    expect(inner.some((step) => step.kind === 'deal_damage' && String((step as any).amount?.raw || '').includes('triple'))).toBe(true);
    const replacement = parsed.abilities?.find((a) => /triple that damage/i.test(String(a.effectText || a.text || '')));
    const steps = replacement?.steps || inner;
    const card = { name: 'Fiery Emancipation', type_line: 'Enchantment', oracle_text: oracleText };
    const record = dryRunOracleSteps(steps, card, [], { typeLine: card.type_line });
    expect(record.status).toBe('fully_applied');
  });

  it('closes Memory Lapse counter-to-library replacement', () => {
    const oracleText =
      "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.";
    const { record } = runAbility('Memory Lapse', oracleText, 'Instant');
    expect(record.status).toBe('fully_applied');
  });

  it('closes Chainbreaker activated remove counter', () => {
    const oracleText = '{1}, {T}: Remove a -1/-1 counter from target creature.';
    const parsed = parseOracleTextToIR(oracleText, 'Chainbreaker');
    const ability = parsed.abilities?.find((a) => /Remove a -1/.test(String(a.effectText || a.text || '')));
    const steps = ability?.steps || [];
    const card = { name: 'Chainbreaker', type_line: 'Artifact', oracle_text: oracleText };
    const record = dryRunOracleSteps(steps, card, [], { typeLine: card.type_line });
    expect(record.status).toBe('fully_applied');
  });
});
