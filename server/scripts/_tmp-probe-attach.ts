import { applyAttachStep } from '../../rules-engine/src/oracleIRExecutorAttachStepHandlers.js';
import { buildAuditExecutionContext, buildAuditFixtureState, enrichAuditStateAndContextForTargets, collectStepsFromIrText } from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';

await loadEffectIrParser();
const cards = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8'))) as any[];
const card = cards.find((c: any) => c.name === 'Sword of Light and Shadow');
const oracle = getCombinedOracleText(card);
for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
  const effect = String(trigger.effect || '').trim();
  const steps = collectStepsFromIrText(effect, card.name);
  const attach = steps.find((s: any) => s.kind === 'attach');
  if (!attach) continue;
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: oracle });
  state = enriched.state;
  ctx = enriched.ctx;
  const source = (state.battlefield as any[]).find((p) => p.id === 'bf-source');
  console.log('source type:', source?.type_line);
  console.log('targetCreatureId:', ctx.targetCreatureId);
  const result = applyAttachStep(state, attach as any, ctx, []);
  console.log('attach result:', result);
}
