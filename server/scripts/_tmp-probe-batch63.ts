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

function probeCard(name: string) {
  const card = cards.find((c: any) => c.name === name);
  if (!card) {
    console.log('missing', name);
    return;
  }
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    if (
      !/graveyard onto the battlefield|reveals their hand|choose a nonland card from it/i.test(text)
    ) {
      continue;
    }
    const steps = collectStepsFromIrText(text, card.name);
    const irGaps = hasUnknownIRSteps(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status === 'fully_applied') continue;
    console.log('\n===', name, rec.status, '===');
    console.log('TEXT', text.slice(0, 160));
    console.log(
      'steps',
      steps.map((s) => ({
        k: s.kind,
        raw: String((s as any).raw || '').slice(0, 80),
      }))
    );
    console.log('reasons', rec.reasonCodes, 'kinds', rec.stepKinds);
    const state = buildAuditFixtureState(card.name, card.type_line);
    const ctx = buildOracleIRExecutionContext(card.name);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    console.log(
      'gaps',
      (result.automationGaps || []).slice(0, 6).map((g: any) => ({
        reason: g.reasonCode,
        kind: g.stepKind,
        msg: g.message?.slice(0, 100),
      }))
    );
    console.log(
      'applied',
      (result.appliedSteps || []).map((s: any) => s.kind),
      'skipped',
      (result.skippedSteps || []).map((s: any) => ({
        k: s.kind,
        raw: String((s as any).raw || '').slice(0, 60),
      }))
    );
  }
}

for (const name of [
  'Vat Emergence',
  'Fated Return',
  "Gix's Caress",
  'Grief',
  'Memory Theft',
  'Thoughtseize',
  'Persist',
]) {
  probeCard(name);
}
