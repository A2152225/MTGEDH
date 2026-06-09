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
import { applyMoveZoneStep } from '../../rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.js';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Magnetic Snuffler')!;
const oracle = getCombinedOracleText(card);
const t = parseTriggeredAbilitiesFromText(oracle, 'Magnetic Snuffler').find((x) => x.effect.includes('equipment'))!;
const steps = collectStepsFromIrText(t.effect, 'Magnetic Snuffler');
const step = steps[0] as any;
let state = buildAuditFixtureState('Magnetic Snuffler', card.type_line);
let ctx = buildAuditExecutionContext('Magnetic Snuffler');
const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Magnetic Snuffler', oracle_text: oracle, type_line: card.type_line }, steps, state, ctx);
const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
console.log('type_line', card.type_line);
console.log('bf-source', (targetEnriched.state.battlefield || []).find((p: any) => p.id === 'bf-source'));
console.log('chosen gy', targetEnriched.ctx.selectorContext?.chosenObjectIds?.filter((id: string) => id.startsWith('gy-')));
const result = applyMoveZoneStep(targetEnriched.state, step, targetEnriched.ctx, {});
console.log('move result', result);
