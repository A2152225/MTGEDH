import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';

const steps = [
  {
    kind: 'move_zone',
    what: { kind: 'raw', text: 'target card from your graveyard' },
    to: 'hand',
    raw: 'return target card from your graveyard to your hand',
  },
  {
    kind: 'gain_life',
    who: { kind: 'you' },
    amount: { kind: 'object_stat', subject: 'that_card', stat: 'mana_value' },
    raw: "You gain life equal to that card's mana value",
  },
];
let state = buildAuditFixtureState('Healing Technique', 'Sorcery');
let ctx = buildAuditExecutionContext('Healing Technique');
const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: steps.map((s) => s.raw).join('\n') });
const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
for (const gap of result.automationGaps || []) console.log(gap.reasonCode, gap.stepKind, gap.raw);
console.log('applied', result.applied);
process.exit(0);
