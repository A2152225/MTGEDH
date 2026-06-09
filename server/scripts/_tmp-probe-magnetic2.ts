import fs from 'node:fs';
import path from 'node:path';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Magnetic Snuffler')!;
for (const t of parseTriggeredAbilitiesFromText(getCombinedOracleText(card), 'Magnetic Snuffler')) {
  const steps = collectStepsFromIrText(t.effect, 'Magnetic Snuffler');
  const r = dryRunOracleSteps(steps, card, []);
  if (r.status === 'partial') {
    console.log('PARTIAL', t.effect.slice(0, 90), r);
  }
}
