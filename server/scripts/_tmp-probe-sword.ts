import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForTargets,
  shouldDeclineOptionalStepsForAudit,
  collectAutoSelectedModeIds,
} from './executor-coverage-audit.js';
import { getCombinedOracleText } from './trigger-coverage-audit.js';

const cards = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../oracle-cards.json'), 'utf8'));
const card = cards.find((c: any) => c.name === 'Sword of the Meek');
const ir = parseOracleTextToIR(getCombinedOracleText(card), card.name);
const ability = ir.abilities?.find((a: any) => /attach it to that creature/i.test(String(a.effectText || '')));
const steps = ability?.steps || [];

let state = buildAuditFixtureState(card.name, card.type_line);
let ctx = buildAuditExecutionContext(card.name);
const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: getCombinedOracleText(card) });
const declineOptional = shouldDeclineOptionalStepsForAudit(steps);
console.log('declineOptional', declineOptional);
const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, {
  allowOptional: declineOptional ? false : true,
  ...(declineOptional ? { declineOptionalSteps: true } : {}),
});
console.log('applied', result.appliedSteps?.map((s: any) => s.kind));
console.log('skipped', result.skippedSteps?.map((s: any) => `${s.kind}: ${(s as any).message || s.raw}`));
