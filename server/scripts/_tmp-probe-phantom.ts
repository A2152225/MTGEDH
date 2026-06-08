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
await loadEffectIrParser();

const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: any) => c.name === 'Phantom Blade');
const trigger = parseTriggeredAbilitiesFromText(card.oracle_text, card.name).find(t => t.event === 'enters_battlefield');
const steps = collectStepsFromIrText(trigger.effect, card.name);
console.log(JSON.stringify(steps.slice(0, 3), null, 2));

const state = buildAuditFixtureState(card.name, card.type_line);
const ctx = buildAuditExecutionContext(card.name);
const step = steps.find(s => s.kind === 'attach');
const result = applyOracleIRStepsToGameState(state, [step], ctx, { allowOptional: true });
console.log('gaps:', result.automationGaps);
console.log('bf-source exists:', state.battlefield.some((p: any) => p.id === 'bf-source'));
