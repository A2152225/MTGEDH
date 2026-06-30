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
const card = cards.find((c: any) => c.name === 'Kindred Summons');
const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
const steps = ir.abilities?.[0]?.steps || [];
const moveStep = steps.find((s: any) => s.kind === 'move_zone' && /onto the battlefield/i.test(s.raw));

let state = buildAuditFixtureState(card.name, card.type_line);
let ctx = buildAuditExecutionContext(card.name);
const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: getCombinedOracleText(card) });

// simulate reveal result
const library = enriched.state.players[0].library;
const revealed = library.slice(0, 3);
console.log('library top', library.slice(0, 5).map((c: any) => `${c.id}:${c.type_line}`));
console.log('revealed', revealed.map((c: any) => c.id));

const result = applyMoveZoneStep(enriched.state, moveStep, {
  ...enriched.ctx,
  lastMovedCards: revealed,
}, { lastMovedCards: revealed });
console.log(result);
