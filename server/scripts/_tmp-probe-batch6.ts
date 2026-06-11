import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectStepsFromIrText,
  dryRunOracleSteps,
} from './executor-coverage-audit.ts';
import { loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));

const targets = [
  'Gilgamesh, Master-at-Arms',
  'Arni Metalbrow',
  'Bruna, Light of Alabaster',
  'Duplicity',
  'Moonring Mirror',
  'The Cyber-Controller',
  'Muxus, Goblin Grandee',
  'Illuna, Apex of Wishes',
  'Swift Warkite',
  'Lonis, Cryptozoologist',
  'Bronzebeak Foragers',
  'Marang River Regent // Coil and Catch',
];

for (const name of targets) {
  const card = cards.find((c: any) => c.name === name);
  if (!card) {
    console.log('MISSING', name);
    continue;
  }
  const triggers = parseTriggeredAbilitiesFromText(card.oracle_text || '', card.name);
  console.log('\n===', name, '===');
  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    const steps = collectStepsFromIrText(effect, card.name);
    const result = dryRunOracleSteps(steps, card.name, [], { typeLine: card.type_line });
    const selectorGaps = (result as any).automationGaps?.filter?.((g: any) => g.reasonCode === 'unsupported_selector')
      || [];
    if (selectorGaps.length === 0 && result.status === 'fully_applied') continue;
    console.log('event:', trigger.event, '| status:', result.status);
    for (const step of steps) {
      if (step.kind === 'move_zone' || step.kind === 'attach') {
        console.log(' ', step.kind, '|', step.raw?.slice(0, 100));
      }
    }
    for (const gap of selectorGaps) {
      console.log('  GAP:', gap.stepKind, '|', gap.raw?.slice(0, 100));
    }
    if (selectorGaps.length === 0 && result.status !== 'fully_applied') {
      console.log('  reasons:', JSON.stringify((result as any).reasonCodes || {}));
    }
  }
}
