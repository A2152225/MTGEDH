import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCombinedOracleText } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

function probeCard(name: string) {
  const card = cards.find((c: any) => c.name === name);
  if (!card) return;
  const parsed = parseOracleTextToIR(getCombinedOracleText(card), card.name);
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, card.name), { typeLine: card.type_line });
    if (rec.status === 'fully_applied' || rec.status === 'choice_required') continue;
    console.log('\n===', name, rec.status, '===');
    console.log('TEXT', text.slice(0, 150));
    console.log('steps', steps.map((s) => ({ k: s.kind, raw: String((s as any).raw || '').slice(0, 70) })));
    console.log('reasons', rec.reasonCodes);
  }
}

for (const name of [
  'Blur',
  'Cho-Arrim Alchemist',
  'Ram Through',
  'Hard-Hitting Question',
  'Tandem Lookout',
  'Lair of the Hydra',
  'Clive\'s Hideaway',
  'Martyr of Frost',
  'Floating Shield',
  'Fire Covenant',
]) {
  probeCard(name);
}
