import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import {
  buildAuditExecutionContext,
  buildAuditFixtureState,
  enrichAuditStateAndContextForTargets,
} from './executor-coverage-audit.ts';

const steps = [
  {
    kind: 'conditional',
    condition: { kind: 'if', raw: 'that player has one or fewer cards in hand' },
    steps: [
      {
        kind: 'lose_life',
        who: { kind: 'target_player' },
        amount: { kind: 'number', value: 3 },
        raw: 'they lose 3 life',
      },
    ],
    raw: 'If that player has one or fewer cards in hand, they lose 3 life.',
  },
];
let state = buildAuditFixtureState('Shrieking Affliction', 'Enchantment');
let ctx = buildAuditExecutionContext('Shrieking Affliction');
const enriched = enrichAuditStateAndContextForTargets(steps, state, ctx, { oracleText: steps[0].raw });
console.log('players', enriched.state.players?.map((p: any) => p.id));
console.log('controllerId', enriched.ctx.controllerId);
console.log('resolve', resolvePlayers(enriched.state, { kind: 'target_player' }, enriched.ctx));
const result = applyOracleIRStepsToGameState(enriched.state, steps, enriched.ctx, { allowOptional: true });
for (const gap of result.automationGaps || []) console.log(gap.reasonCode, gap.message);
process.exit(0);
