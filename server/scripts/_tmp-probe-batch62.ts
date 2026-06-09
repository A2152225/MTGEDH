import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText, dryRunOracleSteps, buildAuditFixtureState } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

for (const name of [
  'Path to the Festival',
  'Tend the Sprigs',
  'Seedship Impact',
  'Orbital Plunge',
  'Rust-Shield Rampager',
]) {
  const card = cards.find((c: any) => c.name === name);
  if (!card) {
    console.log('missing', name);
    continue;
  }
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const irGaps = hasUnknownIRSteps(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status === 'fully_applied' && name !== 'Rust-Shield Rampager') continue;
    console.log('\n===', name, rec.status, '===');
    console.log('TEXT', text.slice(0, 150));
    console.log(
      'steps',
      steps.map((s) => ({
        k: s.kind,
        raw: String((s as any).raw || '').slice(0, 80),
        cond: (s as any).condition?.raw,
      }))
    );
    console.log('reasons', rec.reasonCodes, 'skipped kinds', rec.stepKinds);
    const state = buildAuditFixtureState(card.name, card.type_line);
    const ctx = buildOracleIRExecutionContext(card.name);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    console.log(
      'gaps',
      (result.automationGaps || []).slice(0, 5).map((g: any) => ({
        reason: g.reasonCode,
        kind: g.stepKind,
        msg: g.message?.slice(0, 100),
      }))
    );
    console.log(
      'skipped',
      (result.skippedSteps || []).map((s: any) => ({
        k: s.kind,
        raw: String(s.raw || '').slice(0, 60),
      }))
    );
  }
}
