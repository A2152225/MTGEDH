import fs from 'node:fs';
import path from 'node:path';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  collectStepsFromIrText,
  buildAuditFixtureState,
  buildAuditExecutionContext,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Magnetic Snuffler')!;
const oracle = getCombinedOracleText(card);
for (const t of parseTriggeredAbilitiesFromText(oracle, 'Magnetic Snuffler')) {
  const steps = collectStepsFromIrText(t.effect, 'Magnetic Snuffler');
  console.log('effect:', t.effect);
  console.log(JSON.stringify(steps, null, 2));
  let state = buildAuditFixtureState('Magnetic Snuffler', card.type_line);
  let ctx = buildAuditExecutionContext('Magnetic Snuffler');
  const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Magnetic Snuffler', oracle_text: oracle, type_line: card.type_line }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, { allowOptional: true });
  console.log('gaps', result.automationGaps);
}
