import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.ts';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectStepsFromIrText,
  dryRunOracleSteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

await loadEffectIrParser();

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["Gix's Caress", 'Memory Theft', 'Hard-Hitting Question', 'Path to the Festival', 'Rust-Shield Rampager'];

for (const name of names) {
  const card = cards.find((c) => c.name === name);
  if (!card) {
    console.log('NOT FOUND', name);
    continue;
  }
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, card.name);
  console.log('\nCARD', name);
  for (const a of parsed.abilities || []) {
    const text = String(a.effectText || a.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const irGaps = hasUnknownIRSteps(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    console.log(`  [${rec.status}] ${text.slice(0, 95)}`);
    if (rec.status !== 'fully_applied' && rec.status !== 'choice_required') {
      console.log('    steps', steps.map((s) => `${s.kind}:${String((s as any).raw || '').slice(0, 45)}`));
      console.log('    reasons', rec.reasonCodes, 'kinds', rec.stepKinds);
      let state = buildAuditFixtureState(card.name, card.type_line);
      let ctx = buildAuditExecutionContext(card.name);
      const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: oracle });
      const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
      console.log('    gaps', (result.automationGaps || []).map((g) => `${g.reasonCode}:${g.stepKind}`));
      console.log('    skipped', (result.skippedSteps || []).map((s) => `${s.kind}:${String((s as any).raw || '').slice(0, 45)}`));
    }
  }
}
