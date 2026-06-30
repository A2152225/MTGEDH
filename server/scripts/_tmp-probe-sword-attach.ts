import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyMoveZoneStep } from '../../rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.js';
import { applyAttachStep } from '../../rules-engine/src/oracleIRExecutorAttachStepHandlers.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.js';
import { getCombinedOracleText } from './trigger-coverage-audit.js';

const cards = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: any) => c.name === 'Sword of the Meek');
const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
const ability = ir.abilities?.find((a: any) => /attach it to that creature/i.test(String(a.effectText || '')));
const steps = ability?.steps || [];
const moveStep = steps[0];
const attachStep = steps[1];

let state = buildAuditFixtureState(card.name, card.type_line);
let ctx = buildAuditExecutionContext(card.name);
const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: getCombinedOracleText(card) });

const moveResult = applyMoveZoneStep(enriched.state, moveStep, enriched.ctx, { lastMovedCards: [] }, { allowOptional: true } as any);
console.log('move', moveResult);
const attachResult = applyAttachStep(
  moveResult.state,
  attachStep,
  enriched.ctx,
  moveResult.lastMovedBattlefieldPermanentIds || [],
);
console.log('attach', attachResult);
