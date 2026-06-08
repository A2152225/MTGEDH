import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  collectStepsFromIrText,
} from './executor-coverage-audit.ts';
import { loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8'));
const names = [
  'Kathari Bomber',
  "Hell's Thunder",
  'Hellspark Elemental',
  'Prison Term',
  'Rhuk, Hexgold Nabber',
  'Phantom Blade',
  'Slimefoot and Squee',
];

{
  const effect =
    'create two 1/1 red goblin creature tokens and sacrifice this creature.\nunearth {3}{b}{r} ({3}{b}{r}: return this card from your graveyard to the battlefield. it gains haste. exile it at the beginning of the next end step. if it would leave the battlefield, exile it instead of putting it anywhere else.)';
  const steps = collectStepsFromIrText(effect, 'Kathari Bomber');
  console.log('\n=== Kathari full effect steps ===');
  console.log(JSON.stringify(steps, null, 2));
  const state = buildAuditFixtureState('Kathari Bomber', 'Creature — Bird Soldier');
  const ctx = buildAuditExecutionContext('Kathari Bomber');
  const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
  for (const g of result.automationGaps || []) console.log('GAP:', g.reasonCode, '|', g.raw);
}

for (const name of names) {
  const card = cards.find((c: any) => c.name === name);
  if (!card) {
    console.log('MISSING', name);
    continue;
  }
  const oracle = card.oracle_text || '';
  const triggers = parseTriggeredAbilitiesFromText(oracle, card.name);
  console.log('\n===', name, '===');
  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    const steps = collectStepsFromIrText(effect, card.name);
    const state = buildAuditFixtureState(card.name, card.type_line);
    const ctx = buildAuditExecutionContext(card.name);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const selectorGaps = (result.automationGaps || []).filter(g => g.reasonCode === 'unsupported_selector');
    if (selectorGaps.length === 0) continue;
    console.log('event:', trigger.event);
    console.log('effect:', effect.slice(0, 120));
    for (const gap of selectorGaps) {
      console.log('  GAP:', gap.stepKind, '|', gap.raw);
    }
  }
}
