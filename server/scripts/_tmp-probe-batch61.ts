import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.ts';
import { buildAuditFixtureState } from './executor-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8'));

function probeCard(name: string) {
  const card = cards.find((c: any) => c.name === name);
  if (!card) return;
  const oracle = getCombinedOracleText(card);
  console.log('\n===', name, '===');
  const parsed = parseOracleTextToIR(oracle, card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    if (!/search your library|graveyard onto the battlefield|reveals their hand|offspring|partner-friends/i.test(text)) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const irGaps = hasUnknownIRSteps(text, card.name);
    const rec = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (rec.status === 'fully_applied') continue;
    console.log('TEXT', text.slice(0, 120));
    console.log('status', rec.status, 'reasons', rec.reasonCodes, 'kinds', rec.stepKinds);
    console.log('steps', steps.map((s) => ({ k: s.kind, raw: String((s as any).raw || '').slice(0, 70), tap: (s as any).entersTapped })));
    const state = buildAuditFixtureState(card.name, card.type_line);
    const ctx = buildOracleIRExecutionContext(card.name);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    console.log('gaps', (result.automationGaps || []).slice(0, 4).map((g: any) => ({ reason: g.reasonCode, kind: g.stepKind, msg: g.message?.slice(0, 80) })));
    console.log('applied', (result.appliedSteps || []).map((s: any) => s.kind), 'skipped', (result.skippedSteps || []).map((s: any) => s.kind));
  }
}

for (const name of [
  'Fabled Passage',
  'Escape Tunnel',
  'Far Wanderings',
  "Wayfarer's Bauble",
  'Vat Emergence',
  'Fated Return',
  "Gix's Caress",
  'Rust-Shield Rampager',
  'Bedlam Reveler',
  'Thunderherd Migration',
]) probeCard(name);

// all abilities for fabled passage
const fp = cards.find((c: any) => c.name === 'Fabled Passage');
if (fp) {
  console.log('\n=== Fabled Passage ALL abilities ===');
  const parsed = parseOracleTextToIR(getCombinedOracleText(fp), fp.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, fp.name);
    const irGaps = hasUnknownIRSteps(text, fp.name);
    const rec = dryRunOracleSteps(steps, fp, irGaps, { typeLine: fp.type_line });
    console.log(rec.status, '|', text.slice(0, 90), '| steps', steps.map((s) => s.kind));
  }
  const compound =
    'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. If you control four or more lands, you may search again.';
  const steps = collectStepsFromIrText(compound, fp.name);
  const rec = dryRunOracleSteps(steps, fp, hasUnknownIRSteps(compound, fp.name), { typeLine: fp.type_line });
  console.log('compound status', rec.status, rec.reasonCodes, 'steps', steps.map((s) => ({ k: s.kind, raw: String((s as any).raw || '').slice(0, 60), cond: (s as any).condition?.raw })));
}
