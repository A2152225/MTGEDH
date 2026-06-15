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
const card = cards.find((c) => c.name === 'Healing Technique')!;
const oracle = card.oracle_text;
const steps = parseOracleTextToIR(oracle, card.name).abilities.flatMap((a) => a.steps || []);
console.log(JSON.stringify(steps, null, 2));

let state = buildAuditFixtureState(card.name, card.type_line);
state = {
  ...state,
  players: (state.players || []).map((p: any) =>
    p.id === 'p1'
      ? {
          ...p,
          graveyard: [
            { id: 'gy-card-1', name: 'Returned Card', type_line: 'Instant', cmc: 4, manaValue: 4, mana_cost: '{2}{U}' },
          ],
        }
      : p
  ),
} as any;
let ctx = buildAuditExecutionContext(card.name);
const copyEnriched = enrichAuditStateAndContextForCopySteps(
  { name: card.name, type_line: card.type_line, oracle_text: oracle },
  steps,
  state,
  ctx
);
const enriched = enrichAuditStateAndContextForTargets(steps, copyEnriched.state, copyEnriched.ctx, { oracleText: oracle });

const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
console.log(
  'gaps',
  result.automationGaps?.map((g) => `${g.reasonCode}|${g.stepKind}: ${g.raw?.slice(0, 70)}`)
);
process.exit(0);
