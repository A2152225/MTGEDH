/**
 * Debug Brain Pry dry run — run: npx tsx server/scripts/_tmp-debug-brain-pry.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

await loadEffectIrParser();

const card = cards.find((c) => c.name === 'Brain Pry')!;
const text =
  'Choose a nonland card name. Target player reveals their hand. That player discards a card with that name. If they can\'t, you draw a card.';
const steps = collectStepsFromIrText(text, card.name);
const irGaps = hasUnknownIRSteps(text, card.name);
const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
console.log('steps:', steps.map((s) => s.kind));
console.log('status:', rec.status, rec.reasonCodes);

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.ts';
import { buildAuditFixtureState, buildAuditExecutionContext, enrichAuditStateAndContextForTargets } from './executor-coverage-audit.ts';

let state = buildAuditFixtureState(card.name, card.type_line);
let ctx = buildAuditExecutionContext(card.name);
const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: getCombinedOracleText(card) });
const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
console.log('applied:', result.appliedSteps?.map((s) => s.kind));
console.log('skipped:', result.skippedSteps?.map((s) => [s.kind, (s as any).raw?.slice(0, 40)]));
console.log('gaps:', result.automationGaps?.map((g) => [g.reasonCode, g.stepKind, g.message?.slice(0, 60)]));
