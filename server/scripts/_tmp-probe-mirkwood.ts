import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Mirkwood Elk')!;
const oracle = getCombinedOracleText(card);
for (const t of parseTriggeredAbilitiesFromText(oracle, 'Mirkwood Elk')) {
  const steps = collectStepsFromIrText(t.effect, 'Mirkwood Elk');
  console.log('steps', JSON.stringify(steps, null, 2));
  let state = buildAuditFixtureState('Mirkwood Elk');
  let ctx = buildAuditExecutionContext('Mirkwood Elk');
  const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Mirkwood Elk', oracle_text: oracle }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, { allowOptional: true });
  console.log('gaps', result.automationGaps);
}
