import fs from 'node:fs';
import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps, buildAuditFixtureState, buildAuditExecutionContext, enrichAuditStateAndContextForTargets } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.ts';

const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
for (const name of ['Memory Theft', 'Ego Drain']) {
  const card = cards.find((c: any) => c.name === name);
  const parsed = parseOracleTextToIR(getCombinedOracleText(card), card.name);
  for (const a of parsed.abilities || []) {
    const text = String(a.effectText || a.text || '').trim();
    if (!/reveals their hand/i.test(text)) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, card.name), { typeLine: card.type_line });
    console.log('\n', name, rec.status, rec.reasonCodes);
    let state = buildAuditFixtureState(card.name);
    let ctx = buildAuditExecutionContext(card.name);
    const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: text });
    const r = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
    console.log('gaps', r.automationGaps?.map((g) => ({ reason: g.reasonCode, kind: g.stepKind, msg: g.message?.slice(0, 70) })));
    console.log('applied', r.appliedSteps?.map((s) => s.kind), 'skipped', r.skippedSteps?.map((s) => ({ k: s.kind, raw: String((s as any).raw || '').slice(0, 50) })));
  }
}
