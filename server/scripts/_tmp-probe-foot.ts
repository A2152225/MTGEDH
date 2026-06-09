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
const card = cards.find((c) => c.name === 'Foot Chopper')!;
const oracle = getCombinedOracleText(card);
console.log('oracle:', oracle);
for (const t of parseTriggeredAbilitiesFromText(oracle, 'Foot Chopper')) {
  const steps = collectStepsFromIrText(t.effect, 'Foot Chopper');
  console.log('effect:', t.effect);
  console.log('steps', steps.map((s) => ({ kind: s.kind, raw: s.raw, optional: (s as any).optional, target: (s as any).target })));
  let state = buildAuditFixtureState('Foot Chopper', card.type_line);
  let ctx = buildAuditExecutionContext('Foot Chopper');
  const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Foot Chopper', oracle_text: oracle, type_line: card.type_line }, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
  console.log('chosen', targetEnriched.ctx.selectorContext?.chosenObjectIds?.filter((id) => id.includes('creature') || id.includes('attach')));
  const result = applyOracleIRStepsToGameState(targetEnriched.state, steps, targetEnriched.ctx, { allowOptional: true });
  console.log('gaps', result.automationGaps);
  console.log('skipped', result.skippedSteps);
}
