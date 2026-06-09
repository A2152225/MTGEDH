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
const card = cards.find((c) => c.name === 'Deathgorge Scavenger')!;
const oracle = getCombinedOracleText(card);
for (const t of parseTriggeredAbilitiesFromText(oracle, 'Deathgorge Scavenger')) {
  const steps = collectStepsFromIrText(t.effect, 'Deathgorge Scavenger');
  console.log('effect:', t.effect);
  console.log(JSON.stringify(steps, null, 2));
  let state = buildAuditFixtureState('Deathgorge Scavenger');
  let ctx = buildAuditExecutionContext('Deathgorge Scavenger');
  const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Deathgorge Scavenger', oracle_text: oracle }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, { allowOptional: true });
  console.log('applied', result.appliedSteps?.map((s) => `${s.kind}${(s as any).optional ? '?' : ''}`));
  console.log('skipped', result.skippedSteps);
  console.log('gaps', result.automationGaps);
}
