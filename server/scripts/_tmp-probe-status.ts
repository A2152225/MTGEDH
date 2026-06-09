import fs from 'node:fs';
import path from 'node:path';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
for (const name of ['Foot Chopper', 'Magnetic Snuffler', 'Smothering Tithe']) {
  const card = cards.find((c) => c.name === name)!;
  for (const t of parseTriggeredAbilitiesFromText(getCombinedOracleText(card), name)) {
    const steps = collectStepsFromIrText(t.effect, name);
    const r = dryRunOracleSteps(steps, card, []);
    if (r.status !== 'fully_applied') {
      console.log(name, r.status, t.effect.slice(0, 80), 'steps', steps.map((s) => s.kind));
    }
  }
}
