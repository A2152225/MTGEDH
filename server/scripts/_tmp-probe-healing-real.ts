import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];
const card = cards.find((c) => c.name === 'Healing Technique');
if (!card) {
  console.log('card not found');
  process.exit(1);
}
const oracle = card.oracle_text || '';
console.log('oracle', oracle);

const parsed = parseOracleTextToIR(oracle, card.name);
for (const ability of parsed.abilities || []) {
  const steps = ability.steps || [];
  if (steps.length === 0) continue;
  let state = buildAuditFixtureState(card.name, card.type_line);
  let ctx = buildAuditExecutionContext(card.name);
  const copyEnriched = enrichAuditStateAndContextForCopySteps(
    { name: card.name, type_line: card.type_line, oracle_text: oracle },
    steps,
    state,
    ctx
  );
  const enriched = enrichAuditStateAndContextForTargets(steps, copyEnriched.state, copyEnriched.ctx, {
    oracleText: oracle,
  });
  const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
  const gaps = (result.automationGaps || []).filter(
    (g) => !['player_choice_required', 'no_deterministic_target', 'unsupported_target'].includes(String(g.reasonCode))
  );
  if (gaps.length > 0) {
    console.log('ability gaps', gaps.map((g) => `${g.reasonCode}|${g.stepKind}: ${g.message}`));
  }
}
process.exit(0);
