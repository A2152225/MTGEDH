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
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  parseMoveZoneSingleTargetCriteria,
} from '../../rules-engine/src/oracleIRExecutorZoneOps.js';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Magnetic Snuffler')!;
const oracle = getCombinedOracleText(card);
const t = parseTriggeredAbilitiesFromText(oracle, 'Magnetic Snuffler').find((x) => x.effect.includes('equipment'))!;
const steps = collectStepsFromIrText(t.effect, 'Magnetic Snuffler');
const step = steps[0] as any;
let state = buildAuditFixtureState('Magnetic Snuffler', card.type_line);
const enriched = enrichAuditStateAndContextForCopySteps({ name: 'Magnetic Snuffler', oracle_text: oracle, type_line: card.type_line }, steps, state, buildAuditExecutionContext('Magnetic Snuffler'));
const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, { oracleText: oracle });
const gyCard = (targetEnriched.state.players as any[])[0].graveyard.find((c: any) => c.id === 'gy-equipment-1');
const criteria = parseMoveZoneSingleTargetCriteria(step.what as any);
console.log('criteria', criteria);
console.log('matches', cardMatchesMoveZoneSingleTargetCriteria(gyCard, criteria!, 'Magnetic Snuffler', 3));
