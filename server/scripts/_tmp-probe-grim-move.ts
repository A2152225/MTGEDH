import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyMoveZoneStep } from '../../rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.js';
import { getCombinedOracleText } from './trigger-coverage-audit.js';

const cards = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: any) => c.name === "Grim Captain's Call");
const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
const step = ir.abilities?.[0]?.steps?.find((s: any) => s.kind === 'move_zone');

let state = buildAuditFixtureState(card.name, card.type_line);
let ctx = buildAuditExecutionContext(card.name);
const enriched = enrichAuditStateAndContextForTargets([step], state, ctx, { oracleText: getCombinedOracleText(card) });

console.log('chosen', enriched.ctx.selectorContext?.chosenObjectIds);
console.log('target', enriched.ctx.targetCreatureId, enriched.ctx.targetPermanentId);
