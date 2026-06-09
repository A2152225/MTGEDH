import fs from 'node:fs';
import path from 'node:path';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  collectStepsFromIrText,
  buildAuditFixtureState,
  buildAuditExecutionContext,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Magnetic Snuffler')!;
const oracle = getCombinedOracleText(card);
const t = parseTriggeredAbilitiesFromText(oracle, 'Magnetic Snuffler').find((x) => x.effect.includes('equipment'))!;
const steps = collectStepsFromIrText(t.effect, 'Magnetic Snuffler');
let state = buildAuditFixtureState('Magnetic Snuffler', card.type_line);
const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Magnetic Snuffler', oracle_text: oracle, type_line: card.type_line }, steps, state, buildAuditExecutionContext('Magnetic Snuffler'));
const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
const gy = (targetEnriched.state.players || []).find((p: any) => p.id === 'p1')?.graveyard || [];
console.log('gy equipment ids', gy.filter((c: any) => /equipment/i.test(c.type_line || '')).map((c: any) => c.id));
console.log('has gy-equipment-1', gy.some((c: any) => c.id === 'gy-equipment-1'));
