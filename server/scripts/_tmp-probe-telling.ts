import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectUnknownIrGapsFromSteps } from './trigger-coverage-audit.js';
import { dryRunOracleSteps, getCombinedOracleText } from './executor-coverage-audit.js';

const cards = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../oracle-cards.json'), 'utf8'));
for (const name of ['Telling Time', 'Accumulate Wisdom', 'Moment of Truth']) {
  const card = cards.find((c: any) => c.name === name);
  const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
  for (const a of ir.abilities || []) {
    const steps = a.steps || [];
    if (!steps.length) continue;
    const r = dryRunOracleSteps(steps, card, collectUnknownIrGapsFromSteps(steps));
    if (r.status !== 'fully_applied' && r.status !== 'choice_required') {
      console.log(name, r.status, String(a.effectText || '').slice(0, 90));
    }
  }
}
