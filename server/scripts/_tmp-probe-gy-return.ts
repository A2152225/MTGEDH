import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';

const step = {
  kind: 'move_zone',
  what: { kind: 'raw', text: 'target card from your graveyard' },
  to: 'hand',
  toRaw: 'your hand',
  raw: 'return target card from your graveyard to your hand',
};
let state = buildAuditFixtureState('Healing Technique', 'Sorcery');
let ctx = buildAuditExecutionContext('Healing Technique');
const enriched = enrichAuditStateAndContextForTargets([step], state, ctx, { oracleText: step.raw });
const result = applyOracleIRStepsToGameState(enriched.state, [step], enriched.ctx, { allowOptional: true });
console.log('gaps', result.automationGaps);
console.log('log', result.log?.slice(-3));
console.log('gy p1', enriched.state.players?.find((p: any) => p.id === 'p1')?.graveyard?.length);
console.log('hand p1', result.state.players?.find((p: any) => p.id === 'p1')?.hand?.length);
process.exit(0);
